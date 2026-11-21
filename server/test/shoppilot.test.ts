import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(os.tmpdir(), `shoppilot-test-${Date.now()}-${process.pid}.db`);
process.env.SKIP_DOTENV = '1'; // hermetic: no real keys, no network
process.env.LLM_API_KEY = ''; // deterministic rule engine

const { seedCatalog } = await import('../src/db.js');
const { runTurn } = await import('../src/agent.js');
const { executeTool, TOOL_DEFS, TOOL_CATALOG } = await import('../src/tools.js');
const { findBestDeal, WEIGHTS } = await import('../src/recommend.js');
const shop = await import('../src/shop.js');
seedCatalog();

let n = 0;
const sid = () => `t${Date.now()}x${n++}`;

function convo(id: string) {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  return async (text: string) => {
    history.push({ role: 'user', content: text });
    const r = await runTurn(id, history);
    history.push({ role: 'assistant', content: r.reply });
    console.log(`  U: ${text}\n  A: ${r.reply}`);
    return r.reply;
  };
}

test('REQUIRED DEMO: Hinglish office-calls headphones -> critic -> add + coupon -> confirm -> order', async () => {
  const id = sid();
  const say = convo(id);
  const r1 = await say('Bhai, ₹5,000 ke andar office calls ke liye best headphones chahiye.');
  const shown = shop.sessionState(id).shown.map((x) => shop.getProduct(x));
  assert.equal(shown.length, 3);
  assert.ok(shown.every((p) => p.category === 'headphones' && p.stock > 0));
  assert.match(r1, /mic/i, 'critic mentions microphone trade-off');

  const before = shop.latestOrders(id).length;
  const r2 = await say('Second wala cart mein add kar do aur coupon apply karo.');
  const cart = shop.getCart(id);
  assert.equal(cart.items[0].product_id, shown[1].id, 'second card added');
  assert.ok(cart.discount > 0 && cart.coupon?.valid);
  assert.match(r2, new RegExp(cart.total.toLocaleString('en-IN')), 'reply quotes backend-computed total');
  assert.match(r2, /checkout/i);
  assert.equal(shop.latestOrders(id).length, before, 'no order before confirmation');

  const r3 = await say('Yes, confirm.');
  const orders = shop.latestOrders(id);
  assert.equal(orders.length, 1);
  assert.match(r3, new RegExp(orders[0].order_id));
  assert.equal(orders[0].total, cart.total);

  // repeated confirmation must NOT create a duplicate
  const r4 = await say('Yes, confirm.');
  assert.equal(shop.latestOrders(id).length, 1);
  assert.match(r4, /already|pehle hi/i);
});

test('budget negotiator: hard constraints, weights, structured output, not just cheapest', () => {
  const r = findBestDeal(sid(), { category: 'headphones', budget: 5000, use_case: 'calls' });
  assert.deepEqual(WEIGHTS, { requirement: 0.4, quality: 0.25, value: 0.2, preference: 0.15 });
  for (const d of r.recommendations) {
    assert.ok(d.final_price <= 5000, 'budget respected after coupon');
    assert.ok(d.stock > 0, 'in stock');
    assert.equal(d.final_price, d.price - d.discount);
    for (const k of ['product_id', 'price', 'discount', 'final_price', 'scores', 'advantages', 'disadvantages', 'reasoning']) assert.ok(k in d, k);
  }
  assert.ok(r.excluded.some((e) => /out of stock/.test(e.reason)), 'out-of-stock excluded (Zone Vibe 100)');
  assert.ok(r.excluded.some((e) => /over budget/.test(e.reason)), 'over-budget excluded');
  const best = r.recommendations.find((d) => d.tags.includes('best_pick'))!;
  const cheapest = r.recommendations.find((d) => d.tags.includes('cheapest'))!;
  assert.notEqual(best.product_id, cheapest.product_id, 'best pick is not simply the cheapest');
  assert.ok(Number(shop.getProduct(best.product_id).specs.mic_score) >= 8, 'calls -> strong mic wins');
  assert.equal(r.devils_advocate?.verdict, 'reconsider');
  assert.ok(r.devils_advocate!.concerns.some((c: string) => /microphone/i.test(c)), 'critique grounded in mic_score');
  // deterministic
  const again = findBestDeal(sid(), { category: 'headphones', budget: 5000, use_case: 'calls' });
  assert.deepEqual(again.recommendations.map((d) => d.scores.total), r.recommendations.map((d) => d.scores.total));
});

test("devil's advocate: 'buy the cheapest' is challenged, not blindly executed", async () => {
  const id = sid();
  const say = convo(id);
  await say('Calling ke liye chahiye, gaming ke liye nahi. Headphones, budget 5000.');
  assert.equal(shop.sessionState(id).goal.use_case, 'calls');
  assert.deepEqual(shop.sessionState(id).goal.exclude_use_cases, ['gaming']);
  const r = await say('Buy the cheapest headphones.');
  assert.match(r, /cheapest|sasta/i);
  assert.match(r, /compare/i);
  assert.equal(shop.getCart(id).items.length, 0, 'nothing added without the customer deciding');
});

test('goal-based: WFH meetings -> infers headphones, asks budget, then recommends; "cheaper" uses context', async () => {
  const id = sid();
  const say = convo(id);
  const r1 = await say('I work from home and attend meetings all day. I need something comfortable.');
  assert.match(r1, /budget/i);
  assert.equal(shop.sessionState(id).goal.category, 'headphones');
  await say('Around 5000.');
  const st = shop.sessionState(id);
  assert.equal(st.shown.length, 3);
  const focus = shop.getProduct(st.focusId!);
  await say('Isse sasta kuch hai?');
  const cheaper = shop.sessionState(id).shown.map((x) => shop.getProduct(x));
  assert.ok(cheaper.length > 0 && cheaper.every((p) => p.price < focus.price), 'all cheaper than the product in focus');
});

test('Devanagari Hindi input is understood (normalised) by the rule engine', async () => {
  const id = sid();
  const say = convo(id);
  await say('मुझे ५००० के अंदर ऑफिस कॉल के लिए हेडफोन चाहिए');
  const g = shop.sessionState(id).goal;
  assert.equal(g.category, 'headphones');
  assert.equal(g.budget, 5000);
  assert.equal(g.use_case, 'calls');
  assert.equal(shop.sessionState(id).shown.length, 3);
});

test('tools: schemas, validation, structured errors', () => {
  const names = TOOL_DEFS.map((t) => t.function.name);
  for (const req of ['search_products', 'compare_products', 'check_inventory', 'find_best_coupon', 'add_to_cart', 'apply_coupon', 'get_cart', 'create_demo_order']) assert.ok(names.includes(req as any), req);
  assert.ok(TOOL_CATALOG.every((t) => t.input_schema && t.output_schema));
  const id = sid();
  const bad = executeTool(id, 'add_to_cart', { quantity: 2 });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.error.code, 'INVALID_INPUT');
  const oos = executeTool(id, 'add_to_cart', { product_id: 'HP-210' });
  assert.equal(!oos.ok && oos.error.code, 'OUT_OF_STOCK', 'out-of-stock cannot be purchased');
  const missing = executeTool(id, 'get_product_details', { product_id: 'XX-999' });
  assert.equal(!missing.ok && missing.error.code, 'NOT_FOUND');
  executeTool(id, 'add_to_cart', { product_id: 'EB-101' });
  const fake = executeTool(id, 'apply_coupon', { coupon_code: 'FREE100' });
  assert.equal(!fake.ok && fake.error.code, 'COUPON_INVALID', 'invalid coupon rejected');
  const inel = executeTool(id, 'apply_coupon', { coupon_code: 'SAVE200' }); // cart 1299 < 2000
  assert.equal(!inel.ok && inel.error.code, 'COUPON_INVALID', 'ineligible coupon rejected');
  const unknown = executeTool(id, 'hack_the_db', {});
  assert.equal(!unknown.ok && unknown.error.code, 'UNKNOWN_TOOL');
});

test('compare uses actual catalog data; find_best_coupon is backend-verified', () => {
  const id = sid();
  const c = executeTool(id, 'compare_products', { product_ids: ['HP-206', 'HP-209'] });
  assert.ok(c.ok);
  if (c.ok) {
    assert.equal(c.data.products[0].specs.mic_score, shop.getProduct('HP-206').specs.mic_score);
    assert.equal(c.data.winners.mic_score, 'HP-209');
  }
  const fc = executeTool(id, 'find_best_coupon', { product_id: 'HP-209' });
  assert.ok(fc.ok && fc.data.best_coupon.code === 'WELCOME10' && fc.data.best_coupon.discount === 500);
});

test('checkout safety: confirmation required, total change detected, no duplicates', () => {
  const id = sid();
  shop.addToCart(id, 'HP-206', 1);
  const first = executeTool(id, 'create_demo_order', { confirmed: true });
  assert.ok(first.ok && first.data.status === 'AWAITING_CONFIRMATION', 'confirmed=true without summary only arms');
  const total = shop.getCart(id).total;
  const wrong = executeTool(id, 'create_demo_order', { confirmed: true, expected_total: total + 1 });
  assert.equal(!wrong.ok && wrong.error.code, 'CART_CHANGED');
  executeTool(id, 'create_demo_order', { confirmed: false });
  const placed = executeTool(id, 'create_demo_order', { confirmed: true, expected_total: total });
  assert.ok(placed.ok && placed.data.status === 'ORDER_PLACED');
  const dup = executeTool(id, 'create_demo_order', { confirmed: true, expected_total: total });
  assert.ok(dup.ok && dup.data.status === 'ALREADY_PLACED');
  assert.equal(shop.latestOrders(id).length, 1);
});

test('voice and text share session state (same session id, different channels)', async () => {
  const id = sid();
  await runTurn(id, [{ role: 'user', content: 'Headphones under 5000 for office calls' }], 'agora');
  const shownByVoice = [...shop.sessionState(id).shown];
  assert.equal(shownByVoice.length, 3);
  await runTurn(id, [{ role: 'user', content: 'Second wala cart mein add kar do' }], 'text');
  assert.equal(shop.getCart(id).items[0].product_id, shownByVoice[1]);
});

test('speakable(): strips markdown/tables/emojis/IDs so TTS reads clean text', async () => {
  const { speakable } = await import('../src/agent.js');
  const raw = '### Verdict\n| A | B |\n| :--- | :--- |\n| x | y |\n- **Jabra Evolve2 30 SE** (HP-209) – **₹4,499** 🎉\n1. Logitech `H390` is good!';
  const out = speakable(raw);
  assert.doesNotMatch(out, /[*|#`]|HP-209|🎉/u);
  assert.match(out, /Jabra Evolve2 30 SE – ₹4,499/);
  assert.match(out, /Logitech H390 is good!/);
});

test('LLM cannot arm and confirm an order inside the same turn', () => {
  const id = sid();
  shop.addToCart(id, 'AC-503', 1);
  const st = shop.sessionState(id);
  st.turn = 7; st.inTurn = true;
  executeTool(id, 'create_demo_order', { confirmed: false });
  const sameTurn = executeTool(id, 'create_demo_order', { confirmed: true });
  assert.ok(sameTurn.ok && sameTurn.data.status === 'AWAITING_CONFIRMATION', 'blocked in same turn');
  st.turn = 8; // customer replies "yes" in the next turn
  const next = executeTool(id, 'create_demo_order', { confirmed: true });
  assert.ok(next.ok && next.data.status === 'ORDER_PLACED');
  st.inTurn = false;
});

test('capForVoice keeps it short but preserves order ID and closing question', async () => {
  const { capForVoice } = await import('../src/agent.js');
  const long = 'Great news. ' + 'This sentence adds lots of extra spoken detail for the customer. '.repeat(10) + 'Order ID VC-261121-AB12 is confirmed. Kuch aur chahiye?';
  const out = capForVoice(long);
  assert.ok(out.split(/\s+/).length < 75);
  assert.match(out, /VC-261121-AB12/);
  assert.match(out, /Kuch aur chahiye\?$/);
});

test('capForVoice does not split decimals like 9.5/10', async () => {
  const { capForVoice } = await import('../src/agent.js');
  const t = 'Jabra has a 9.5/10 mic and 8.5/10 comfort. ' + 'More words to make this long enough for the cap. '.repeat(12) + 'Add it?';
  const out = capForVoice(t);
  assert.match(out, /9\.5\/10 mic and 8\.5\/10 comfort\./);
  assert.doesNotMatch(out, /\d\. \d/);
});

test('capForVoice never leaves stray brackets', async () => {
  const { capForVoice } = await import('../src/agent.js');
  const t = 'Nord Buds 3 is great (43h battery). ' + 'Extra detail words for the cap here. '.repeat(12) + 'It has (8.5/10 sound and more. ) Want it?';
  const out = capForVoice(t);
  assert.equal((out.match(/\(/g) ?? []).length, (out.match(/\)/g) ?? []).length);
  assert.doesNotMatch(out, /\s\)/);
});

test('capForVoice clips a single run-on sentence (flattened list) and keeps the question', async () => {
  const { capForVoice } = await import('../src/agent.js');
  const runOn = 'Here are the best earbuds under ₹3,000 with great battery life: ' + 'OnePlus Nord Buds 3 Battery 43 hours Price ₹2,069 after coupon Rating 4.4, '.repeat(8) + 'Would you like to add one to your cart?';
  const out = capForVoice(runOn);
  assert.ok(out.split(/\s+/).length <= 60, `too long: ${out.split(/\s+/).length} words`);
  assert.match(out, /Would you like to add one to your cart\?$/);
});

test('language preference: English choice overrides Hinglish input; Hinglish choice overrides English input', async () => {
  const a = sid();
  shop.sessionState(a).language = 'en';
  const en = (await runTurn(a, [{ role: 'user', content: 'Bhai 5000 ke andar office calls ke liye headphones chahiye' }])).reply;
  assert.match(en, /I found|best pick/i);
  assert.doesNotMatch(en, /\bmile\b|\bhai\b/);
  const b = sid();
  shop.sessionState(b).language = 'hinglish';
  const hg = (await runTurn(b, [{ role: 'user', content: 'Headphones under 5000 for office calls' }])).reply;
  assert.match(hg, /options mile|best pick hai/i);
  const c = sid(); // auto = match the customer
  const auto = await runTurn(c, [{ role: 'user', content: 'Headphones under 5000 for office calls' }]);
  assert.equal(auto.lang, 'en');
});
