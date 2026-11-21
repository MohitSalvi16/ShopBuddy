import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { config, capabilities } from './config.js';
import { seedCatalog, resetStock } from './db.js';
import * as shop from './shop.js';
import { executeTool, TOOL_CATALOG, type ToolResult } from './tools.js';
import { findBestDeal } from './recommend.js';
import { detectLanguage, ttsLocaleFor, LANG_PREFS, type LangPref } from './lang.js';
import { runTurn, GREETING, GREETINGS } from './agent.js';
import { emit, subscribe } from './events.js';
import { startAgent, stopAgent } from './agora.js';
import { streamTts } from './murf.js';
import { productSvg } from './images.js';

seedCatalog();

export const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const sessionOf = (req: Request): string => {
  const s = String(req.query.session ?? req.header('x-session-id') ?? req.body?.sessionId ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(s)) throw new HttpError(400, 'Missing or invalid session id');
  return s;
};
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);
/** Tool results carry {error} on business failures — surface as 422 for REST callers. */
const toolResponse = (res: Response, r: ToolResult) => (r.ok ? res.json(r) : res.status(r.error.code === 'INVALID_INPUT' ? 400 : r.error.code === 'NOT_FOUND' ? 404 : 422).json(r));

// ------------------------------------------------------------------ meta
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => res.json({ ...capabilities(), greeting: GREETING, greetings: GREETINGS, languagePrefs: LANG_PREFS }));
const langPrefSchema = z.enum(['auto', 'en', 'hi', 'hinglish']).optional();
/** Persist the customer's language choice on the session (used by text, Lite voice and Agora turns). */
const applyLanguage = (sessionId: string, raw: unknown) => { const l = langPrefSchema.parse(raw); if (l) shop.sessionState(sessionId).language = l as LangPref; };
app.get('/api/tools', (_req, res) => res.json(TOOL_CATALOG));
/** Generic tool endpoint (same executor the LLM uses) — handy for debugging and the UI. */
app.post('/api/tools/:name', wrap((req, res) => toolResponse(res, executeTool(sessionOf(req), String(req.params.name), req.body?.args ?? {}))));
app.get('/api/deals', wrap((req, res) => {
  const q = z.object({ category: z.string().optional(), budget: z.coerce.number().optional(), use_case: z.enum(['calls', 'gaming', 'music', 'travel', 'workout', 'general']).optional() }).parse(req.query);
  res.json(findBestDeal(String(req.query.session ?? 'anonymous-deals'), q));
}));
app.get('/api/images/:id.svg', (req, res) => {
  try {
    const p = shop.getProduct(req.params.id);
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(productSvg(p));
  } catch { res.status(404).end(); }
});

// ------------------------------------------------------------------ live UI events (SSE)
app.get('/api/events', (req, res) => {
  const sessionId = sessionOf(req);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`data: ${JSON.stringify({ type: 'cart', cart: shop.getCart(sessionId) })}\n\n`);
  const unsub = subscribe(sessionId, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); unsub(); });
});

// ------------------------------------------------------------------ shopping REST API (same functions the agent uses)
app.get('/api/products', wrap((req, res) => {
  const q = z.object({
    q: z.string().default(''), category: z.string().optional(), maxPrice: z.coerce.number().optional(), minPrice: z.coerce.number().optional(),
    sortBy: z.enum(['relevance', 'battery', 'sound', 'anc', 'rating', 'price_low', 'price_high']).optional(), limit: z.coerce.number().optional(),
  }).parse(req.query);
  res.json(shop.searchProducts(q.q, { category: q.category, maxPrice: q.maxPrice, minPrice: q.minPrice, sortBy: q.sortBy, limit: q.limit ?? 6, inStockOnly: false }));
}));
app.get('/api/products/:id', wrap((req, res) => res.json(shop.getProduct(String(req.params.id)))));
app.get('/api/products/:id/inventory', wrap((req, res) => res.json(shop.checkInventory(String(req.params.id)))));
app.get('/api/cart', wrap((req, res) => res.json(shop.getCart(sessionOf(req)))));
app.post('/api/cart/items', wrap((req, res) => toolResponse(res, executeTool(sessionOf(req), 'add_to_cart', { product_id: req.body.productId, quantity: req.body.quantity ?? 1 }))));
app.delete('/api/cart/items/:id', wrap((req, res) => toolResponse(res, executeTool(sessionOf(req), 'remove_from_cart', { product_id: req.params.id }))));
app.post('/api/cart/coupon', wrap((req, res) => toolResponse(res, executeTool(sessionOf(req), 'apply_coupon', { coupon_code: req.body.code }))));
app.get('/api/coupons', wrap((req, res) => res.json(shop.listCoupons(sessionOf(req)))));
app.post('/api/orders', wrap((req, res) => toolResponse(res, executeTool(sessionOf(req), 'create_demo_order', { confirmed: req.body.confirmation === true || req.body.confirmed === true, expected_total: req.body.expectedTotal }))));
app.get('/api/orders', wrap((req, res) => res.json(shop.latestOrders(sessionOf(req)))));
app.get('/api/orders/:id', wrap((req, res) => res.json(shop.getOrderStatus(String(req.params.id)))));
app.post('/api/admin/reset-stock', (_req, res) => { resetStock(); res.json({ ok: true }); });

// ------------------------------------------------------------------ text / lite-voice conversation
const historySchema = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(40);

app.post('/api/chat', wrap(async (req, res) => {
  const sessionId = sessionOf(req);
  const history = historySchema.parse(req.body.history);
  applyLanguage(sessionId, req.body.language);
  const userText = history[history.length - 1].content;
  emit(sessionId, { type: 'transcript', role: 'user', text: userText, source: 'text' });
  emit(sessionId, { type: 'status', state: 'thinking' });
  const turn = await runTurn(sessionId, history, 'text');
  emit(sessionId, { type: 'status', state: 'idle' });
  emit(sessionId, { type: 'transcript', role: 'assistant', text: turn.reply, source: 'text' });
  res.json({ ...turn, ttsLocale: config.murf.apiKey ? ttsLocaleFor(turn.reply, config.murf.locale, config.murf.hindiLocale) : null });
}));

app.post('/api/tts', wrap(async (req, res) => {
  if (!config.murf.apiKey) throw new HttpError(503, 'MURF_API_KEY not configured');
  const { text } = z.object({ text: z.string().min(1).max(1500) }).parse(req.body);
  const hindi = detectLanguage(text) === 'hi';
  await streamTts(text, res, hindi ? { voiceId: config.murf.hindiVoiceId, locale: config.murf.hindiLocale } : undefined);
}));

// ------------------------------------------------------------------ Agora Conversational AI
app.post('/api/agent/start', wrap(async (req, res) => {
  const caps = capabilities();
  if (!caps.agoraVoice) throw new HttpError(503, `Agora voice not configured. Missing: ${caps.missingForAgoraVoice.join(', ')}`);
  const sessionId = sessionOf(req);
  applyLanguage(sessionId, req.body.language);
  const r = await startAgent(sessionId, shop.sessionState(sessionId).language ?? 'auto');
  emit(sessionId, { type: 'agent', state: 'started', detail: r.agentId });
  res.json(r);
}));
app.post('/api/agent/stop', wrap(async (req, res) => {
  const sessionId = sessionOf(req);
  const r = await stopAgent(sessionId);
  emit(sessionId, { type: 'agent', state: 'stopped' });
  res.json(r);
}));

/**
 * Custom LLM endpoint called by the Agora Conversational AI engine (OpenAI Chat Completions, stream=true).
 * We run the tool-calling loop server-side against SQLite, then stream the spoken reply back as SSE chunks.
 */
app.post('/api/llm/chat/completions', wrap(async (req, res) => {
  if (config.llm.proxySecret && req.header('authorization') !== `Bearer ${config.llm.proxySecret}`) throw new HttpError(401, 'bad proxy secret');
  const sessionId = sessionOf(req);
  const raw: any[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const textOf = (c: unknown): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? '').join(' ') : '';
  const history = raw
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: textOf(m.content).trim() }))
    .filter((m) => m.content);
  if (!history.length || history[history.length - 1].role !== 'user') history.push({ role: 'user', content: 'Hello' });

  emit(sessionId, { type: 'transcript', role: 'user', text: history[history.length - 1].content, source: 'voice' });
  emit(sessionId, { type: 'status', state: 'thinking' });
  const { reply } = await runTurn(sessionId, history, 'agora');
  emit(sessionId, { type: 'status', state: 'idle' });
  emit(sessionId, { type: 'transcript', role: 'assistant', text: reply, source: 'voice' });

  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'shopbuddy-agent', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  if (req.body?.stream === false) {
    return res.json({ id, object: 'chat.completion', created, model: 'shopbuddy-agent', choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] });
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(chunk({ role: 'assistant', content: '' }));
  for (const piece of reply.match(/[^.!?।]+[.!?।]*\s*/g) ?? [reply]) res.write(chunk({ content: piece }));
  res.write(chunk({}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
}));

// ------------------------------------------------------------------ static client (production build)
const clientDist = path.resolve(process.cwd(), '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', issues: err.issues });
  if (err instanceof shop.ShopError) return res.status(err.code === 'NOT_FOUND' ? 404 : 422).json({ error: err.message, code: err.code });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
});

// Tests import `app` and listen on a random port themselves.
if (process.env.NO_LISTEN !== '1') app.listen(config.port, () => {
  const caps = capabilities();
  console.log(`${config.appName} API on http://localhost:${config.port}`);
  console.log(`  LLM: ${caps.llmProvider} | Murf: ${caps.murf ? 'on' : 'off'} | Agora voice: ${caps.agoraVoice ? 'ready' : 'missing ' + caps.missingForAgoraVoice.join(', ')}`);
});
