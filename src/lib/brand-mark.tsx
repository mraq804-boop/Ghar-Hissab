export const INK = "#1b2340";
export const HALDI = "#e2a322";

/**
 * App icon artwork: a house whose doorway is a ledger page.
 * `safe` shrinks the artwork into the centre 60% so maskable icons survive circle/squircle crops.
 */
export function BrandMark({ size, safe = false, rounded = true }: { size: number; safe?: boolean; rounded?: boolean }) {
  const art = Math.round(size * (safe ? 0.56 : 0.72));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: INK,
        borderRadius: rounded && !safe ? Math.round(size * 0.22) : 0,
      }}
    >
      <svg width={art} height={art} viewBox="0 0 100 100" fill="none">
        <path d="M50 10 L92 46 L82 46 L82 90 L18 90 L18 46 L8 46 Z" fill={HALDI} />
        <rect x="36" y="52" width="28" height="38" rx="3" fill={INK} />
        <rect x="41" y="60" width="18" height="3.5" rx="1.5" fill={HALDI} />
        <rect x="41" y="68" width="18" height="3.5" rx="1.5" fill={HALDI} />
        <rect x="41" y="76" width="12" height="3.5" rx="1.5" fill={HALDI} />
      </svg>
    </div>
  );
}
