import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireEntraAuth } from "../auth/entraAuth.js";
import { requireCallingPermission } from "../auth/callingPermission.js";

export const devicesRouter = Router();

const registerSchema = z.object({
  deviceId: z.string().min(1),
  platform: z.enum(["ANDROID", "WINDOWS"]),
  pushToken: z.string().min(1).optional(),
});

// Registers or re-registers (upsert) this device for the signed-in user.
// Re-registering updates lastSeenAt and any new push token, so a reinstalled
// app or a rotated FCM token doesn't create a duplicate device row.
devicesRouter.post("/devices/register", requireEntraAuth, requireCallingPermission, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const { deviceId, platform, pushToken } = parsed.data;
  const user = req.gatewayUser!;

  const device = await prisma.device.upsert({
    where: { userId_deviceId: { userId: user.id, deviceId } },
    create: { userId: user.id, deviceId, platform, pushToken, revokedAt: null },
    update: { platform, pushToken, lastSeenAt: new Date(), revokedAt: null },
  });

  res.status(200).json({ device });
});

devicesRouter.get("/devices", requireEntraAuth, requireCallingPermission, async (req, res) => {
  const user = req.gatewayUser!;
  const devices = await prisma.device.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { registeredAt: "asc" },
  });
  res.json({ devices });
});

devicesRouter.delete("/devices/:id", requireEntraAuth, requireCallingPermission, async (req, res) => {
  const user = req.gatewayUser!;
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });

  if (!device || device.userId !== user.id) {
    res.status(404).json({ error: "device_not_found" });
    return;
  }

  await prisma.device.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
  res.status(204).send();
});
