import { test, expect } from "@playwright/test";
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  loadAndEnterLyrics,
  addUnderscoresToLyrics,
  toggleMagicSlashes,
} from "./utils";

test.describe("Lyrics Tab Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("Lyrics tab functionality - Add Underscore and Magic Slashes", async ({ page }) => {
    // 1. Navigate directly to Lyrics tab
    await navigateToTab(page, TabId.LyricInput);

    // 2. Add some test lyrics with repeated words
    const testLyrics =
      "Look at the stars look how they shine for you\nAnd everything you do yeah they were all yellow";
    await loadAndEnterLyrics(page, testLyrics);

    // 3. Test Add Underscores button
    await addUnderscoresToLyrics(page);

    // Verify spaces were converted to underscores
    const textAreaLocator = page.locator(".lyric-input-tab .lyric-editor-textarea");
    const convertedText = await textAreaLocator.inputValue();
    expect(convertedText).toBe(
      "Look_at_the_stars_look_how_they_shine_for_you\nAnd_everything_you_do_yeah_they_were_all_yellow",
    );

    // 4. Test Magic Slashes functionality
    // Verify the Magic Slashes checkbox is checked by default
    await expect(page.locator('.lyric-input-tab input[type="checkbox"]')).toBeChecked();

    // Add a slash in the word "Look" in the first occurrence
    await textAreaLocator.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight"); // Move to between 'L' and 'o'
    await page.keyboard.press("ArrowRight"); // Move to between 'o' and 'o'
    await page.keyboard.press("ArrowRight"); // Move to between 'o' and 'k'
    await page.keyboard.type("/");

    // Get the modified text to verify both instances of "look" have the slash
    const textWithSlashes = await textAreaLocator.inputValue();

    // Check that both instances of "look" have the slash in the same position
    expect(textWithSlashes).toContain("Loo/k_at_the_stars_loo/k_how_they_shine_for_you");

    // 5. Test adding a second slash to the same word
    await textAreaLocator.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight"); // Move to between 'L' and 'o'
    await page.keyboard.press("ArrowRight"); // Move to between 'o' and 'o'
    await page.keyboard.type("/");

    // Get the modified text to verify both instances now have two slashes
    const textWithTwoSlashes = await textAreaLocator.inputValue();

    // Check that both instances of "look" have both slashes in the same positions
    expect(textWithTwoSlashes).toContain("Lo/o/k_at_the_stars_lo/o/k_how_they_shine_for_you");

    // 6. Test behavior when Magic Slashes is unchecked
    // Create new lyrics for a clean test
    await loadAndEnterLyrics(page, "Hello hello hello");

    // Convert spaces to underscores
    await addUnderscoresToLyrics(page);
    expect(await textAreaLocator.inputValue()).toBe("Hello_hello_hello");

    // Uncheck the Magic Slashes checkbox
    await toggleMagicSlashes(page, false);
    await expect(page.locator('.lyric-input-tab input[type="checkbox"]')).not.toBeChecked();

    // Add a slash to the first "Hello"
    await textAreaLocator.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight"); // Move to between 'H' and 'e'
    await page.keyboard.press("ArrowRight"); // Move to between 'e' and 'l'
    await page.keyboard.type("/");

    // Get the modified text and verify the slash only appears in the first instance
    const textWithoutMagicSlashes = await textAreaLocator.inputValue();

    // Check that only the first "Hello" has a slash
    expect(textWithoutMagicSlashes).toBe("He/llo_hello_hello");
  });
});
