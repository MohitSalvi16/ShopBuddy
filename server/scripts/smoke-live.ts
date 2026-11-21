/**
 * LIVE smoke test of every external integration, using the real keys in .env.
 *   npm run test:live          (from repo root, backend must be running on PORT for the HTTP checks)
 * Each check is PASS / FAIL / SKIP (missing config). Exit code 1 if anything FAILs.
 * Side effects: a few Gemini + Murf calls, and one Agora agent started and stopped within ~5 s.
 */
import { config, capabilities } from '../src/config.js';

type Result = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; ms: number; detail: string };
const results: Result[] = [];
const LOCAL = `http://localhost:${config.port}`;

async function check(name: string, needs: boolean | string, fn: () => Promise<string>) {
  if (needs !== true) { results.push({ name, status: 'SKIP', ms: 0, detail: typeof needs === 'string' ? needs : 'not configured' }); return; }
  const t = Date.now();
  try { results.push({ name, status: 'PASS', ms: Date.now() - t, detail: await fn() }); results.at(-1)!.ms = Date.now() - t; }
  catch (e) { results.push({ name, status: 'FAIL', ms: Date.now() - t, detail: e instanceof Error ? e.message : String(e) }); }
}
const must = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const caps = capabilities();
const backendUp = await fetch(`${LOCAL}/api/health`).then((r) => r.ok).catch(() => false);

// ---------------------------------------------------------------- LLM
await check('Gemini/OpenAI: model reachable + tool call', Boolean(config.llm.apiKey) || 'LLM_API_KEY missing', async () => {
  const r = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
    body: JSON.stringify({ model: config.llm.model, messages: [
      { role: 'system', content: 'You are a shopping assistant. When the customer states a need and budget, call find_best_deal with category, budget and use_case. Never answer product questions without the tool.' },
      { role: 'user', content: 'Bhai 5000 ke andar office calls ke liye headphones chahiye' }],
      tools: [{ type: 'function', function: { name: 'find_best_deal', description: 'Find best deal', parameters: { type: 'object', properties: { budget: { type: 'number' }, use_case: { type: 'string' }, category: { type: 'string' } } } } }], tool_choice: 'auto' }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await r.text();
  must(r.ok, `HTTP ${r.status}: ${body.slice(0, 200)}`);
  const msg = JSON.parse(body).choices?.[0]?.message;
  const call = msg?.tool_calls?.[0];
  must(call?.function?.name === 'find_best_deal', `model did not call the tool; it said: "${String(msg?.content ?? '').slice(0, 120)}"`);
  const args = JSON.parse(call.function.arguments);
  must(Number(args.budget) === 5000, `budget not extracted: ${call.function.arguments}`);
  return `${config.llm.model} → find_best_deal ${call.function.arguments}`;
});

// ---------------------------------------------------------------- Murf (direct HTTP stream)
for (const [label, text, voice] of [
  ['Murf TTS en-IN (Hinglish)', 'Bhai, paanch hazaar ke andar best headphones mil gaye.', { voiceId: config.murf.voiceId, locale: config.murf.locale }],
  ['Murf TTS hi-IN (Devanagari)', 'नमस्ते! मैं आपका शॉपिंग बडी हूँ।', { voiceId: config.murf.hindiVoiceId, locale: config.murf.hindiLocale }],
] as const) {
  await check(label, Boolean(config.murf.apiKey) || 'MURF_API_KEY missing', async () => {
    const r = await fetch(config.murf.httpStreamUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': config.murf.apiKey },
      body: JSON.stringify({ text, voiceId: voice.voiceId, model: config.murf.model, locale: voice.locale, format: 'MP3', sampleRate: 24000 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const buf = Buffer.from(await r.arrayBuffer());
    must(buf.length > 5000, `audio too small (${buf.length} bytes)`);
    must(buf.subarray(0, 3).toString() === 'ID3' || buf[0] === 0xff, 'not an MP3 stream');
    return `${voice.voiceId}/${voice.locale} → ${(buf.length / 1024).toFixed(0)} KB MP3`;
  });
}

// ---------------------------------------------------------------- Agora
const agoraAuth = config.agora.customerId && config.agora.customerSecret;
await check('Agora REST credentials (read-only)', Boolean(config.agora.appId && agoraAuth) || 'AGORA_APP_ID / CUSTOMER_ID / CUSTOMER_SECRET missing', async () => {
  const r = await fetch(`${config.agora.apiBase}/projects/${config.agora.appId}/agents?limit=1`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${config.agora.customerId}:${config.agora.customerSecret}`).toString('base64') },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return 'list agents OK';
});

await check('Public URL reaches backend (tunnel)', Boolean(config.publicBaseUrl) || 'PUBLIC_BASE_URL missing', async () => {
  const r = await fetch(`${config.publicBaseUrl}/api/health`, { signal: AbortSignal.timeout(15000) });
  must(r.ok, `HTTP ${r.status} — is cloudflared/ngrok running and pointing at :${config.port}?`);
  return config.publicBaseUrl;
});

await check('Agora → custom LLM endpoint via public URL', (Boolean(config.publicBaseUrl) && backendUp) || (backendUp ? 'PUBLIC_BASE_URL missing' : 'backend not running'), async () => {
  const r = await fetch(`${config.publicBaseUrl}/api/llm/chat/completions?session=smoke${Date.now()}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.proxySecret}` },
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'earbuds under 3000 with good battery', turn_id: 1 }] }),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await r.text();
  must(r.ok, `HTTP ${r.status}: ${raw.slice(0, 200)}`);
  must(raw.trim().endsWith('data: [DONE]'), 'stream did not end with [DONE]');
  const text = raw.split('\n\n').filter((c) => c.startsWith('data: {')).map((c) => JSON.parse(c.slice(6)).choices[0].delta.content ?? '').join('');
  must(text.length > 20, 'empty reply');
  must(!/[*|#]/.test(text), `reply not speech-clean: ${text.slice(0, 80)}`);
  must(text.split(/\s+/).length <= 60, `reply too long for voice: ${text.split(/\s+/).length} words`);
  return `${text.split(/\s+/).length} words: "${text.slice(0, 70)}…"`;
});

await check('Agora agent start → stop (real, ~5 s)', (caps.agoraVoice && backendUp) || (backendUp ? `missing: ${caps.missingForAgoraVoice.join(', ')}` : 'backend not running'), async () => {
  const sessionId = `smoke${Date.now()}`;
  const s = await fetch(`${LOCAL}/api/agent/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
  const sj: any = await s.json();
  must(s.ok, `start HTTP ${s.status}: ${JSON.stringify(sj).slice(0, 200)}`);
  must(['RUNNING', 'STARTING', 'IDLE'].includes(sj.status), `unexpected status ${sj.status}`);
  must(sj.token && sj.channel && sj.uid, 'missing RTC credentials for the browser');
  await new Promise((r) => setTimeout(r, 3000));
  const st = await fetch(`${LOCAL}/api/agent/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
  const stj: any = await st.json();
  must(st.ok && stj.stopped, `stop failed: ${JSON.stringify(stj)}`);
  return `agent ${String(sj.agentId).slice(0, 8)}… ${sj.status} → stopped`;
});

await check('Backend /api/tts proxies Murf', (backendUp && caps.murf) || (backendUp ? 'MURF_API_KEY missing' : 'backend not running'), async () => {
  const r = await fetch(`${LOCAL}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Order confirmed. Thank you!' }) });
  must(r.ok && (r.headers.get('content-type') ?? '').includes('audio'), `HTTP ${r.status}`);
  return `${((await r.arrayBuffer()).byteLength / 1024).toFixed(0)} KB audio`;
});

// ---------------------------------------------------------------- report
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('\nLIVE INTEGRATION SMOKE TEST\n' + '-'.repeat(100));
for (const r of results) console.log(`${pad(r.status, 5)} ${pad(r.name, 46)} ${pad(r.ms ? r.ms + 'ms' : '', 8)} ${r.detail.slice(0, 120)}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log('-'.repeat(100) + `\n${results.filter((r) => r.status === 'PASS').length} passed, ${failed} failed, ${results.filter((r) => r.status === 'SKIP').length} skipped`);
process.exit(failed ? 1 : 0);
