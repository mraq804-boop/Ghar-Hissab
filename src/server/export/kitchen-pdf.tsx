import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { menuWeek, menuWeekday } from "@/lib/kitchen";
import { formatKg, shoppingList } from "@/lib/shopping";

export type MenuSlot = { week: number; weekday: number; dish: string; fixed_category: string };

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 11, fontFamily: "Helvetica", color: "#000" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 10, marginTop: 3, marginBottom: 10 },
  week: { marginTop: 10 },
  weekTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  row: { flexDirection: "row", borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#000" },
  head: { flexDirection: "row", borderWidth: 1, borderColor: "#000", fontFamily: "Helvetica-Bold", fontSize: 9 },
  cell: { paddingHorizontal: 6, paddingVertical: 4, borderRightWidth: 1, borderColor: "#000" },
  last: { borderRightWidth: 0 },
  buy: { fontSize: 9, marginTop: 3 },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8 },
});

const show = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const rangeOf = (w: string[]) => `${show(w[0], { day: "numeric", month: "short" })} – ${show(w[6], { day: "numeric", month: "short", year: "numeric" })}`;

function mealsOf(w: string[], slots: MenuSlot[]) {
  return w.map((day) => {
    const r = slots.find((x) => x.week === menuWeek(day) && x.weekday === menuWeekday(day));
    return { day, dish: r?.dish ?? "", category: r?.fixed_category ?? "" };
  });
}

function MenuPdf({ weeks, slots, people, title }: { weeks: string[][]; slots: MenuSlot[]; people: number; title: string | null }) {
  const month = title !== null;
  const compact = month ? { paddingVertical: 2.5 } : { paddingVertical: 6 };
  return (
    <Document title={month ? `Kitchen menu ${title}` : `Kitchen menu ${rangeOf(weeks[0])}`} author="Ghar Hisaab">
      <Page size="A4" style={[s.page, month ? { fontSize: 9.5 } : {}]}>
        <Text style={s.title}>{month ? `Kitchen menu · ${title}` : "Weekly kitchen menu"}</Text>
        <Text style={s.sub}>
          {month ? `${weeks.length} weeks of 7 days, Monday to Sunday · buy on the Sunday before each week (${people} people)` : rangeOf(weeks[0])}
        </Text>
        {weeks.map((w, i) => {
          const meals = mealsOf(w, slots);
          const buy = shoppingList(meals, people);
          return (
            <View key={w[0]} style={s.week} wrap={false}>
              {month ? <Text style={s.weekTitle}>Week {i + 1} · {rangeOf(w)}</Text> : null}
              <View style={s.head}>
                <Text style={[s.cell, { width: 90 }]}>Day</Text>
                <Text style={[s.cell, { width: 60 }]}>Date</Text>
                <Text style={[s.cell, s.last, { flex: 1 }]}>Dish</Text>
              </View>
              {meals.map((m) => (
                <View key={m.day} style={s.row}>
                  <Text style={[s.cell, s.bold, compact, { width: 90 }]}>{show(m.day, { weekday: "long" })}</Text>
                  <Text style={[s.cell, compact, { width: 60 }]}>{show(m.day, { day: "numeric", month: "short" })}</Text>
                  <Text style={[s.cell, s.last, compact, { flex: 1 }]}>
                    {m.dish || "—"}
                    {m.category ? <Text style={s.small}>{`  (${m.category})`}</Text> : null}
                  </Text>
                </View>
              ))}
              {month && buy.length ? (
                <Text style={s.buy}>
                  <Text style={s.bold}>Buy: </Text>
                  {buy.map((r) => `${r.item} ${formatKg(r.kg)}`).join(" · ")}
                </Text>
              ) : null}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

function ListPdf({ week, slots, people }: { week: string[]; slots: MenuSlot[]; people: number }) {
  const list = shoppingList(mealsOf(week, slots), people);
  const days = (d: string[]) => d.map((x) => show(x, { weekday: "short" })).join(", ");
  return (
    <Document title={`Shopping list ${rangeOf(week)}`} author="Ghar Hisaab">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Sunday shopping list</Text>
        <Text style={s.sub}>
          {rangeOf(week)} · {people} people
        </Text>
        <View style={s.head}>
          <Text style={[s.cell, { flex: 1 }]}>Item</Text>
          <Text style={[s.cell, { width: 70 }]}>Quantity</Text>
          <Text style={[s.cell, { width: 130 }]}>For</Text>
          <Text style={[s.cell, s.last, { width: 60 }]}>Bought</Text>
        </View>
        {list.map((r) => (
          <View key={`${r.group}-${r.item}`} style={s.row} wrap={false}>
            <Text style={[s.cell, { flex: 1, paddingVertical: 7 }]}>
              <Text style={s.bold}>{r.item}</Text>
              {r.group !== r.item ? <Text style={s.small}>{`  (${r.group})`}</Text> : null}
            </Text>
            <Text style={[s.cell, s.bold, { width: 70, paddingVertical: 7 }]}>{formatKg(r.kg)}</Text>
            <Text style={[s.cell, s.small, { width: 130, paddingVertical: 7 }]}>{days(r.days)}</Text>
            <Text style={[s.cell, s.last, { width: 60, paddingVertical: 7 }]}> </Text>
          </View>
        ))}
        {list.length ? null : <Text style={s.sub}>No meat, fish or sabzi dishes on the menu this week.</Text>}
      </Page>
    </Document>
  );
}

export function kitchenMenuPdf(weeks: string[][], slots: MenuSlot[], people: number, monthTitle: string | null): Promise<Buffer> {
  return renderToBuffer(<MenuPdf weeks={weeks} slots={slots} people={people} title={monthTitle} />);
}

export function shoppingListPdf(week: string[], slots: MenuSlot[], people: number): Promise<Buffer> {
  return renderToBuffer(<ListPdf week={week} slots={slots} people={people} />);
}
