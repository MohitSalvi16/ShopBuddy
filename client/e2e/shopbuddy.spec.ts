import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });

/** Fail the test on any uncaught page error or console.error (this is what caught the VoicePanel crash). */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  return errors;
}

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Start shopping/i })).toBeVisible();
  await page.getByRole('button', { name: /Start shopping/i }).click();
  await expect(page.getByPlaceholder(/Type in English, Hindi or Hinglish/)).toBeVisible();
  await expect(page.getByText('Live sync')).toBeVisible(); // SSE connected
}

async function say(page: Page, text: string) {
  const replies = page.getByTestId('msg-assistant');
  const before = await replies.count();
  // A drawer (cart / conversation) may have opened itself; close it like a user would before typing.
  for (const name of ['Close cart', 'Close conversation']) {
    const btn = page.getByRole('button', { name });
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => { /* already closing (exit animation) */ });
      await expect(btn).toBeHidden();
    }
  }
  await page.getByPlaceholder(/Type in English, Hindi or Hinglish/).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('msg-user').last()).toContainText(text.slice(0, 20));
  await expect.poll(async () => replies.count(), { timeout: 15_000 }).toBeGreaterThan(before);
  return (await replies.last().innerText()).trim();
}

test('onboarding renders brand and capability badges', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/ShopBuddy/);
  await expect(page.getByText('shopping buddy', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Friendly tips')).toBeVisible();
  await expect(page.getByText(/Agora: lite mode/)).toBeVisible(); // hermetic backend has no Agora keys
  await page.screenshot({ path: `${SHOTS}/01-onboarding.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('REQUIRED DEMO: search → friendly tip → compare → add + coupon → confirm → order', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);

  const r1 = await say(page, 'Bhai, ₹5,000 ke andar office calls ke liye best headphones chahiye.');
  expect(r1).toMatch(/best pick/i);
  const cards = page.getByRole('button', { name: /Add to cart/ });
  await expect(cards).toHaveCount(3);
  await expect(page.getByText('Best deals')).toBeVisible();
  await expect(page.getByText('Best pick', { exact: true })).toBeVisible();
  await expect(page.getByText('Cheapest', { exact: true })).toBeVisible();
  await expect(page.getByText('Friendly tip', { exact: true })).toBeVisible();
  await expect(page.getByText('Worth a look')).toBeVisible();
  const tip = await page.getByText(/^Friendly tip: /).innerText();
  expect(tip, 'rupees must be Indian-formatted').not.toMatch(/₹\d{4,}/);
  expect(tip).toMatch(/₹\d{1,3}(,\d{2,3})+/);
  await expect(page.getByText(/Budget & savings/i)).toBeVisible();
  await expect(page.getByText('find_best_deal').first()).toBeVisible(); // tool log
  await page.screenshot({ path: `${SHOTS}/02-deals.png`, fullPage: true });

  // score explanation expands
  await page.getByText('Why this score?').first().click();
  await expect(page.getByText('Requirement').first()).toBeVisible();

  const r2 = await say(page, 'Compare the first two.');
  expect(r2).toMatch(/microphone|mic/i);
  await expect(page.getByText('Comparison', { exact: true })).toBeVisible();
  await expect(page.getByText('Mic quality /10')).toBeVisible();
  await expect(page.getByText('Final price (verified coupon)')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-compare.png`, fullPage: true });

  const r3 = await say(page, 'Second wala cart mein add kar do aur coupon apply karo.');
  expect(r3).toMatch(/WELCOME10|SAVE200/);
  expect(r3).toMatch(/confirm/i);
  // checkout summary opens the cart drawer automatically
  const drawer = page.getByRole('dialog', { name: 'Cart' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Awaiting your confirmation')).toBeVisible();
  await expect(drawer.getByText(/Discount \(WELCOME10|Discount \(SAVE200/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open cart' })).toContainText('1');
  await page.waitForTimeout(900); // let the drawer's slide-in spring settle before capturing
  await page.screenshot({ path: `${SHOTS}/04-cart-drawer.png` });
  await page.getByRole('button', { name: 'Close cart' }).click();

  const r4 = await say(page, 'Yes, confirm.');
  const orderId = r4.match(/VC-\d{6}-[A-Z0-9]{4}/)?.[0];
  expect(orderId, r4).toBeTruthy();
  const modal = page.getByText('Demo order confirmed!');
  await expect(modal).toBeVisible();
  await expect(page.getByText(orderId!).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-order.png`, fullPage: true });
  await page.getByRole('button', { name: 'Continue shopping' }).click();
  await expect(modal).toBeHidden();

  // repeated confirmation must not create a duplicate
  const r5 = await say(page, 'Yes, confirm.');
  expect(r5).toMatch(/already|No duplicate/i);
  const orders = await page.evaluate(async () => (await fetch('/api/orders', { headers: { 'x-session-id': localStorage.getItem('parakh.session') ?? '' } })).json());
  expect(orders).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('UI buttons drive real backend actions: add, coupon, remove, confirm', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await say(page, 'headphones under 5000 for office calls');
  await page.getByRole('button', { name: /Add to cart/ }).first().click();
  await expect(page.getByRole('button', { name: 'Open cart' })).toContainText('1');
  await page.getByRole('button', { name: 'Open cart' }).click();
  const drawer = page.getByRole('dialog', { name: 'Cart' });
  await drawer.getByRole('button', { name: 'WELCOME10' }).click();
  await expect(drawer.getByText(/Discount \(WELCOME10\)/)).toBeVisible();
  // invalid coupon via chip (SAVE200 may be ineligible for cheap carts) never crashes the page
  await drawer.getByRole('button', { name: /^Remove / }).click();
  await expect(drawer.getByText(/Cart is empty/)).toBeVisible();
  // add again and check out via the confirm button
  await page.getByRole('button', { name: 'Close cart' }).click();
  await page.getByRole('button', { name: /Add to cart/ }).first().click();
  await expect(page.getByRole('button', { name: 'Open cart' })).toContainText('1');
  const r = await say(page, 'Order place kar do.');
  expect(r).toMatch(/confirm/i); // backend produced the official summary
  if (!(await drawer.isVisible())) await page.getByRole('button', { name: 'Open cart' }).click();
  await expect(drawer.getByRole('button', { name: 'Confirm order' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Confirm order' }).click();
  await expect(page.getByText('Demo order confirmed!')).toBeVisible();
  expect(errors).toEqual([]);
});

test('friendly tip on "buy the cheapest" does not add anything', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await say(page, 'Calling ke liye chahiye, gaming ke liye nahi. Headphones, budget 5000.');
  const r = await say(page, 'Buy the cheapest headphones.');
  expect(r).toMatch(/friendly tip/i);
  expect(r).toMatch(/compare/i);
  await expect(page.getByRole('button', { name: 'Open cart' })).not.toContainText(/\d/);
  expect(errors).toEqual([]);
});

test('errors are explained, not hidden', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const r1 = await say(page, 'Apply coupon FREE999.');
  expect(r1).toMatch(/does not exist|nahi laga|not applied/i);
  const r2 = await say(page, 'Add HP-210 to my cart please.');
  expect(r2).toMatch(/out of stock/i);
  await expect(page.getByText('apply_coupon').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('session survives a page reload (cart persisted in SQLite)', async ({ page }) => {
  await openApp(page);
  await say(page, 'headphones under 5000 for office calls');
  await page.getByRole('button', { name: /Add to cart/ }).first().click();
  await expect(page.getByRole('button', { name: 'Open cart' })).toContainText('1');
  await page.reload();
  await page.getByRole('button', { name: /Start shopping/i }).click();
  await expect(page.getByRole('button', { name: 'Open cart' })).toContainText('1');
});

test('voice mode toggle reflects backend capabilities', async ({ page }) => {
  await openApp(page);
  const agoraBtn = page.getByRole('button', { name: 'Agora Live' });
  await expect(agoraBtn).toBeDisabled(); // hermetic backend: no Agora keys
  await expect(agoraBtn).toHaveAttribute('title', /Missing:/);
  await expect(page.getByRole('button', { name: 'Lite voice' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Start conversation/ })).toBeVisible();
});

test('mobile layout: no horizontal scroll, full journey usable @mobile', async ({ page }, info) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-m1-onboarding.png`, fullPage: true });
  await page.getByRole('button', { name: /Start shopping/i }).click();
  await say(page, 'headphones under 5000 for office calls');
  await expect(page.getByRole('button', { name: /Add to cart/ })).toHaveCount(3);
  // Compare with the physical screen width: mobile Chrome widens innerWidth to fit overflow, hiding the bug.
  const m = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, innerW: window.innerWidth, screenW: screen.width }));
  expect(m.docW, `page wider than the phone screen: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.screenW + 1);
  expect(m.innerW, `layout viewport was widened by overflowing content: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.screenW + 1);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-m2-deals.png`, fullPage: true });
  await page.getByRole('button', { name: /Add to cart/ }).first().click();
  await page.getByRole('button', { name: 'Open cart' }).click();
  await page.waitForTimeout(900);
  const d = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, screenW: screen.width }));
  expect(d.docW, 'cart drawer must fit the phone').toBeLessThanOrEqual(d.screenW + 1);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-m3-cart.png` });
  expect(errors).toEqual([]);
});

test('language selector: English forces English replies, choice survives reload, hint updates', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const group = page.getByRole('radiogroup', { name: 'Reply language' });
  await expect(group.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
  await group.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByText('Replies in English')).toBeVisible();
  const r = await say(page, 'Bhai 5000 ke andar office calls ke liye headphones chahiye');
  expect(r).toMatch(/I found|best pick/i);
  expect(r).not.toMatch(/\bmile\b|best pick hai/);
  await group.getByRole('radio', { name: 'Hinglish' }).click();
  const r2 = await say(page, 'Compare the first two.');
  expect(r2).toMatch(/mein|aage hai/);
  await group.getByRole('radio', { name: 'हिंदी' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Start shopping/i }).click();
  await expect(page.getByRole('radiogroup', { name: 'Reply language' }).getByRole('radio', { name: 'हिंदी' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/हिंदी में जवाब/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('conversation side panel: full history, timestamps, download, Escape closes', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await say(page, 'headphones under 5000 for office calls');
  await say(page, 'Compare the first two.');
  const btn = page.getByRole('button', { name: 'Open conversation' });
  await expect(btn).toContainText('4'); // 2 user + 2 assistant lines
  await btn.click();
  const panel = page.getByRole('dialog', { name: 'Conversation' });
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('conv-user')).toHaveCount(2);
  await expect(panel.getByTestId('conv-assistant')).toHaveCount(2);
  await expect(panel.getByText('headphones under 5000 for office calls')).toBeVisible();
  await expect(panel.getByText(/\d{1,2}:\d{2}/).first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download conversation' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^shopbuddy-conversation-.*\.txt$/);
  const txt = fs.readFileSync(await download.path(), 'utf8');
  expect(txt).toContain('You (text): headphones under 5000 for office calls');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/06-conversation-panel.png` });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('reviews: ask about a product → good AND bad; card Reviews button; rate after purchase', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await say(page, 'headphones under 5000 for office calls');
  await expect(page.getByTestId('review-line').first()).toBeVisible(); // praise/complaint line on deal cards
  const r = await say(page, 'Teesra wala kaisa hai?');
  expect(r).toMatch(/rating 3\.8★/);
  expect(r).toMatch(/Shikayat: microphone on calls/);
  const panel = page.getByRole('region', { name: 'What buyers say' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Mostly negative')).toBeVisible();
  await expect(panel.getByText('Buyers like')).toBeVisible();
  await expect(panel.getByText('Common complaints')).toBeVisible();
  await expect(panel.getByText('major').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-reviews.png`, fullPage: true });
  // Reviews button on the best-pick card switches the panel to that product
  await page.getByRole('button', { name: /Reviews for H390 USB Headset/ }).click();
  await expect(panel.getByText('Logitech H390 USB Headset')).toBeVisible();
  await expect(panel.getByText('Mostly positive')).toBeVisible();
  // buy it, then rate from the order confirmation
  await say(page, 'Pehla wala cart mein add karo');
  await say(page, 'Yes, confirm.');
  await expect(page.getByText('Demo order confirmed!')).toBeVisible();
  await page.getByRole('button', { name: 'Rate 5 stars' }).click();
  await expect(page.getByText('Thanks! You rated it 5★', { exact: true })).toBeVisible(); // order card
  await expect(page.getByText(/new average \d\.\d{2}★/)).toBeVisible(); // reviews panel updated live
  await page.screenshot({ path: `${SHOTS}/08-rate.png` });
  await page.getByRole('button', { name: 'Continue shopping' }).click();
  expect(errors).toEqual([]);
});
