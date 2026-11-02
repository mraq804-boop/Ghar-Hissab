import { describe, expect, it } from "vitest";
import { readSngplPage } from "@/lib/utilities/sngpl-page";

const bill = `<html><body><table>
<tr><td>Consumer No</td><td>12345678901</td></tr>
<tr><td>Billing Month</td><td>OCT-2026</td></tr>
<tr><td>Due Date</td><td>14-Nov-2026</td></tr>
<tr><td>Amount Payable Within Due Date</td><td>3,450</td></tr>
<tr><td>Amount Payable After Due Date</td><td>3,795</td></tr>
</table></body></html>`;

describe("readSngplPage", () => {
  it("reads the month, due date and amounts from a bill page", () => {
    const r = readSngplPage(bill, "12345678901");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bill.billMonth).toBe("2026-10");
    expect(r.bill.dueDate).toBe("2026-11-14");
    expect(r.bill.payable).toBe(3450);
    expect(r.bill.latePayments).toEqual([{ until: null, amount: 3795 }]);
  });

  it("refuses a bill for another consumer number", () => {
    expect(readSngplPage(bill, "99999999999")).toEqual({ ok: false, reason: "other_consumer" });
  });

  it("spots a wrong picture code when the form comes back", () => {
    const form = `<form id="frmDomesticConsumNo"><img id="captchaimg" src="/captcha-image.jpg"><input name="txtCaptcha"></form>`;
    expect(readSngplPage(form, "12345678901")).toEqual({ ok: false, reason: "wrong_code" });
  });

  it("says when SNGPL has no record", () => {
    expect(readSngplPage("<p>No record found against this consumer.</p>", "12345678901")).toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps anything else as unreadable", () => {
    expect(readSngplPage("<p>Something else</p>", "12345678901")).toEqual({ ok: false, reason: "unreadable" });
  });
});
