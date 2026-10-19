import "server-only";
import { z } from "zod";

const schema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20, "SUPABASE_SECRET_KEY is missing"),
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  EXCEL_TOKEN_ENC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, "EXCEL_TOKEN_ENC_KEY must be 32 random bytes, base64 encoded")
    .optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Server configuration is incomplete: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function excelConfigured() {
  const e = process.env;
  return Boolean(
    e.GOOGLE_CLIENT_ID &&
      e.GOOGLE_CLIENT_SECRET &&
      e.SUPABASE_SECRET_KEY &&
      e.EXCEL_TOKEN_ENC_KEY &&
      /^[A-Za-z0-9+/]{43}=$/.test(e.EXCEL_TOKEN_ENC_KEY),
  );
}
