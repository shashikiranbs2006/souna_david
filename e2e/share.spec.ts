import { SEED_SHARE_TOKEN, en, expect, test } from './fixtures.ts';

test('the seeded share link renders a read-only snapshot', async ({ page }) => {
  await page.goto(`/s/${SEED_SHARE_TOKEN}`);
  await expect(page.getByText(en.shared.eyebrow, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Showroom offer: Espoo Compact' })).toBeVisible();
  await expect(page.getByText('Bronze glass door')).toBeVisible();
  // Read-only: no editing, no account. The visitor is pointed to the shop.
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.configure.saveDraft, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Alpha Spa/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: en.nav.login, exact: true })).toHaveCount(0);
});

test('an unknown share token shows the expired page', async ({ page }) => {
  await page.goto('/s/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await expect(page.getByRole('heading', { name: en.shared.expiredTitle })).toBeVisible();
});
