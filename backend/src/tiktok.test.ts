import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "subathon-tiktok-test-"));
process.env.DATABASE_PATH = join(testDir, "test.sqlite");
process.env.ADMIN_TOKEN = "test-token-with-more-than-24-characters";
process.env.NODE_ENV = "test";

let getGiftContribution: typeof import("./tiktok.js")["getGiftContribution"];
let database: typeof import("./database.js");

before(async () => {
  database = await import("./database.js");
  database.saveSettings({ ...database.getSettings(), tiktokCoinSeconds: 10 });
  ({ getGiftContribution } = await import("./tiktok.js"));
});

after(() => {
  database.db.close();
  rmSync(testDir, { recursive: true, force: true });
});

test("current connector gift fields produce a credit for a non-streak gift", () => {
  const result = getGiftContribution({
    common: { msgId: "gift-message-1" },
    user: { userId: "user-1", nickname: "Supporter" },
    giftId: "5655",
    gift: { name: "Rose", diamondCount: 1, type: 0 },
    repeatCount: 1,
    repeatEnd: 0
  });

  assert.deepEqual(result, {
    eventId: "gift-message-1",
    senderId: "user-1",
    senderName: "Supporter",
    giftName: "Rose",
    coins: 1,
    addedMs: 10_000
  });
});

test("streak gifts are only credited on their final event with repeat count", () => {
  const inProgress = getGiftContribution({
    common: { msgId: "gift-message-progress" },
    giftId: "5655",
    gift: { name: "Rose", diamondCount: 1, type: 1 },
    repeatCount: 3,
    repeatEnd: 0
  });
  const completed = getGiftContribution({
    common: { msgId: "gift-message-final" },
    giftId: "5655",
    gift: { name: "Rose", diamondCount: 1, type: 1 },
    repeatCount: 3,
    repeatEnd: 1
  });

  assert.equal(inProgress, null);
  assert.equal(completed?.coins, 3);
  assert.equal(completed?.addedMs, 30_000);
});
