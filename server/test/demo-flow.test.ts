import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(os.tmpdir(), `vaanicart-test-${Date.now()}.db`);
process.env.SKIP_DOTENV = '1';
process.env.LLM_API_KEY = ''; // force deterministic rule engine

const { seedCatalog } = await import('../src/db.js');
const { runTurn } = await import('../src/agent.js');
const shop = await import('../src/shop.js');
seedCatalog();

test('required demo conversation works end-to-end against SQLite', async () => {
  const sid = 'test-session-' + Date.now();
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  const say = async (text: string) => {
    history.push({ role: 'user', content: text });
    const { reply } = await runTurn(sid, history);
    history.push({ role: 'assistant', content: reply });
    console.log(`  U: ${text}\n  A: ${reply}`);
    return reply;
  };

  const r1 = await say('Hi Vaani, mujhe ₹3,000 ke andar wireless earbuds chahiye.');
  assert.match(r1, /battery/i);

  await say('Battery life achhi honi chahiye.');
  const shown = shop.sessionState(sid).shown.map((id) => shop.getProduct(id));
  assert.equal(shown.length, 3);
  assert.ok(shown.every((p) => p.category === 'earbuds' && p.price <= 3000 && p.stock > 0));
  // display order: best pick first; cheapest option always included (for the friendly tip)
  assert.ok(shown.some((p) => p.price === Math.min(...shown.map((x) => x.price))));
  assert.ok(Number(shown[0].specs.battery_hours) >= 40, 'best pick has strong battery');

  const r3 = await say('Compare the first two.');
  assert.match(r3, new RegExp(shown[0].name));

  await say('Second wala cart mein add karo.');
  let cart = shop.getCart(sid);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].product_id, shown[1].id);

  const r5 = await say('Koi discount hai?');
  cart = shop.getCart(sid);
  assert.ok(cart.discount > 0, 'coupon applied');
  assert.match(r5, /WELCOME10|SAVE200/);
  assert.match(r5, new RegExp(cart.total.toLocaleString('en-IN')), 'reply quotes backend total');

  const r6 = await say('Order place kar do.');
  assert.match(r6, /confirm/i);
  assert.equal(shop.latestOrders(sid).length, 0, 'no order before confirmation');

  const r7 = await say('Yes, confirm.');
  const orders = shop.latestOrders(sid);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'CONFIRMED');
  assert.equal(orders[0].total, cart.total);
  assert.match(r7, /order/i);
  assert.equal(shop.getProduct(shown[1].id).stock, shown[1].stock - 1, 'stock decremented');
});

test('coupon rules', () => {
  const sid = 'coupon-session-' + Date.now();
  shop.addToCart(sid, 'EB-101', 1); // 1299
  assert.throws(() => shop.applyCoupon(sid, 'SAVE200'), /above/);
  const w = shop.applyCoupon(sid, 'welcome10');
  assert.equal(w.savings, 130);
  shop.addToCart(sid, 'HP-204', 1); // big cart -> WELCOME10 capped at 500
  assert.equal(shop.getCart(sid).discount, 500);
});

test('createOrder(true) without prior summary is refused', () => {
  const sid = 'confirm-session-' + Date.now();
  shop.addToCart(sid, 'AC-503', 1);
  const r = shop.createOrder(sid, true);
  assert.equal(r.status, 'AWAITING_CONFIRMATION');
  assert.equal(shop.createOrder(sid, true).status, 'ORDER_PLACED');
});
