import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/auth";
import { buildReport, parseFilters, ReportAccessError, reportType, type ReportType } from "@/server/reports";
import { reportToXlsx } from "@/server/export/xlsx";
import { reportToPdf } from "@/server/export/pdf";

export const maxDuration = 30;

export async function GET(request: NextRequest, ctxRoute: RouteContext<"/api/export/[kind]">) {
  const { kind } = await ctxRoute.params;
  const ctx = await getContext();
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  let type: ReportType;
  let filters = parseFilters(sp);
  if (kind === "expenses") {
    type = "expenses";
    const m = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : undefined;
    filters = { ...filters, from: m, to: m };
  } else if (kind === "report") {
    type = reportType(sp.type);
  } else {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const format = sp.format === "pdf" ? "pdf" : "xlsx";

  try {
    const report = await buildReport(type, filters);
    const body = format === "pdf" ? await reportToPdf(report, ctx.householdName) : await reportToXlsx(report, ctx.householdName);
    const name = `${report.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${format}`;
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ReportAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
