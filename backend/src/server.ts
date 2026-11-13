import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { Server } from "socket.io";
import { z } from "zod";
import { config } from "./config.js";
import { db, getSettings, saveSettings } from "./database.js";
import { adjustTimer, calculateDonationAddedMs, getPublicTimerState, pauseTimer, resetTimer, resumeTimer, startTimer, tickTimer, recordContribution } from "./timer-service.js";
import { isValidSaweriaSignature, parseSaweriaPayload } from "./saweria.js";
import { TikTokListener } from "./tiktok.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: config.frontendOrigins,
    methods: ["GET", "POST", "PUT"]
  }
});
const tiktok = new TikTokListener(io);

app.disable("x-powered-by");
if (config.TRUST_PROXY_HOPS > 0) app.set("trust proxy", config.TRUST_PROXY_HOPS);
app.use(cors({ origin: config.frontendOrigins, methods: ["GET", "POST", "PUT"], allowedHeaders: ["Content-Type", "Authorization", "Saweria-Callback-Signature"] }));
app.use(express.json({ limit: "32kb" }));

function tokenMatches(candidate: string): boolean {
  const expected = Buffer.from(config.ADMIN_TOKEN);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function requireAdmin(req: Request, res: Response, next: (error?: unknown) => void): void {
  const authorization = req.header("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token || !tokenMatches(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const webhookLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);
app.use("/api", requireAdmin);

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/state", (_req, res) => {
  res.json({ timer: getPublicTimerState(), settings: getSettings(), connections: { tiktok: tiktok.getStatus(), saweria: config.SAWERIA_STREAM_KEY ? "configured" : "not_configured" } });
});

app.get("/api/history", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const gifts = db.prepare(`
    SELECT event_id AS id, sender_name AS senderName, gift_name AS name, coins AS amount, added_ms AS addedMs, created_at AS createdAt
    FROM tiktok_gifts ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  const donations = db.prepare(`
    SELECT donation_id AS id, donator_name AS senderName, amount_rupiah AS amount, message, added_ms AS addedMs, created_at AS createdAt
    FROM saweria_donations ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  res.json({ gifts, donations });
});

const actionSchema = z.object({ deltaSeconds: z.number().finite().min(-86_400).max(86_400) });
app.post("/api/timer/:action", (req, res) => {
  let state;
  switch (req.params.action) {
    case "start": state = startTimer(config.initialTimerMs); break;
    case "pause": state = pauseTimer(); break;
    case "resume": state = resumeTimer(); break;
    case "reset": state = resetTimer(config.initialTimerMs); break;
    case "adjust": {
      const body = actionSchema.parse(req.body);
      state = adjustTimer(body.deltaSeconds * 1000);
      break;
    }
    default:
      res.status(404).json({ error: "Unknown timer action" });
      return;
  }
  io.emit("timer:update", state);
  res.json(state);
});

const settingsSchema = z.object({
  tiktokUsername: z.string().trim().max(100),
  tiktokCoinSeconds: z.number().finite().positive().max(3600),
  saweriaMinimumRupiah: z.number().int().positive().max(1_000_000_000),
  saweriaRupiahStep: z.number().int().positive().max(1_000_000_000),
  saweriaMinutesPerStep: z.number().finite().positive().max(10_000)
});
app.put("/api/settings", async (req, res) => {
  const settings = settingsSchema.parse(req.body);
  const usernameChanged = settings.tiktokUsername !== getSettings().tiktokUsername;
  saveSettings(settings);
  if (usernameChanged) await tiktok.connect(settings.tiktokUsername);
  io.emit("connection:status", {
    tiktok: tiktok.getStatus(),
    saweria: config.SAWERIA_STREAM_KEY ? "configured" : "not_configured"
  });
  res.json({ settings, connections: { tiktok: tiktok.getStatus(), saweria: config.SAWERIA_STREAM_KEY ? "configured" : "not_configured" } });
});

app.post("/webhooks/saweria", webhookLimiter, (req, res, next) => {
  try {
    if (!config.SAWERIA_STREAM_KEY) {
      res.status(503).json({ error: "Saweria webhook is not configured" });
      return;
    }
    const payload = parseSaweriaPayload(req.body);
    const signature = req.header("Saweria-Callback-Signature") ?? "";
    if (!isValidSaweriaSignature(payload, signature, config.SAWERIA_STREAM_KEY)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    const addedMs = calculateDonationAddedMs(payload.amount_raw);
    if (addedMs === 0) {
      res.status(200).json({ accepted: true, credited: false });
      return;
    }
    const state = recordContribution({
      kind: "donation",
      donationId: payload.id,
      donatorName: payload.donator_name,
      amountRupiah: payload.amount_raw,
      message: payload.message,
      addedMs
    });
    if (!state) {
      res.status(200).json({ accepted: true, duplicate: true });
      return;
    }
    io.emit("timer:update", state);
    io.emit("activity:new", {
      type: "donation",
      id: payload.id,
      senderName: payload.donator_name,
      description: payload.message,
      amount: payload.amount_raw,
      addedMs,
      createdAt: Date.now()
    });
    res.status(200).json({ accepted: true, credited: true, addedMs });
  } catch (error) {
    next(error);
  }
});

io.on("connection", (socket) => {
  socket.emit("timer:update", getPublicTimerState());
  socket.emit("connection:status", {
    tiktok: tiktok.getStatus(),
    saweria: config.SAWERIA_STREAM_KEY ? "configured" : "not_configured"
  });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request", details: error.issues });
    return;
  }
  console.error("Unhandled request error:", error);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

const ticker = setInterval(() => io.emit("timer:update", tickTimer()), 1000);
ticker.unref();

const settings = getSettings();
if (settings.tiktokUsername) void tiktok.connect(settings.tiktokUsername);
if (!config.SAWERIA_STREAM_KEY) console.warn("SAWERIA_STREAM_KEY is not set; the Saweria webhook will return 503.");

httpServer.listen(config.PORT, config.HOST, () => {
  console.info(`Subathon backend listening on ${config.HOST}:${config.PORT}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down gracefully.`);
  clearInterval(ticker);
  await tiktok.stop();
  io.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
