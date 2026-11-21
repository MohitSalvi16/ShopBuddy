// Gallery screenshots of the REAL running app (http://localhost:5173 -> live backend with Gemini/Murf/Agora).
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';

const OUT = new URL('../../docs/screenshots', import.meta.url).pathname.replace(/^/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

async function say(text) {
  for (const name of ['Close cart', 'Close conversation']) {
    const b = page.getByRole('button', { name });
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await wait(700); }
  }
  const replies = page.getByTestId('msg-assistant');
  const before = await replies.count();
  await page.getByPlaceholder(/Type in English, Hindi or Hinglish/).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  for (let i = 0; i < 90 && (await replies.count()) <= before; i++) await wait(500);
  await wait(1200); // let animations settle
  await wait(4000); // pace for the free Gemini per-minute limit
}
const shot = async (name, opts = {}) => { await page.screenshot({ path: `${OUT}/${name}.png`, ...opts }); console.log('saved', name); };
const scrollTo = async (locator) => { await locator.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -16)); await wait(500); };

// 1. Onboarding
await page.goto('http://localhost:5173/');
await wait(1800);
await shot('01-onboarding');

// 2. Deals + friendly tip (thumbnail)
await page.getByRole('button', { name: /Start shopping/i }).click();
await wait(1000);
await say('Bhai, ₹5,000 ke andar office calls ke liye best headphones chahiye.');
await page.evaluate(() => window.scrollTo(0, 0));
await wait(500);
await shot('02-best-deals-thumbnail');

// 3. Reviews: good + bad (click Reviews on the cheapest card)
const cheapestReviews = page.locator('div', { has: page.getByText('Cheapest', { exact: true }) }).getByRole('button', { name: /Reviews for/ }).last();
if (await cheapestReviews.isVisible().catch(() => false)) await cheapestReviews.click();
else await page.getByRole('button', { name: /Reviews for/ }).last().click();
await wait(1500);
await scrollTo(page.getByRole('region', { name: 'What buyers say' }));
await shot('03-reviews-good-and-bad');

// 4. Comparison
await say('Compare the first two.');
const cmp = page.getByText('Comparison', { exact: true });
if (await cmp.isVisible().catch(() => false)) { await scrollTo(cmp); await shot('04-comparison'); }

// 5. Cart drawer with confirmation
await say('Second wala cart mein add kar do aur coupon apply karo.');
if (!(await page.getByRole('dialog', { name: 'Cart' }).isVisible().catch(() => false))) await page.getByRole('button', { name: 'Open cart' }).click();
await wait(1200);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('05-cart-confirmation');

// 6. Order confirmation + rate
await say('Yes, confirm.');
await wait(1500);
if (await page.getByText('Demo order confirmed!').isVisible().catch(() => false)) {
  await page.getByRole('button', { name: 'Rate 5 stars' }).first().hover();
  await wait(600);
  await shot('06-order-confirmed-rate');
  await page.getByRole('button', { name: 'Continue shopping' }).click();
  await wait(800);
}

// 7. Conversation panel
await page.getByRole('button', { name: 'Open conversation' }).click();
await wait(1200);
await shot('07-conversation-panel');
await page.keyboard.press('Escape');
await wait(600);

// 8. Mobile
const m = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2 });
const mp = await m.newPage();
await mp.goto('http://localhost:5173/');
await wait(1200);
await mp.getByRole('button', { name: /Start shopping/i }).click();
await wait(800);
await mp.getByPlaceholder(/Type in English, Hindi or Hinglish/).fill('Headphones under 5000 for office calls');
await mp.getByRole('button', { name: 'Send' }).click();
for (let i = 0; i < 90 && (await mp.getByTestId('msg-assistant').count()) < 1; i++) await wait(500);
await wait(1500);
await mp.getByText('Best deals').scrollIntoViewIfNeeded();
await wait(600);
await mp.screenshot({ path: `${OUT}/08-mobile.png` });
console.log('saved 08-mobile');

await browser.close();
