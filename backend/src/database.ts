import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

export type TimerStatus = "idle" | "running" | "paused";

export interface TimerRow {
  remaining_ms: number;
  status: TimerStatus;
  updated_at: number;
  total_coins: number;
  total_donations: number;
  total_added_ms: number;
}

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = config.databasePath === ":memory:"
  ? config.databasePath
  : isAbsolute(config.databasePath) ? config.databasePath : resolve(backendRoot, config.databasePath);
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS timer_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    remaining_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'paused')),
    updated_at INTEGER NOT NULL,
    total_coins INTEGER NOT NULL DEFAULT 0,
    total_donations INTEGER NOT NULL DEFAULT 0,
    total_added_ms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tiktok_gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    gift_name TEXT NOT NULL,
    coins INTEGER NOT NULL,
    added_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saweria_donations (
    donation_id TEXT PRIMARY KEY,
    donator_name TEXT NOT NULL,
    amount_rupiah INTEGER NOT NULL,
    message TEXT NOT NULL,
    added_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.prepare(`
  INSERT OR IGNORE INTO timer_state (id, remaining_ms, status, updated_at)
  VALUES (1, ?, 'idle', ?)
`).run(config.initialTimerMs, Date.now());

const defaults: Record<string, string> = {
  tiktokUsername: config.TIKTOK_USERNAME,
  tiktokCoinSeconds: String(config.TIKTOK_COIN_SECONDS),
  saweriaMinimumRupiah: String(config.SAWERIA_MINIMUM_RUPIAH),
  saweriaRupiahStep: String(config.SAWERIA_RUPIAH_STEP),
  saweriaMinutesPerStep: String(config.SAWERIA_MINUTES_PER_STEP)
};
const insertSetting = db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)");
for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value);

export interface AppSettings {
  tiktokUsername: string;
  tiktokCoinSeconds: number;
  saweriaMinimumRupiah: number;
  saweriaRupiahStep: number;
  saweriaMinutesPerStep: number;
}

export function getSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as { key: string; value: string }[];
  const values = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  return {
    tiktokUsername: values.tiktokUsername ?? "",
    tiktokCoinSeconds: Number(values.tiktokCoinSeconds),
    saweriaMinimumRupiah: Number(values.saweriaMinimumRupiah),
    saweriaRupiahStep: Number(values.saweriaRupiahStep),
    saweriaMinutesPerStep: Number(values.saweriaMinutesPerStep)
  };
}

export function saveSettings(settings: AppSettings): void {
  const update = db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) update.run(key, String(value));
  });
  transaction();
}

export function getTimerRow(): TimerRow {
  return db.prepare("SELECT remaining_ms, status, updated_at, total_coins, total_donations, total_added_ms FROM timer_state WHERE id = 1").get() as TimerRow;
}

export function setTimerRow(row: TimerRow): void {
  db.prepare(`
    UPDATE timer_state
    SET remaining_ms = ?, status = ?, updated_at = ?, total_coins = ?, total_donations = ?, total_added_ms = ?
    WHERE id = 1
  `).run(row.remaining_ms, row.status, row.updated_at, row.total_coins, row.total_donations, row.total_added_ms);
}
