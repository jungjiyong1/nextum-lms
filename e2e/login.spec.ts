import { expect, test } from '@playwright/test';

test('login form supports keyboard and pointer input without client errors', async ({ page }) => {
  const clientErrors: string[] = [];
  page.on('pageerror', (error) => clientErrors.push(error.message));

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'NEXTUM LMS' })).toBeVisible();

  const loginId = page.locator('#login-id');
  const password = page.locator('#password');
  const submit = page.locator('button[type="submit"]');

  await page.keyboard.press('Tab');
  await expect(loginId).toBeFocused();
  await page.keyboard.type('keyboard-user');
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await page.keyboard.type('secret-password');
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();

  await loginId.click();
  await loginId.fill('pointer-user');
  await expect(loginId).toHaveValue('pointer-user');

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expect(clientErrors).toEqual([]);
});
