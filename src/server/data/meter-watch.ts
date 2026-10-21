import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getContext } from "@/server/auth";
import { meterWatch, type MeterWatch } from "@/lib/utilities/meter-watch";

export type MeterWatchView = MeterWatch & {
  meterId: string;
  label: string;
  history: { month: string; units: number }[];
  readings: { id: string; reading: number; readAt: string; mine: boolean }[];
};

/** Meter Watch for every LESCO meter with a bill that has readings. Uses the signed-in member's session. */
export async function getMeterWatches(): Promise<MeterWatchView[]> {
  const ctx = await getContext();
  return loadMeterWatches(ctx.supabase, ctx.householdId, ctx.userId);
}

/** The same for any household, with the given client (the scheduled job passes the service client). */
export async function loadMeterWatches(db: SupabaseClient, householdId: string, userId: string | null): Promise<MeterWatchView[]> {
  const [meters, bills, readings] = await Promise.all([
    db.from("utility_meters").select("id, label, unit_limit").eq("household_id", householdId).eq("provider", "lesco").eq("active", true).order("created_at"),
    db.from("utility_bills").select("meter_id, bill_month, reading_date, present_reading, history").eq("household_id", householdId).not("present_reading", "is", null).order("bill_month", { ascending: false }).limit(60),
    db.from("meter_readings").select("id, meter_id, reading, read_at, recorded_by").eq("household_id", householdId).gte("read_at", new Date(Date.now() - 70 * 86_400_000).toISOString()).order("read_at", { ascending: false }),
  ]);
  if (meters.error || bills.error || readings.error) return [];
  const now = new Date().toISOString();

  return meters.data.flatMap((m) => {
    const bill = bills.data.find((b) => b.meter_id === m.id);
    if (!bill || bill.present_reading === null) return [];
    const baselineDate = bill.reading_date ?? `${bill.bill_month.slice(0, 7)}-01`;
    const mine = readings.data.filter((r) => r.meter_id === m.id);
    const watch = meterWatch({
      baseline: bill.present_reading,
      baselineDate,
      readings: mine.map((r) => ({ reading: r.reading, readAt: r.read_at })),
      limit: m.unit_limit,
      now,
    });
    return [
      {
        ...watch,
        meterId: m.id,
        label: m.label,
        history: ((bill.history ?? []) as { month: string; units: number }[]).map((h) => ({ month: h.month, units: h.units })),
        readings: mine
          .filter((r) => r.read_at >= baselineDate)
          .slice(0, 8)
          .map((r) => ({ id: r.id, reading: r.reading, readAt: r.read_at, mine: userId !== null && r.recorded_by === userId })),
      },
    ];
  });
}
