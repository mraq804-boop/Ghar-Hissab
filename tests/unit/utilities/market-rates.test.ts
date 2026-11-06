import { describe, expect, it } from "vitest";
import { parsePoultryReply, parseRateListPage } from "@/lib/utilities/poultry-rates";
import { parseCommoditiesReply, parseVegetablesReply } from "@/lib/utilities/market-rates";
import { buildChatContext } from "@/lib/chat/context";

const row = (date: string, file: string) => `<tr>
  <td headers="view-field-rate-list-date-table-column" class="views-field"><time datetime="${date}T12:00:00Z">x</time></td>
  <td headers="view-field-retail-price-list-table-column" class="views-field"><a href="/system/files?file=${file}" target="_blank">View</a></td>
</tr>`;

describe("Lahore poultry rate list", () => {
  it("reads one picture link per date, newest first", () => {
    const html = `<table>${row("2026-11-04", "poultry_912.jpeg")}${row("2026-11-05", "poultry_913.jpeg")}${row("2026-11-03", "poultry%2003-11-26.jpeg")}${row("2026-11-03", "poultry%2003-11-26_0.jpeg")}</table>`;
    expect(parseRateListPage(html)).toEqual([
      { date: "2026-11-05", url: "https://lahore.punjab.gov.pk/system/files?file=poultry_913.jpeg" },
      { date: "2026-11-04", url: "https://lahore.punjab.gov.pk/system/files?file=poultry_912.jpeg" },
      { date: "2026-11-03", url: "https://lahore.punjab.gov.pk/system/files?file=poultry%2003-11-26.jpeg" },
    ]);
    expect(parseRateListPage("<p>nothing</p>")).toEqual([]);
  });

  it("accepts a sensible reading of the picture", () => {
    expect(parsePoultryReply('{"date":"2026-11-05","rates":[360,374,388,563,7410,251]}', "2026-11-05")).toEqual({
      date: "2026-11-05",
      farmGateLive: 360,
      broilerLiveWholesale: 374,
      broilerLiveRetail: 388,
      broilerMeatRetail: 563,
      eggsCrate: 7410,
      eggsDozen: 251,
    });
    expect(parsePoultryReply('```json\n{"rates":["360","374","388","563","7,410","251"]}\n```', "2026-11-05")?.date).toBe("2026-11-05");
  });

  it("rejects readings that can't be right", () => {
    expect(parsePoultryReply("not json", "2026-11-05")).toBeNull();
    expect(parsePoultryReply('{"rates":[360,374,388]}', "2026-11-05")).toBeNull();
    expect(parsePoultryReply('{"rates":[360,374,388,56,7410,251]}', "2026-11-05")).toBeNull();
    expect(parsePoultryReply('{"rates":[360,374,388,563,74,251]}', "2026-11-05")).toBeNull();
    expect(parsePoultryReply('{"rates":[400,374,388,563,7410,251]}', "2026-11-05")).toBeNull();
  });

  it("adds the rates to the Ask data for everyone", () => {
    const text = buildChatContext({
      today: "2026-11-06",
      households: [{ code: "AQ", isPurseHolder: true }],
      rules: [],
      months: [],
      poultry: [{ date: "2026-11-05", farmGateLive: 360, broilerLiveWholesale: 374, broilerLiveRetail: 388, broilerMeatRetail: 563, eggsCrate: 7410, eggsDozen: 251 }],
      scope: { seeExpenses: false, seeAllBalances: false, ownUnit: "AQ" },
    });
    expect(text).toContain("Official Lahore poultry rates");
    expect(text).toContain("2026-11-05 | Rs 563 | Rs 388 | Rs 374 | Rs 360 | Rs 251 | Rs 7,410");
  });
});

describe("Lahore sabzi and essential commodities rates", () => {
  const veg = (n: number) => JSON.stringify({ date: "2026-11-05", items: Array.from({ length: n }, (_, i) => ({ name: `Sabzi ${i}`, first: 100 + i, second: 95 + i })) });

  it("accepts a full sabzi list and blanks for missing prices", () => {
    const reply = JSON.stringify({ date: "2026-11-05", items: [...JSON.parse(veg(15)).items, { name: "Lemoo Desi (lemon)", first: "-", second: null }] });
    const r = parseVegetablesReply(reply, "2026-11-05");
    expect(r?.items).toHaveLength(16);
    expect(r?.items.at(-1)).toEqual({ name: "Lemoo Desi (lemon)", first: null, second: null });
  });

  it("rejects short or impossible sabzi lists", () => {
    expect(parseVegetablesReply(veg(10), "2026-11-05")).toBeNull();
    expect(parseVegetablesReply(JSON.stringify({ items: [...JSON.parse(veg(15)).items, { name: "Tamatar", first: 100, second: 140 }] }), "2026-11-05")).toBeNull();
    expect(parseVegetablesReply(JSON.stringify({ items: [...JSON.parse(veg(15)).items, { name: "Tamatar", first: 2, second: 1 }] }), "2026-11-05")).toBeNull();
    expect(parseVegetablesReply("oops", "2026-11-05")).toBeNull();
  });

  it("reads the commodities notice with blanks", () => {
    const items = [
      { name: "Flour 20 kg bag (atta)", unit: "20 kg bag", wholesale: "--", retail: "N/A" },
      { name: "Milk (doodh)", unit: "per litre", wholesale: null, retail: 170 },
      { name: "Mutton, bone-in (chhota gosht)", unit: "per kg", wholesale: null, retail: "1,600" },
      { name: "Beef, bone-in (bara gosht)", unit: "per kg", wholesale: null, retail: 800 },
      { name: "Besan", unit: "per kg", wholesale: 200, retail: 210 },
    ];
    const r = parseCommoditiesReply(JSON.stringify({ items }), "2026-08-03");
    expect(r?.items.find((i) => i.name.startsWith("Mutton"))?.retail).toBe(1600);
    expect(r?.items[0]).toEqual({ name: "Flour 20 kg bag (atta)", unit: "20 kg bag", wholesale: null, retail: null });
    expect(parseCommoditiesReply(JSON.stringify({ items: items.slice(0, 3) }), "2026-08-03")).toBeNull();
  });

  it("adds sabzi and commodity prices to the Ask data with their dates", () => {
    const text = buildChatContext({
      today: "2026-11-06",
      households: [{ code: "AQ", isPurseHolder: true }],
      rules: [],
      months: [],
      vegetables: [{ date: "2026-11-05", items: [{ name: "Tamatar first grade (tomato)", first: 175, second: 165 }, { name: "Lemoo Desi (lemon)", first: null, second: null }] }],
      commodities: { date: "2026-08-03", items: [{ name: "Mutton, bone-in (chhota gosht)", unit: "per kg", wholesale: null, retail: 1600 }] },
      scope: { seeExpenses: false, seeAllBalances: false, ownUnit: "AQ" },
    });
    expect(text).toContain("2026-11-05 (item first grade / second grade): Tamatar first grade (tomato) Rs 175 / Rs 165; Lemoo Desi (lemon) - / -.");
    expect(text).toContain("notice dated 2026-08-03");
    expect(text).toContain("Mutton, bone-in (chhota gosht) | per kg | - | Rs 1,600");
  });
});
