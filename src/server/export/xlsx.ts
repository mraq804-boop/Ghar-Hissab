import "server-only";
import ExcelJS from "exceljs";
import { paisaToNumber } from "@/lib/finance";
import { cellText, type Report } from "@/server/reports";

export async function reportToXlsx(report: Report, householdName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ghar Hisaab";
  wb.created = new Date(report.generatedAt);
  const ws = wb.addWorksheet(report.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }] });
  const n = report.columns.length;

  ws.mergeCells(1, 1, 1, n);
  ws.getCell(1, 1).value = `${householdName}: ${report.title}`;
  ws.getCell(1, 1).font = { name: "Segoe UI", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, n);
  ws.getCell(2, 1).value = `${report.subtitle}. Generated ${new Date(report.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}. Payments count only once approved.`;
  ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: "FF404040" } };

  const header = ws.getRow(4);
  report.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: "Segoe UI", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    cell.alignment = { horizontal: c.kind === "money" ? "right" : "left", vertical: "middle" };
  });
  header.height = 22;

  const write = (values: Record<string, unknown>, rowNum: number, total = false) => {
    const row = ws.getRow(rowNum);
    report.columns.forEach((c, i) => {
      const v = values[c.key];
      const cell = row.getCell(i + 1);
      if (c.kind === "money" && typeof v === "bigint") {
        cell.value = paisaToNumber(v);
        cell.numFmt = v % 100n === 0n ? "#,##0;[Red]-#,##0" : "#,##0.00;[Red]-#,##0.00";
        cell.alignment = { horizontal: "right" };
      } else if (c.kind === "date" && typeof v === "string" && v) {
        cell.value = new Date(`${v}T00:00:00Z`);
        cell.numFmt = "dd-mmm-yyyy";
      } else {
        cell.value = cellText(v as never, c.kind);
      }
      cell.font = { name: "Segoe UI", size: 10, bold: total, color: total ? { argb: "FF1F4E78" } : undefined };
      if (total) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
      else if (rowNum % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F5F9" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD9D9D9" } } };
    });
  };

  report.rows.forEach((r, i) => write(r, 5 + i));
  if (report.totals) write(report.totals, 5 + report.rows.length, true);

  report.columns.forEach((c, i) => {
    const widest = Math.max(c.label.length, ...report.rows.map((r) => cellText(r[c.key] ?? null, c.kind).length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(10, widest + 3));
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
