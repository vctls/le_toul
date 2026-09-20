import { test, expect } from "@playwright/test";
import { setupTestEnvironment, navigateToTab, fieldFor, radioFor, TabId } from "./utils";

test.describe("Count-In Settings", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.Submit);
  });

  test("count-ins are on a screen's first line by default", async ({ page }) => {
    await expect(radioFor(page, "Count-Ins", "screen")).toBeChecked();
  });

  test("the count-in fields are only shown when count-ins are on", async ({ page }) => {
    // This probes Count-In Gap rather than Count-In Text, because the text field is itself hidden
    // while count-ins are dynamic, which they are by default.
    await expect(fieldFor(page, "Count-In Gap")).toBeVisible();

    // The real radio sits under Buefy's own markup, so click its button instead.
    await fieldFor(page, "Count-Ins").locator("label.button", { hasText: "None" }).click();
    await expect(radioFor(page, "Count-Ins", "none")).toBeChecked();

    await expect(fieldFor(page, "Count-In Gap")).toBeHidden();

    await fieldFor(page, "Count-Ins").locator("label.button", { hasText: "Line start" }).click();
    await expect(radioFor(page, "Count-Ins", "line")).toBeChecked();
    await expect(fieldFor(page, "Count-In Gap")).toBeVisible();
  });

  test("lowering the count-in gap pulls the count-in length down with it", async ({ page }) => {
    // Count-In Length only applies to a fixed-length count-in, so turn dynamic ones off.
    await fieldFor(page, "Dynamic Count-Ins").locator(".switch").click();

    const gap = fieldFor(page, "Count-In Gap").locator('input[type="number"]');
    const length = fieldFor(page, "Count-In Length").locator('input[type="number"]');
    await expect(gap).toHaveValue("3");
    await expect(length).toHaveValue("2");

    await gap.fill("1.5");
    await gap.blur();

    await expect(length).toHaveValue("1.5");
  });
});
