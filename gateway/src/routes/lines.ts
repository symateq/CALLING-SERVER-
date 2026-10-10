import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireEntraAuth } from "../auth/entraAuth.js";
import { requireCallingPermission } from "../auth/callingPermission.js";

export const linesRouter = Router();

// The lines (DIDs) this user is permitted to use, for populating the
// "Call from" selector. This is the server's source of truth — the client
// never decides which caller IDs are permitted.
linesRouter.get("/lines", requireEntraAuth, requireCallingPermission, async (req, res) => {
  const user = req.gatewayUser!;
  const assignments = await prisma.userLineAssignment.findMany({
    where: { userId: user.id },
    include: { line: true },
  });

  res.json({
    lines: assignments.map((a) => ({
      lineId: a.line.id,
      label: a.line.label,
      e164Number: a.line.e164Number,
      extension: a.line.extension,
      canUseAsCallerId: a.canUseAsCallerId,
    })),
  });
});

const validateCallerIdSchema = z.object({
  lineId: z.string().min(1),
});

// Server-side enforcement: a client proposing to place an outbound call with
// a given line as caller ID must be told yes/no by the server, every time.
// Selecting a line for outgoing caller ID must never imply disabling incoming
// calls to the other line(s) — that is handled entirely by routing (Stage 3),
// not by this check.
linesRouter.post(
  "/lines/validate-caller-id",
  requireEntraAuth,
  requireCallingPermission,
  async (req, res) => {
    const parsed = validateCallerIdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const user = req.gatewayUser!;
    const assignment = await prisma.userLineAssignment.findUnique({
      where: { userId_lineId: { userId: user.id, lineId: parsed.data.lineId } },
      include: { line: true },
    });

    const permitted = Boolean(assignment?.canUseAsCallerId);
    res.json({
      permitted,
      e164Number: permitted ? assignment!.line.e164Number : null,
    });
  },
);
