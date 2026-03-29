// ──────────────────────────────────────────────
// Routes: Haptic Feedback (Buttplug.io)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { hapticService } from "../services/haptic/buttplug-service.js";
import type { HapticDeviceCommand } from "@marinara-engine/shared";

export async function hapticRoutes(app: FastifyInstance) {
  // ── GET /status ──
  app.get("/status", async () => {
    return hapticService.status();
  });

  // ── POST /connect ──
  app.post<{ Body: { url?: string } }>("/connect", async (req, reply) => {
    try {
      await hapticService.connect(req.body?.url);
      return hapticService.status();
    } catch (err) {
      reply.status(502);
      return { error: `Failed to connect to Intiface Central: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // ── POST /disconnect ──
  app.post("/disconnect", async () => {
    await hapticService.disconnect();
    return hapticService.status();
  });

  // ── POST /scan/start ──
  app.post("/scan/start", async (_req, reply) => {
    try {
      await hapticService.startScanning();
      return { scanning: true };
    } catch (err) {
      reply.status(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── POST /scan/stop ──
  app.post("/scan/stop", async () => {
    await hapticService.stopScanning();
    return { scanning: false };
  });

  // ── GET /devices ──
  app.get("/devices", async () => {
    return { devices: hapticService.devices };
  });

  // ── POST /command ──
  app.post<{ Body: HapticDeviceCommand }>("/command", async (req, reply) => {
    try {
      await hapticService.executeCommand(req.body);
      return { ok: true };
    } catch (err) {
      reply.status(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── POST /stop-all ──
  app.post("/stop-all", async () => {
    await hapticService.stopAll();
    return { ok: true };
  });
}
