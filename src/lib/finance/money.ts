export type Paisa = bigint;

const RUPEE_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function parseRupeesToPaisa(input: string | number): Paisa {
  const text = String(input).trim().replace(/,/g, "");
  if (!RUPEE_PATTERN.test(text)) {
    throw new Error(`Invalid amount "${input}". Use rupees with at most 2 decimals.`);
  }
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const paisa = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  return negative ? -paisa : paisa;
}

export function paisaToNumber(p: Paisa): number {
  return Number(p) / 100;
}

export function paisaToDecimalString(p: Paisa): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const s = `${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  return negative ? `-${s}` : s;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatPaisa(p: Paisa, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  let body: string;
  if (opts.decimals) {
    body = `${group((abs / 100n).toString())}.${(abs % 100n).toString().padStart(2, "0")}`;
  } else {
    body = group(((abs + 50n) / 100n).toString());
  }
  const prefix = negative ? "−" : opts.sign && abs > 0n ? "+" : "";
  return `${prefix}Rs ${body}`;
}
