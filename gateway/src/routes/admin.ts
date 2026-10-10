import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";

export const adminRouter = Router();

/**
 * Stopgap only: a single shared static bearer token, not a real admin UI or
 * a second Entra role check. This exists so Stage 2 can be exercised
 * end-to-end (approve a user, assign a line) without building an admin
 * portal first. Replace with an Entra app-role check before any real
 * deployment — tracked as a known gap, not hidden.
 */
function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header !== `Bearer ${config.adminToken}`) {
    res.status(401).json({ error: "invalid_admin_token" });
    return;
  }
  next();
}

adminRouter.use(requireAdminToken);

const createLineSchema = z.object({
  label: z.string().min(1),
  e164Number: z.string().min(1),
  extension: z.string().optional(),
});

adminRouter.post("/admin/lines", async (req, res) => {
  const parsed = createLineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const line = await prisma.line.upsert({
    where: { e164Number: parsed.data.e164Number },
    create: parsed.data,
    update: parsed.data,
  });
  res.status(200).json({ line });
});

const approveUserSchema = z.object({
  entraOid: z.string().min(1),
  entraTid: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
});

// Pre-approves a user for calling before their first sign-in, or re-approves
// one that was previously revoked. If the user has already signed in once
// (and so already exists, unapproved), this flips callingApproved on.
adminRouter.post("/admin/users/approve", async (req, res) => {
  const parsed = approveUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const { entraOid, entraTid, email, displayName } = parsed.data;

  const user = await prisma.gatewayUser.upsert({
    where: { entraOid },
    create: { entraOid, entraTid, email, displayName, callingApproved: true, approvedAt: new Date() },
    update: { callingApproved: true, approvedAt: new Date(), revokedAt: null },
  });

  res.status(200).json({ user });
});

adminRouter.post("/admin/users/:userId/revoke", async (req, res) => {
  const user = await prisma.gatewayUser.findUnique({ where: { id: req.params.userId } });
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  const updated = await prisma.gatewayUser.update({
    where: { id: user.id },
    data: { revokedAt: new Date(), callingApproved: false },
  });
  res.status(200).json({ user: updated });
});

const assignLineSchema = z.object({
  lineId: z.string().min(1),
  canUseAsCallerId: z.boolean().default(true),
});

adminRouter.post("/admin/users/:userId/assign-line", async (req, res) => {
  const parsed = assignLineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const { userId } = req.params;
  const { lineId, canUseAsCallerId } = parsed.data;

  const [user, line] = await Promise.all([
    prisma.gatewayUser.findUnique({ where: { id: userId } }),
    prisma.line.findUnique({ where: { id: lineId } }),
  ]);
  if (!user || !line) {
    res.status(404).json({ error: "user_or_line_not_found" });
    return;
  }

  const assignment = await prisma.userLineAssignment.upsert({
    where: { userId_lineId: { userId, lineId } },
    create: { userId, lineId, canUseAsCallerId },
    update: { canUseAsCallerId },
  });

  res.status(200).json({ assignment });
});
