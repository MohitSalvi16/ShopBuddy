/**
 * HTTP API tests: real Express app, real SQLite (temp file), hermetic config (no real keys, no network).
 * Covers routing, status codes, validation, auth, SSE, Agora custom-LLM wire format and concurrency.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.SKIP_DOTENV = '1';
process.env.NO_LISTEN = '1';
process.env.DB_PATH = path.join(os.tmpdir(), `shopbuddy-api-${Date.now()}-${process.pid}.db`);
process.env.LLM_PROXY_SECRET = 'test-secret';
for (const k of ['LLM_API_KEY', 'MURF_API_KEY', 'AGORA_APP_ID', 'PUBLIC_BASE_URL']) delete process.env[k];

const { app } = await import('../src/index.js');
let server: Server;
let base = '';
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

let n = 0;
const sid = () => `api${Date.now()}x${n++}`;
const json = (body: unknown, s?: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(s ? { 'x-session-id': s } : {}) }, body: JSON.stringify(body) });
const get = (p: string) => fetch(base + p);

test('health, config and tool catalog', async () => {
  assert.equal((await get('/api/health')).status, 200);
  const cfg = await (await get('/api/config')).json();
  assert.equal(cfg.llm, false);
  assert.equal(cfg.agoraVoice, false);
  assert.ok(cfg.missingForAgoraVoice.length > 0);
  assert.match(cfg.greeting, /ShopBuddy/);
  const tools = await (await get('/api/tools')).json();
  assert.equal(tools.length, 15);
  for (const t of tools) assert.ok(t.input_schema?.type === 'object' && t.output_schema, t.name);
});

test('catalog endpoints + product images', async () => {
  const r = await (await get('/api/products?category=headphones&maxPrice=5000')).json();
  assert.ok(r.items.length > 0 && r.items.every((p: any) => p.category === 'headphones' && p.price <= 5000));
  assert.equal((await get('/api/products/HP-209')).status, 200);
  assert.equal((await get('/api/products/XX-000')).status, 404);
  assert.equal((await get('/api/orders/VC-000000-NONE')).status, 404);
  const inv = await (await get('/api/products/HP-210/inventory')).json();
  assert.equal(inv.in_stock, false);
  const img = await get('/api/images/HP-209.svg');
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type') ?? '', /svg/);
  assert.equal((await get('/api/images/NOPE.svg')).status, 404);
});

test('input validation returns 400 with details; bad session rejected', async () => {
  const bad = await fetch(base + '/api/products?sortBy=nonsense');
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).issues);
  assert.equal((await fetch(base + '/api/cart')).status, 400, 'missing session id');
  assert.equal((await fetch(base + '/api/cart?session=x')).status, 400, 'too-short session id');
  const chat = await fetch(base + '/api/chat', json({ sessionId: sid(), history: [] }));
  assert.equal(chat.status, 400, 'empty history');
  const tool = await fetch(base + '/api/tools/add_to_cart', json({ args: { quantity: 99 } }, sid()));
  assert.equal(tool.status, 400);
  assert.equal((await tool.json()).error.code, 'INVALID_INPUT');
});

test('cart + coupon REST flow with structured errors', async () => {
  const s = sid();
  const oos = await fetch(base + '/api/cart/items', json({ productId: 'HP-210' }, s));
  assert.equal(oos.status, 422);
  assert.equal((await oos.json()).error.code, 'OUT_OF_STOCK');
  const add = await (await fetch(base + '/api/cart/items', json({ productId: 'HP-209', quantity: 1 }, s))).json();
  assert.equal(add.ok, true);
  assert.equal(add.data.cart.subtotal, 4999);
  const fake = await fetch(base + '/api/cart/coupon', json({ code: 'FREE999' }, s));
  assert.equal(fake.status, 422);
  assert.equal((await fake.json()).error.code, 'COUPON_INVALID');
  const ok = await (await fetch(base + '/api/cart/coupon', json({ code: 'WELCOME10' }, s))).json();
  assert.equal(ok.data.cart.discount, 500, 'WELCOME10 capped at ₹500');
  assert.equal(ok.data.cart.total, 4499);
  const del = await fetch(base + '/api/cart/items/HP-209', { method: 'DELETE', headers: { 'x-session-id': s } });
  assert.equal(del.status, 200);
  const missing = await fetch(base + '/api/cart/items/HP-209', { method: 'DELETE', headers: { 'x-session-id': s } });
  assert.equal(missing.status, 404);
});

test('checkout over HTTP: confirmation required, then exactly one order', async () => {
  const s = sid();
  await fetch(base + '/api/cart/items', json({ productId: 'AC-503' }, s));
  const first = await (await fetch(base + '/api/orders', json({ confirmation: true }, s))).json();
  assert.equal(first.data.status, 'AWAITING_CONFIRMATION', 'confirm without prior summary only arms');
  const placed = await (await fetch(base + '/api/orders', json({ confirmation: true }, s))).json();
  assert.equal(placed.data.status, 'ORDER_PLACED');
  const again = await (await fetch(base + '/api/orders', json({ confirmation: true }, s))).json();
  assert.equal(again.data.status, 'ALREADY_PLACED');
  const orders = await (await get(`/api/orders?session=${s}`)).json();
  assert.equal(orders.length, 1);
  assert.equal((await get(`/api/orders/${orders[0].order_id}`)).status, 200);
});

test('concurrency: 10 parallel confirms create exactly one order and decrement stock once', async () => {
  const s = sid();
  const stockBefore = (await (await get('/api/products/AC-501')).json()).stock;
  await fetch(base + '/api/cart/items', json({ productId: 'AC-501' }, s));
  await fetch(base + '/api/orders', json({ confirmation: false }, s)); // arm
  const results = await Promise.all(Array.from({ length: 10 }, () => fetch(base + '/api/orders', json({ confirmation: true }, s)).then((r) => r.json())));
  const statuses = results.map((r) => r.data?.status ?? r.error?.code);
  assert.equal(statuses.filter((x) => x === 'ORDER_PLACED').length, 1, JSON.stringify(statuses));
  assert.equal((await (await get(`/api/orders?session=${s}`)).json()).length, 1);
  assert.equal((await (await get('/api/products/AC-501')).json()).stock, stockBefore - 1);
});

test('concurrency: parallel sessions buying the last units never oversell', async () => {
  // HP-209 has limited stock; drain it with many parallel shoppers.
  const stock = (await (await get('/api/products/HP-209')).json()).stock;
  const shoppers = Array.from({ length: stock + 3 }, () => sid());
  await Promise.all(shoppers.map((s) => fetch(base + '/api/cart/items', json({ productId: 'HP-209' }, s))));
  await Promise.all(shoppers.map((s) => fetch(base + '/api/orders', json({ confirmation: false }, s))));
  const res = await Promise.all(shoppers.map((s) => fetch(base + '/api/orders', json({ confirmation: true }, s)).then((r) => r.json())));
  const placed = res.filter((r) => r.data?.status === 'ORDER_PLACED').length;
  assert.equal(placed, stock, 'exactly the available units were sold');
  assert.equal((await (await get('/api/products/HP-209')).json()).stock, 0);
  assert.ok(res.some((r) => r.error?.code === 'OUT_OF_STOCK'), 'late buyers get OUT_OF_STOCK');
  await fetch(base + '/api/admin/reset-stock', { method: 'POST' });
});

test('chat endpoint runs the agent and pushes UI events over SSE', async () => {
  const s = sid();
  const ac = new AbortController();
  const events: any[] = [];
  const res = await fetch(`${base}/api/events?session=${s}`, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = res.body!.getReader();
  const pump = (async () => {
    const dec = new TextDecoder(); let buf = '';
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6))); } } } catch { /* aborted */ }
  })();
  const r = await (await fetch(base + '/api/chat', json({ sessionId: s, history: [{ role: 'user', content: 'Headphones under 5000 for office calls' }] }))).json();
  assert.equal(r.mode, 'rules');
  assert.match(r.reply, /best pick/i);
  await new Promise((x) => setTimeout(x, 200));
  ac.abort(); await pump;
  const types = events.map((e) => e.type);
  for (const t of ['cart', 'transcript', 'status', 'tool', 'deal']) assert.ok(types.includes(t), `missing ${t} event: ${types}`);
  const deal = events.find((e) => e.type === 'deal');
  assert.equal(deal.result.recommendations.length, 3);
});

test('Agora custom-LLM endpoint: auth + OpenAI SSE wire format', async () => {
  const url = `${base}/api/llm/chat/completions?session=${sid()}`;
  const body = { model: 'x', stream: true, messages: [{ role: 'assistant', content: 'Hi', turn_id: 0 }, { role: 'user', content: 'earbuds under 3000', turn_id: 1, timestamp: Date.now() }] };
  assert.equal((await fetch(url, json(body))).status, 401, 'no bearer');
  const wrong = await fetch(url, { ...json(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);
  const res = await fetch(url, { ...json(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const raw = await res.text();
  const frames = raw.split('\n\n').filter(Boolean);
  assert.equal(frames.at(-1), 'data: [DONE]');
  const chunks = frames.slice(0, -1).map((f) => { assert.ok(f.startsWith('data: ')); return JSON.parse(f.slice(6)); });
  for (const c of chunks) { assert.equal(c.object, 'chat.completion.chunk'); assert.ok(Array.isArray(c.choices)); }
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
  const text = chunks.map((c) => c.choices[0].delta.content ?? '').join('');
  assert.ok(text.length > 10);
  // non-streaming variant
  const ns = await (await fetch(url, { ...json({ ...body, stream: false }), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' } })).json();
  assert.equal(ns.object, 'chat.completion');
  assert.ok(ns.choices[0].message.content.length > 10);
});

test('voice endpoints fail clearly when not configured', async () => {
  const tts = await fetch(base + '/api/tts', json({ text: 'hello' }));
  assert.equal(tts.status, 503);
  assert.match((await tts.json()).error, /MURF_API_KEY/);
  const start = await fetch(base + '/api/agent/start', json({ sessionId: sid() }));
  assert.equal(start.status, 503);
  assert.match((await start.json()).error, /Agora voice not configured/);
});

test('unknown API route is 404 JSON-ish, not a crash', async () => {
  const r = await fetch(base + '/api/does-not-exist');
  assert.equal(r.status, 404);
});

test('language choice is accepted, validated and persisted per session', async () => {
  const s = sid();
  const cfg = await (await get('/api/config')).json();
  assert.deepEqual(cfg.languagePrefs, ['auto', 'en', 'hi', 'hinglish']);
  assert.match(cfg.greetings.hi, /[ऀ-ॿ]/);
  const bad = await fetch(base + '/api/chat', json({ sessionId: s, language: 'klingon', history: [{ role: 'user', content: 'hi' }] }));
  assert.equal(bad.status, 400);
  const r1 = await (await fetch(base + '/api/chat', json({ sessionId: s, language: 'en', history: [{ role: 'user', content: 'Bhai 5000 ke andar office calls ke liye headphones chahiye' }] }))).json();
  assert.equal(r1.lang, 'en');
  // the choice sticks for later turns that don't resend it (e.g. Agora voice turns)
  const r2 = await (await fetch(base + '/api/chat', json({ sessionId: s, history: [{ role: 'user', content: 'koi discount hai?' }] }))).json();
  assert.equal(r2.lang, 'en');
});

test('reviews + rating endpoints', async () => {
  const s = sid();
  const rev = await (await get('/api/products/HP-209/reviews')).json();
  assert.equal(rev.ok, true);
  assert.ok(rev.data.praise.length && rev.data.complaints.length);
  const forbidden = await fetch(base + '/api/products/HP-206/rating', json({ rating: 5 }, s));
  assert.equal(forbidden.status, 403);
  await fetch(base + '/api/cart/items', json({ productId: 'HP-206' }, s));
  await fetch(base + '/api/orders', json({ confirmation: false }, s));
  await fetch(base + '/api/orders', json({ confirmation: true }, s));
  const okRate = await (await fetch(base + '/api/products/HP-206/rating', json({ rating: 4, comment: 'Clear mic' }, s))).json();
  assert.equal(okRate.ok, true);
  assert.equal(okRate.data.your_rating, 4);
  assert.equal((await fetch(base + '/api/products/HP-206/rating', json({ rating: 0 }, s))).status, 400);
});
