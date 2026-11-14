import { randomUUID } from "node:crypto";
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import type { Server } from "socket.io";
import { getSettings } from "./database.js";
import { calculateGiftAddedMs, getPublicTimerState, recordContribution } from "./timer-service.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export interface GiftEvent {
  common?: { msgId?: string };
  user?: { uniqueId?: string; userId?: string; nickname?: string };
  giftId?: number | string;
  gift?: { name?: string; diamondCount?: number; type?: number };
  giftDetails?: { giftName?: string; diamondCount?: number; giftType?: number };
  repeatCount?: number;
  repeatEnd?: boolean | number;
  msgId?: string;
  orderId?: string;
}

export interface GiftContribution {
  eventId: string;
  senderId: string;
  senderName: string;
  giftName: string;
  coins: number;
  addedMs: number;
}

export function getGiftContribution(event: GiftEvent): GiftContribution | null {
  const giftType = event.gift?.type ?? event.giftDetails?.giftType;
  if (giftType === 1 && !event.repeatEnd) return null;

  const repeatCount = Math.max(1, Math.floor(event.repeatCount ?? 1));
  const coinValue = event.gift?.diamondCount ?? event.giftDetails?.diamondCount ?? 0;
  const coins = Math.max(0, Math.floor(coinValue)) * repeatCount;
  if (coins <= 0) return null;

  const senderId = event.user?.userId ?? event.user?.uniqueId ?? "unknown";
  const senderName = event.user?.nickname ?? event.user?.uniqueId ?? "TikTok viewer";
  const giftName = event.gift?.name ?? event.giftDetails?.giftName ?? `Gift ${event.giftId ?? ""}`.trim();
  const eventId = event.common?.msgId ?? event.msgId ?? event.orderId ?? randomUUID();

  return {
    eventId,
    senderId,
    senderName,
    giftName,
    coins,
    addedMs: calculateGiftAddedMs(coins)
  };
}

export class TikTokListener {
  private connection: TikTokLiveConnection | undefined;
  private username = "";
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectDelayMs = 2_000;
  private generation = 0;
  private status: ConnectionStatus = "disconnected";

  constructor(private readonly io: Server) {}

  getStatus(): ConnectionStatus {
    return this.status;
  }

  async connect(username: string): Promise<void> {
    const normalized = username.trim().replace(/^@/, "");
    this.generation += 1;
    const currentGeneration = this.generation;
    this.clearReconnect();
    await this.disconnectCurrent();
    this.username = normalized;
    if (!normalized) {
      this.setStatus("disconnected");
      return;
    }
    this.setStatus("connecting");
    const connection = new TikTokLiveConnection(normalized, { processInitialData: false });
    this.connection = connection;
    const subscribe = Reflect.get(connection, "on");
    if (typeof subscribe !== "function") {
      this.connection = undefined;
      throw new Error("Installed TikTok connector does not expose the documented event listener API.");
    }
    subscribe.call(connection, WebcastEvent.GIFT, (event: GiftEvent) => this.handleGift(event));
    subscribe.call(connection, ControlEvent.DISCONNECTED, () => {
      if (currentGeneration === this.generation) this.scheduleReconnect(currentGeneration);
    });
    try {
      await connection.connect();
      if (currentGeneration !== this.generation) return;
      this.reconnectDelayMs = 2_000;
      this.setStatus("connected");
    } catch (error) {
      if (currentGeneration !== this.generation) return;
      console.error(`TikTok connection failed for @${normalized}:`, error);
      this.setStatus("error");
      this.scheduleReconnect(currentGeneration);
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.clearReconnect();
    this.username = "";
    await this.disconnectCurrent();
    this.setStatus("disconnected");
  }

  private handleGift(event: GiftEvent): void {
    const contribution = getGiftContribution(event);
    if (!contribution) return;
    const { eventId, senderId, senderName, giftName, coins, addedMs } = contribution;
    const state = recordContribution({ kind: "gift", ...contribution });
    if (!state) return;
    this.io.emit("timer:update", state);
    this.io.emit("activity:new", {
      type: "gift",
      id: eventId,
      senderName,
      description: `${giftName} · ${coins} coin`,
      amount: coins,
      addedMs,
      createdAt: Date.now()
    });
  }

  private scheduleReconnect(generation: number): void {
    if (generation !== this.generation || !this.username || this.reconnectTimer) return;
    this.setStatus("disconnected");
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect(this.username);
    }, delay);
  }

  private async disconnectCurrent(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (!connection) return;
    try {
      await connection.disconnect();
    } catch (error) {
      console.warn("TikTok disconnect cleanup failed:", error);
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.io.emit("connection:status", {
      tiktok: status,
      saweria: process.env.SAWERIA_STREAM_KEY ? "configured" : "not_configured"
    });
  }
}

export function publishCurrentTimer(io: Server): void {
  io.emit("timer:update", getPublicTimerState());
}
