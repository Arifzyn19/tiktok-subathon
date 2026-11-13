import { db, getSettings, getTimerRow, setTimerRow, type TimerRow, type TimerStatus } from "./database.js";

export interface PublicTimerState {
  remainingMs: number;
  status: TimerStatus;
  totalCoins: number;
  totalDonations: number;
  totalAddedMs: number;
  serverTime: number;
}

function calculateRemaining(row: TimerRow, now: number): number {
  if (row.status !== "running") return Math.max(0, row.remaining_ms);
  return Math.max(0, row.remaining_ms - (now - row.updated_at));
}

export function getPublicTimerState(now = Date.now()): PublicTimerState {
  const row = getTimerRow();
  const remainingMs = calculateRemaining(row, now);
  if (row.status === "running" && remainingMs === 0) {
    setTimerRow({ ...row, remaining_ms: 0, status: "paused", updated_at: now });
    return { remainingMs, status: "paused", totalCoins: row.total_coins, totalDonations: row.total_donations, totalAddedMs: row.total_added_ms, serverTime: now };
  }
  return { remainingMs, status: row.status, totalCoins: row.total_coins, totalDonations: row.total_donations, totalAddedMs: row.total_added_ms, serverTime: now };
}

function saveTimer(remainingMs: number, status: TimerStatus, now: number, totals?: Pick<TimerRow, "total_coins" | "total_donations" | "total_added_ms">): void {
  const current = getTimerRow();
  setTimerRow({
    remaining_ms: Math.max(0, Math.round(remainingMs)),
    status,
    updated_at: now,
    total_coins: totals?.total_coins ?? current.total_coins,
    total_donations: totals?.total_donations ?? current.total_donations,
    total_added_ms: totals?.total_added_ms ?? current.total_added_ms
  });
}

export function startTimer(initialTimerMs: number, now = Date.now()): PublicTimerState {
  const state = getPublicTimerState(now);
  const remainingMs = state.remainingMs > 0 ? state.remainingMs : initialTimerMs;
  saveTimer(remainingMs, "running", now);
  return getPublicTimerState(now);
}

export function pauseTimer(now = Date.now()): PublicTimerState {
  const state = getPublicTimerState(now);
  saveTimer(state.remainingMs, "paused", now);
  return getPublicTimerState(now);
}

export function resumeTimer(now = Date.now()): PublicTimerState {
  const state = getPublicTimerState(now);
  saveTimer(state.remainingMs, "running", now);
  return getPublicTimerState(now);
}

export function resetTimer(initialTimerMs: number, now = Date.now()): PublicTimerState {
  saveTimer(initialTimerMs, "idle", now);
  return getPublicTimerState(now);
}

export function adjustTimer(deltaMs: number, now = Date.now()): PublicTimerState {
  const state = getPublicTimerState(now);
  saveTimer(state.remainingMs + deltaMs, state.status, now);
  return getPublicTimerState(now);
}

export function tickTimer(now = Date.now()): PublicTimerState {
  const row = getTimerRow();
  if (row.status === "running") {
    const remaining = calculateRemaining(row, now);
    saveTimer(remaining, remaining === 0 ? "paused" : "running", now);
  }
  return getPublicTimerState(now);
}

export type Contribution =
  | { kind: "gift"; eventId: string; senderId: string; senderName: string; giftName: string; coins: number; addedMs: number }
  | { kind: "donation"; donationId: string; donatorName: string; amountRupiah: number; message: string; addedMs: number };

export function recordContribution(contribution: Contribution, now = Date.now()): PublicTimerState | null {
  const transaction = db.transaction(() => {
    const state = getTimerRow();
    const remainingMs = calculateRemaining(state, now);
    if (contribution.kind === "gift") {
      const result = db.prepare(`
        INSERT OR IGNORE INTO tiktok_gifts (event_id, sender_id, sender_name, gift_name, coins, added_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(contribution.eventId, contribution.senderId, contribution.senderName, contribution.giftName, contribution.coins, contribution.addedMs, now);
      if (result.changes === 0) return false;
      setTimerRow({
        ...state,
        remaining_ms: remainingMs + contribution.addedMs,
        status: state.status === "running" && remainingMs === 0 ? "paused" : state.status,
        updated_at: now,
        total_coins: state.total_coins + contribution.coins,
        total_donations: state.total_donations,
        total_added_ms: state.total_added_ms + contribution.addedMs
      });
    } else {
      const result = db.prepare(`
        INSERT OR IGNORE INTO saweria_donations (donation_id, donator_name, amount_rupiah, message, added_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(contribution.donationId, contribution.donatorName, contribution.amountRupiah, contribution.message, contribution.addedMs, now);
      if (result.changes === 0) return false;
      setTimerRow({
        ...state,
        remaining_ms: remainingMs + contribution.addedMs,
        status: state.status === "running" && remainingMs === 0 ? "paused" : state.status,
        updated_at: now,
        total_coins: state.total_coins,
        total_donations: state.total_donations + contribution.amountRupiah,
        total_added_ms: state.total_added_ms + contribution.addedMs
      });
    }
    return true;
  });
  return transaction() ? getPublicTimerState(now) : null;
}

export function calculateGiftAddedMs(coins: number): number {
  return Math.round(coins * getSettings().tiktokCoinSeconds * 1000);
}

export function calculateDonationAddedMs(amountRupiah: number): number {
  const settings = getSettings();
  if (amountRupiah < settings.saweriaMinimumRupiah) return 0;
  return Math.floor(amountRupiah / settings.saweriaRupiahStep) * settings.saweriaMinutesPerStep * 60_000;
}
