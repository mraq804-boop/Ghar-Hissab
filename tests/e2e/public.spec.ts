import { expect, test } from "@playwright/test";

test("signed-out visitors are sent to sign in with a return path", async ({ page }) => {
  await page.goto("/payments");
  await expect(page).toHaveURL(/\/login\?next=%2Fpayments/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("sign-in form validates before calling the server", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("someone@example.com");
  await page.locator("#password").fill("short");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("pages do not scroll sideways", async ({ page }) => {
  await page.goto("/login");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("export and sync endpoints refuse anonymous callers", async ({ request }) => {
  const sync = await request.post("/api/sync/run");
  expect([401, 503]).toContain(sync.status());
  const exp = await request.get("/api/export/report?type=monthly", { maxRedirects: 0 });
  expect([302, 303, 307, 401, 403]).toContain(exp.status());
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});
