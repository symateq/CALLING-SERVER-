import express, { type Express } from "express";
import { healthRouter } from "./routes/health.js";
import { devicesRouter } from "./routes/devices.js";
import { linesRouter } from "./routes/lines.js";
import { adminRouter } from "./routes/admin.js";

// Factory, not a module-level singleton, so tests can build fresh app
// instances against an isolated test database without starting a real
// network listener.
export function buildApp(): Express {
  const app = express();
  app.use(express.json());

  app.use(healthRouter);
  app.use(devicesRouter);
  app.use(linesRouter);
  app.use(adminRouter);

  return app;
}
