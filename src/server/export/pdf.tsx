import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { cellText, type Report } from "@/server/reports";

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1b2340" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9, color: "#5f6b85", marginTop: 4, marginBottom: 14 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dfe2ec", paddingVertical: 4 },
  head: { flexDirection: "row", backgroundColor: "#1b2340", color: "#ffffff", paddingVertical: 5, fontFamily: "Helvetica-Bold" },
  total: { flexDirection: "row", backgroundColor: "#eceef5", paddingVertical: 5, fontFamily: "Helvetica-Bold" },
  cell: { flex: 1, paddingHorizontal: 4 },
  right: { textAlign: "right" },
  foot: { position: "absolute", bottom: 18, left: 32, right: 32, fontSize: 7, color: "#5f6b85", flexDirection: "row", justifyContent: "space-between" },
});

function ReportPdf({ report, household }: { report: Report; household: string }) {
  const wide = report.columns.length > 5;
  return (
    <Document title={report.title} author="Ghar Hisaab">
      <Page size="A4" orientation={wide ? "landscape" : "portrait"} style={s.page}>
        <Text style={s.title}>{report.title}</Text>
        <Text style={s.sub}>
          {household}. {report.subtitle}. Amounts in PKR. Payments count only once approved.
        </Text>
        <View style={s.head} fixed>
          {report.columns.map((c) => (
            <Text key={c.key} style={[s.cell, c.kind === "money" ? s.right : {}]}>{c.label}</Text>
          ))}
        </View>
        {report.rows.map((r, i) => (
          <View key={i} style={s.row} wrap={false}>
            {report.columns.map((c) => (
              <Text key={c.key} style={[s.cell, c.kind === "money" ? s.right : {}]}>{cellText(r[c.key] ?? null, c.kind)}</Text>
            ))}
          </View>
        ))}
        {report.totals ? (
          <View style={s.total} wrap={false}>
            {report.columns.map((c) => (
              <Text key={c.key} style={[s.cell, c.kind === "money" ? s.right : {}]}>{cellText(report.totals![c.key] ?? null, c.kind)}</Text>
            ))}
          </View>
        ) : null}
        <View style={s.foot} fixed>
          <Text>Generated {new Date(report.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function reportToPdf(report: Report, household: string): Promise<Buffer> {
  return renderToBuffer(<ReportPdf report={report} household={household} />);
}
