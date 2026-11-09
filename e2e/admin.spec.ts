import { de, en, expect, loginWithForm, test } from './fixtures.ts';

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

test('reseller admin sends a customer link, then makes a quote from the same configurator', async ({ page }) => {
  await loginWithForm(page, '/admin', 'owner@alpha.test');
  await goInApp(page, '/admin/configurations');
  await page.locator('.scard__link').first().click();
  await expect(page.locator('.cfg__total')).toContainText('€');

  // The customer link saves and locks the sauna at its price.
  await page.getByRole('button', { name: en.admin.customerLink.button }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.admin.customerLink.create }).click();
  await expect(page.getByRole('dialog').locator('.once-box__url code')).toContainText('/s/');
  await page.getByRole('dialog').getByRole('button', { name: en.common.close }).first().click();
  const linked = new URL(page.url()).searchParams.get('id');
  expect(linked).toBeTruthy();

  // Quoting it unchanged quotes that same sauna instead of failing with "locked".
  await page.getByRole('button', { name: en.configure.makeQuote }).first().click();
  await page.getByRole('textbox', { name: new RegExp('^' + en.admin.contacts.personName) }).fill('E2E Link First');
  await page.getByRole('dialog').getByRole('button', { name: en.configure.makeQuote }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Q-\d+/ })).toBeVisible();

  // Changing it after the link saves a new sauna; the link keeps showing the old one.
  await page.goBack();
  await expect(page.getByText(en.configure.sharedCopy)).toBeVisible();
  const total = page.locator('.cfg__total');
  const before = await total.innerText();
  await page.getByRole('radio', { name: /Thermo-aspen/ }).last().click();
  await expect(total).not.toHaveText(before);
  await page.getByRole('button', { name: en.configure.makeQuote }).first().click();
  await page.getByRole('textbox', { name: new RegExp('^' + en.admin.contacts.personName) }).fill('E2E Link Changed');
  await page.getByRole('dialog').getByRole('button', { name: en.configure.makeQuote }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Q-\d+/ })).toBeVisible();
});

test('switching the language in the admin translates the whole menu and keeps the picker on screen', async ({ page }) => {
  await loginWithForm(page, '/admin', 'owner@alpha.test');
  const nav = page.getByRole('navigation').first();
  await expect(nav).toContainText(en.admin.nav.requests);
  await page.getByRole('button', { name: new RegExp(en.nav.language) }).first().click();
  const menu = page.getByRole('menu');
  const box = (await menu.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await menu.getByRole('menuitemradio', { name: /Deutsch/ }).click();
  await expect(nav).toContainText(de.admin.nav.requests);
  // Neither the visible label nor its screen-reader twin may keep the English text.
  for (const key of ['dashboard', 'requests', 'contacts', 'quotes', 'invoices'] as const) {
    if (de.admin.nav[key] !== en.admin.nav[key]) await expect(nav).not.toContainText(en.admin.nav[key]);
  }
});
