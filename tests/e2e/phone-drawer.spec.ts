import { expect, test } from "@playwright/test";
import { setupTestEnvironment } from "./utils";

test.describe("Drawer on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("holds the tabs, the tab's settings and the global buttons, leaving Undo and Redo in the navbar", async ({
    page,
  }) => {
    const navbar = page.getByRole("navigation").first();
    const menu = navbar.getByRole("button", { name: "Menu" });
    const lyricsTab = page.getByRole("tab", { name: "Lyrics" });
    const instructions = page.getByRole("button", { name: "Instructions" });

    await expect(navbar.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(navbar.getByRole("button", { name: "Redo" })).toBeVisible();
    await expect(navbar.getByText("Intro", { exact: true })).toBeVisible();
    await expect(lyricsTab).toBeHidden();
    await expect(instructions).toBeHidden();

    await menu.tap();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(instructions).toBeHidden();
    await page.getByText("App", { exact: true }).tap();
    await expect(page.getByRole("button", { name: "Keyboard shortcuts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub" })).toBeVisible();
    await instructions.tap();
    await expect(instructions).toHaveAttribute("aria-pressed", "true");

    await lyricsTab.tap();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(lyricsTab).toBeHidden();
    await expect(navbar.getByText("Lyrics", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Song Lyrics" })).toBeVisible();

    await menu.tap();
    await expect(page.getByText("Lyrics settings")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Magic Slashes" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  });
});
