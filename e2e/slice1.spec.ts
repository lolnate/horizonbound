import { expect, test } from "@playwright/test";
import { e2eBaseUrl, e2eSessionToken } from "./support";

test("connects cached source choices to one saved credible forecast", async ({ context, page }) => {
  await context.addCookies([
    {
      name: "horizonbound_session",
      value: e2eSessionToken,
      url: e2eBaseUrl,
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Configure your roadmap" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/Source refresh complete/i);
  await page.getByLabel("Plan name").fill("Launch roadmap");
  await page.getByLabel("Rolling horizon (weeks)").fill("12");
  await page.getByLabel("Weekly capacity (points)").fill("20");
  await page.getByLabel("Capacity effective date").fill("2026-09-14");
  await page.getByLabel("Refinement lead time (days)").fill("30");
  await page.getByLabel("Lane name").fill("Core delivery");
  await page.getByLabel("Weekly allocation").fill("20");
  await page.getByRole("button", { name: "Save plan and synchronize" }).click();

  await expect(page.getByRole("heading", { name: "Launch roadmap" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Example launch" })).toBeVisible();
  await expect(page.getByText("Completed actual").locator("..").getByText("5 pts")).toBeVisible();
  await expect(page.getByText("Detailed open").locator("..").getByText("11 pts")).toBeVisible();
  await expect(page.getByText(/1 open issue has no estimate/i)).toBeVisible();
  await expect(page.getByText(/possible double counting/i)).toBeVisible();

  await page.getByLabel("Unrefined low").fill("3");
  await page.getByLabel("Unrefined expected").fill("5");
  await page.getByLabel("Unrefined high").fill("7");
  await page.getByLabel("Estimate basis").fill("Team review");
  await page.getByLabel("Forecast as of").fill("2026-09-11");
  await page.getByLabel("Capacity lane").selectOption({ label: "Core delivery" });
  await page.getByLabel("Horizon share percent").fill("100");
  await page.getByLabel("Reason").fill("Initial planning baseline");
  await page.getByRole("button", { name: "Save forecast revision" }).click();

  await expect(
    page.getByText("Lifetime range").locator("..").getByText("19 / 21 / 23 points")
  ).toBeVisible();
  await expect(page.getByText("Horizon expected").locator("..").getByText("16 pts")).toBeVisible();
  await page.getByText(/Forecast history \(1\)/).click();
  await expect(page.getByText("Initial planning baseline")).toBeVisible();
  await expect(page.getByText(/Last successful full sync:/)).toBeVisible();
});
