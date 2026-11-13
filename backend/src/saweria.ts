import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  version: z.union([z.string(), z.number()]),
  id: z.string().min(1),
  amount_raw: z.number().int().nonnegative(),
  donator_name: z.string().default("Anonymous"),
  donator_email: z.string().default(""),
  message: z.string().default("")
});

export type SaweriaPayload = z.infer<typeof payloadSchema>;

export function parseSaweriaPayload(payload: unknown): SaweriaPayload {
  return payloadSchema.parse(payload);
}

export function isValidSaweriaSignature(payload: SaweriaPayload, receivedSignature: string, streamKey: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(receivedSignature)) return false;
  const message = `${payload.version}${payload.id}${payload.amount_raw}${payload.donator_name}${payload.donator_email}`;
  const expected = createHmac("sha256", streamKey).update(message, "utf8").digest();
  const received = Buffer.from(receivedSignature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}
