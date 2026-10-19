import { z } from "zod";
import { moneyString } from "./expense";

export const ALLOWED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
export type ProofType = (typeof ALLOWED_PROOF_TYPES)[number];

export const PROOF_EXT: Record<ProofType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export const paymentInputSchema = z.object({
  idempotencyKey: z.uuid(),
  periodId: z.uuid("Choose the month this payment is for"),
  payerUnitId: z.uuid("Choose who paid"),
  amount: moneyString.refine((v) => Number(v) > 0, "Amount must be more than zero"),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the payment date"),
  method: z.enum(["bank_transfer", "easypaisa", "jazzcash", "raast", "cash", "card", "other"]),
  reference: z.string().trim().max(80).optional().default(""),
  relatedExpenseId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(1000).optional().default(""),
  proofPath: z.string().max(300).nullable().optional(),
});

export type PaymentInputForm = z.input<typeof paymentInputSchema>;

export const reviewSchema = z
  .object({
    paymentId: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
    version: z.number().int().positive(),
    reason: z.string().trim().max(500).optional().default(""),
  })
  .refine((v) => v.decision === "approved" || v.reason.length > 0, { path: ["reason"], message: "Give a reason when rejecting a payment" });

export function sniffMime(bytes: Uint8Array): ProofType | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  const brand = String.fromCharCode(...b.slice(4, 12));
  if (brand.startsWith("ftyp") && /heic|heix|mif1|msf1|hevc/.test(brand.slice(4))) return "image/heic";
  return null;
}
