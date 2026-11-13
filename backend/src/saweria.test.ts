import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { isValidSaweriaSignature, parseSaweriaPayload } from "./saweria.js";

const payload = parseSaweriaPayload({
  version: "1",
  id: "saweria-event-1",
  amount_raw: 1000,
  donator_name: "Supporter",
  donator_email: "supporter@example.test",
  message: "Semangat"
});

test("Saweria signature uses the documented field order and rejects changes", () => {
  const key = "test-stream-key";
  const canonical = `${payload.version}${payload.id}${payload.amount_raw}${payload.donator_name}${payload.donator_email}`;
  const signature = createHmac("sha256", key).update(canonical).digest("hex");
  assert.equal(isValidSaweriaSignature(payload, signature, key), true);
  assert.equal(isValidSaweriaSignature(payload, signature, "wrong-key"), false);
  assert.equal(isValidSaweriaSignature(payload, "not-a-signature", key), false);
});
