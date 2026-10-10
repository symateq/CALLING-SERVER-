import type { Request, Response, NextFunction } from "express";
import type { GatewayUser } from "@prisma/client";
import { prisma } from "../db.js";

declare module "express-serve-static-core" {
  interface Request {
    gatewayUser?: GatewayUser;
  }
}

/**
 * Must run after requireEntraAuth. Looks up (or lazily creates, as
 * not-yet-approved) the gateway's own record for this Entra identity, and
 * rejects unless an admin has explicitly set callingApproved=true.
 * A valid company SSO token alone is identity, not calling authorization —
 * these are deliberately separate checks per the plan's requirement.
 */
export async function requireCallingPermission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }

  let user = await prisma.gatewayUser.findUnique({ where: { entraOid: auth.oid } });

  if (!user) {
    user = await prisma.gatewayUser.create({
      data: {
        entraOid: auth.oid,
        entraTid: auth.tid,
        email: auth.email,
        displayName: auth.name,
        callingApproved: false,
      },
    });
  }

  if (user.revokedAt) {
    res.status(403).json({ error: "access_revoked" });
    return;
  }

  if (!user.callingApproved) {
    res.status(403).json({ error: "calling_not_approved" });
    return;
  }

  req.gatewayUser = user;
  next();
}
