import { ADMIN, en, expect, loginWithForm, test } from './fixtures.ts';

test('reseller admin logs in at /admin and sees the requests list', async ({ page }) => {
  await loginWithForm(page, '/admin', 'owner@alpha.test');
  await expect(page.getByRole('heading', { name: en.admin.title }).or(page.getByRole('navigation').getByText(en.admin.nav.dashboard))).toBeVisible();
  // The dashboard also links to the submitted requests once its data loads; use the menu entry.
  await page.getByRole('navigation').getByRole('link', { name: en.admin.nav.requests }).click();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Anna Virtanen' }).filter({ hasText: en.status.IN_REVIEW })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Anna Virtanen' }).filter({ hasText: en.status.QUOTED })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Ben Koskinen' }).filter({ hasText: en.status.SUBMITTED })).toHaveCount(1);
  // Tenant isolation in the UI: beta's request never shows up at alpha.
  await expect(rows.filter({ hasText: en.status.ACCEPTED })).toHaveCount(0);
});

test('manufacturer admin logs in at admin.localhost and sees the resellers', async ({ page }) => {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel(/^E-mail/).fill('admin@nordlicht.test');
  await page.getByLabel(/^Password/).fill('Sauna!2026');
  await page.getByRole('button', { name: new RegExp(`^(${en.manufacturer.login}|${en.auth.login})$`) }).click();
  // Wait for the signed-in shell: navigating right after the click would abort the login request.
  await expect(page.getByRole('navigation', { name: en.manufacturer.title })).toBeVisible();
  await page.goto(`${ADMIN}/resellers`);
  await expect(page.getByRole('heading', { name: en.manufacturer.resellers })).toBeVisible();
  for (const name of ['Alpha Spa & Sauna GmbH', 'Beta Wellness AG', 'Gamma Bastu AB']) {
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
  }
  await expect(page.getByRole('row').filter({ hasText: 'Gamma Bastu AB' }).getByText(en.status.SUSPENDED)).toBeVisible();
});

// The staff session lives in memory, so move inside the app instead of reloading the page.
const goInApp = (page: import('@playwright/test').Page, path: string) =>
  page.evaluate(p => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);

test('reseller admin opens a model in 3D from the list, configures it and makes a quote for a new contact', async ({ page }) => {
  await loginWithForm(page, '/admin', 'owner@alpha.test');
  // Configurations lists the models as cards; one click opens the configurator, full screen.
  await goInApp(page, '/admin/configurations');
  await page.locator('.scard__link').first().click();
  await expect(page.locator('.staff-shell__side')).toHaveCount(0);
  await expect(page.locator('.vslot__mark')).toHaveCount(0);
  const total = page.locator('.cfg__total');
  await expect(total).toContainText('€');
  const before = await total.innerText();
  const aspen = page.getByRole('radio', { name: /Thermo-aspen/ }).last();
  await aspen.click();
  await expect(total).not.toHaveText(before);
  await page.getByRole('button', { name: en.configure.saveDraft, exact: true }).click();
  await expect(page.getByText(en.configure.draftSaved)).toBeVisible();
  await expect(page.getByRole('button', { name: en.configure.sendRequest })).toHaveCount(0);

  // The picture of the 3D view comes back from the server stamped, as a PNG.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en.configure.downloadImage }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);

  // The customer's details are asked only now, at the end.
  await page.getByRole('button', { name: en.configure.makeQuote }).first().click();
  await page.getByRole('textbox', { name: new RegExp('^' + en.admin.contacts.personName) }).fill('E2E Keller');
  await page.getByRole('dialog').getByRole('button', { name: en.configure.makeQuote }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Q-\d+/ })).toBeVisible();
});
