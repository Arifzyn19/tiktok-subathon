import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", ".env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  DATABASE_PATH: z.string().default("./data/subathon.sqlite"),
  ADMIN_TOKEN: z.string().min(24, "ADMIN_TOKEN must contain at least 24 characters"),
  FRONTEND_ORIGINS: z.string().default("http://localhost:5173"),
  INITIAL_TIMER_MINUTES: z.coerce.number().positive().default(60),
  TIKTOK_USERNAME: z.string().default(""),
  TIKTOK_COIN_SECONDS: z.coerce.number().positive().default(10),
  SAWERIA_MINIMUM_RUPIAH: z.coerce.number().int().positive().default(1000),
  SAWERIA_RUPIAH_STEP: z.coerce.number().int().positive().default(1000),
  SAWERIA_MINUTES_PER_STEP: z.coerce.number().positive().default(15),
  SAWERIA_STREAM_KEY: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = {
  ...parsed.data,
  frontendOrigins: parsed.data.FRONTEND_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  initialTimerMs: Math.round(parsed.data.INITIAL_TIMER_MINUTES * 60_000),
  databasePath: parsed.data.DATABASE_PATH
};
