import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function key(b64: string) {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("EXCEL_TOKEN_ENC_KEY must decode to 32 bytes");
  return k;
}

export function encryptSecret(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyB64), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(token: string, keyB64: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== VERSION || !iv || !tag || !data) throw new Error("Unrecognised encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm", key(keyB64), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
