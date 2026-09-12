import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  navigateToTab,
  fieldFor,
  switchFor,
  TabId,
} from './utils';

test.describe('Count-In Settings', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.Submit);
  });

  test('the count-in fields are only shown when count-ins are on', async ({ page }) => {
    await expect(fieldFor(page, 'Count-In Text')).toBeVisible();

    // The real checkbox sits under Buefy's own markup, so click the switch itself.
    await fieldFor(page, 'Add Count-Ins').locator('.switch').click();
    await expect(switchFor(page, 'Add Count-Ins')).not.toBeChecked();

    await expect(fieldFor(page, 'Count-In Text')).toBeHidden();
  });

  test('lowering the count-in gap pulls the count-in length down with it', async ({ page }) => {
    const gap = fieldFor(page, 'Count-In Gap').locator('input[type="number"]');
    const length = fieldFor(page, 'Count-In Length').locator('input[type="number"]');
    await expect(gap).toHaveValue('5');
    await expect(length).toHaveValue('2');

    await gap.fill('1.5');
    await gap.blur();

    await expect(length).toHaveValue('1.5');
  });
});
