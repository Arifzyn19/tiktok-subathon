import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "subathon-test-"));
process.env.DATABASE_PATH = join(testDir, "test.sqlite");
process.env.ADMIN_TOKEN = "test-token-with-more-than-24-characters";
process.env.NODE_ENV = "test";

let dbModule: typeof import("./database.js");
let timer: typeof import("./timer-service.js");

before(async () => {
  dbModule = await import("./database.js");
  timer = await import("./timer-service.js");
});

after(() => {
  dbModule.db.close();
  rmSync(testDir, { recursive: true, force: true });
});

test("timer countdown persists elapsed time and can pause", () => {
  const initial = timer.resetTimer(3_600_000, 10_000);
  assert.equal(initial.remainingMs, 3_600_000);
  assert.equal(timer.startTimer(3_600_000, 20_000).status, "running");
  const paused = timer.pauseTimer(25_000);
  assert.equal(paused.remainingMs, 3_595_000);
  assert.equal(paused.status, "paused");
});

test("duplicate contribution is idempotent and adds expected time", () => {
  timer.resetTimer(60_000, 100_000);
  const contribution = {
    kind: "donation" as const,
    donationId: "donation-one",
    donatorName: "Tester",
    amountRupiah: 2000,
    message: "",
    addedMs: 1_800_000
  };
  assert.equal(timer.recordContribution(contribution, 101_000)?.remainingMs, 1_860_000);
  assert.equal(timer.recordContribution(contribution, 102_000), null);
  assert.equal(timer.getPublicTimerState(102_000).totalDonations, 2000);
});

test("Saweria conversion credits full denomination steps only", () => {
  assert.equal(timer.calculateDonationAddedMs(999), 0);
  assert.equal(timer.calculateDonationAddedMs(1000), 900_000);
  assert.equal(timer.calculateDonationAddedMs(2500), 1_800_000);
  assert.equal(timer.calculateDonationAddedMs(10_000), 9_000_000);
});

test("100 TikTok coins add 1,000 seconds", () => {
  dbModule.saveSettings({
    ...dbModule.getSettings(),
    tiktokCoinSeconds: 10
  });
  assert.equal(timer.calculateGiftAddedMs(100), 1_000_000);
});
