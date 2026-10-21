import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLescoBill } from "@/lib/lesco/parse";
import { billAssets, buildBillSnapshot } from "@/lib/lesco/snapshot";

const sample = readFileSync(join(process.cwd(), "tests", "fixtures", "lesco-bill.html"), "utf8");

describe("parseLescoBill", () => {
  it("reads month, dates, units and amounts from a bill page", () => {
    expect(parseLescoBill(sample)).toEqual({
      ok: true,
      bill: {
        referenceNo: "09999990000001",
        billMonth: "2026-11",
        readingDate: "2026-11-10",
        issueDate: "2026-11-14",
        dueDate: "2026-11-28",
        units: 402,
        payable: 12345,
        currentBill: 11020,
        latePayments: [
          { until: "2026-12-03", amount: 12725 },
          { until: null, amount: 13105 },
        ],
      },
    });
  });

  it("tells a missing bill, a CAPTCHA and an unreadable page apart", () => {
    expect(parseLescoBill("<html><body><h2>Search Your Electricity Bill</h2></body></html>")).toEqual({ ok: false, reason: "not_found" });
    expect(parseLescoBill('<form><img class="captcha-img" src="/captcha.ashx"><input name="txtCaptcha"></form>')).toEqual({ ok: false, reason: "captcha" });
    expect(parseLescoBill("<html><body>BILL MONTH soon</body></html>")).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("buildBillSnapshot", () => {
  const assets = billAssets(sample);
  const snap = buildBillSnapshot(sample, { "/styles/gbill-design.css": ".bill{color:#123} .x{background:url(/img/a.png)} @font-face{font-family:A;src:url(/f.woff)}" }, { "/images/companies/lesco/logo.png": "data:image/png;base64,AAAA" });

  it("lists the site's own stylesheets and images", () => {
    expect(assets).toEqual({ styles: ["/styles/gbill-design.css"], images: ["/images/companies/lesco/logo.png", "/images/meter-snaps/1.jpg"] });
  });

  it("keeps the bill content and inlines the supplied styles and logo", () => {
    expect(snap).toContain("PAYABLE WITHIN DUE DATE");
    expect(snap).toContain("12,345");
    expect(snap).toContain(".bill{color:#123}");
    expect(snap).toContain('src="data:image/png;base64,AAAA"');
    expect(snap).toContain("#loader-container");
  });

  it("removes scripts, handlers, forms, frames and every outside request", () => {
    expect(snap).not.toMatch(/<script/i);
    expect(snap).not.toMatch(/\son[a-z]+\s*=/i);
    expect(snap).not.toMatch(/javascript:/i);
    expect(snap).not.toMatch(/<(form|input|button|iframe)\b/i);
    expect(snap).not.toMatch(/<link\b/i);
    expect(snap).not.toMatch(/url\((?!\s*['"]?data:)/i);
    expect(snap).not.toContain("@font-face");
    expect(snap).not.toContain("evil.example");
    expect(snap).not.toContain("meter-snaps");
    expect(snap).not.toContain("__VIEWSTATE");
    expect(snap).not.toMatch(/target=/i);
  });
});
