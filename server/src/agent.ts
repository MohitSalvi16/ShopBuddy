import { TOOL_DEFS, executeTool, contextSnapshot } from './tools.js';
import { ruleBasedReply } from './fallback.js';
import { config } from './config.js';
import { resolveLanguage, detectLanguage, type Lang, type LangPref } from './lang.js';
import { sessionState, getCart } from './shop.js';

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export type Channel = 'agora' | 'text';

const SYSTEM_PROMPT = `You are ${config.appName}, the customer's friendly shopping buddy for an Indian electronics store (demo catalog). You are on the customer's side, never a salesperson. Motto: "Not the cheapest, the right one — together."
OUTPUT FORMAT (strict — every reply is spoken aloud by a text-to-speech voice):
- Plain conversational sentences only, at most 2-3 short sentences / ~40 words (it is spoken; long replies feel slow). NEVER use markdown, bold, tables, bullet or numbered lists, headings, emojis or product IDs.
- The screen already shows the product cards, comparison table and cart, so do not read out every spec — summarise the one or two facts that matter.
- Write in the language given by the LANGUAGE rule at the end of these instructions (it is the customer's explicit choice). Keep product names and rupee amounts exactly as tools return them. Say prices like "4,499 rupees".

You are a thoughtful friend, not an order-taker. Be warm and never make the customer feel their choice was silly:
- Understand the GOAL, not just keywords. "WFH, meetings all day, comfortable" -> use_case "calls", preferences ["comfort"], likely headphones. If the category is genuinely unclear, ask one short question. If no budget is known, ask for it once before searching.
- With a budget or goal, call find_best_deal (not search_products). It already checks stock, verified coupons and scores 40% requirement, 25% quality, 20% value, 15% preferences. Mention the best pick, why, its final price after coupon, and one alternative.
- Friendly tip (devil's advocate): never blindly agree, but say it kindly, like a friend. If find_best_deal returns devils_advocate with verdict "reconsider", or the customer asks for "the cheapest", call critique_choice if needed and give a friendly tip: acknowledge the good part first ("great price"), then the real trade-off (e.g. mic is a bit weak for calls), then the better option and the extra cost. Always leave the decision to the customer. Only use attributes returned by tools.
- "Buy/add the cheapest": do NOT add it yet. Call find_best_deal if needed and critique_choice on the cheapest, share the friendly tip, and ask which one they want. Add only after they choose.
- Example of the right style (Hinglish): "Sabse best option 1 hai, Logitech H390 USB Headset, 2,065 rupees mein WELCOME10 ke baad, mic bahut clear hai. Option 3 Boult sabse sasta hai, bas ek friendly tip, uska mic calls ke liye thoda weak hai. Kaunsa add karun?"
- "gaming ke liye nahi" -> exclude_use_cases ["gaming"]. "Isse sasta" / "something cheaper" -> find_best_deal with cheaper_than_product_id = product in focus.
- Products appear on screen as numbered cards in exactly the order of the tool's "position" field. When you mention options, keep that order and those numbers ("option 1 ... option 2 ..."). Resolve "first", "second wala", "pehla", "dusra", "last" with those same positions (see "Products currently shown" in the live state).
- Compound requests ("add karo aur coupon lagao"): do each step with tools in order.
- Coupons: use find_best_coupon, then apply_coupon. Never claim a discount the tools did not confirm.
- If add_to_cart returns an advisor critique, mention the concern briefly.
- Checkout: right after add_to_cart / apply_coupon (same turn), or when the customer asks to order, call create_demo_order(confirmed=false) to get the official summary; say the final total and discount and ask "proceed with demo checkout?". Never ask for checkout confirmation without that summary call. Only after an explicit yes in the latest message, call create_demo_order(confirmed=true, expected_total=<that total>). Say the order ID. Payment is simulated.
- Never say something succeeded unless the tool returned ok:true. If a tool fails, explain the error message simply.`;

export const GREETINGS: Record<Lang, string> = {
  hinglish: `Hi! Main ${config.appName} hoon, aapka shopping buddy. Budget aur zaroorat bataiye, saath milke sahi cheez dhoondhte hain.`,
  en: `Hi! I'm ${config.appName}, your shopping buddy. Tell me your budget and what you need, and we'll find the right one together.`,
  hi: `नमस्ते! मैं ${config.appName} हूँ, आपका शॉपिंग साथी। अपना बजट और ज़रूरत बताइए, साथ मिलकर सही चीज़ ढूंढते हैं।`,
};
export const GREETING = GREETINGS.hinglish;
export const greetingFor = (pref?: LangPref) => GREETINGS[pref && pref !== 'auto' ? pref : 'hinglish'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** OpenAI-compatible chat call with retry on 429/5xx (free-tier Gemini keys are rate-limited per minute). */
async function callLLM(messages: ChatMsg[]) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({ model: config.llm.model, messages, tools: TOOL_DEFS, tool_choice: 'auto', temperature: 0.2 }),
      signal: AbortSignal.timeout(15000), // keep voice turns responsive; on timeout we fall back safely
    });
    if (res.ok) {
      const json: any = await res.json();
      return json.choices?.[0]?.message as ChatMsg;
    }
    const body = (await res.text()).replace(/\s+/g, ' ');
    const retryable = res.status === 429 || res.status >= 500;
    // Gemini returns e.g. "retryDelay": "7s"; honour short delays, give up on long ones.
    const hinted = Number(body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1] ?? NaN);
    const wait = Number.isFinite(hinted) ? hinted * 1000 : 1500 * (attempt + 1);
    if (!retryable || attempt >= 2 || wait > 8000) throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
    console.warn(`[agent] LLM HTTP ${res.status}, retrying in ${Math.round(wait)}ms`);
    await sleep(wait);
  }
}

/**
 * Safety net for TTS: LLMs sometimes ignore "no markdown". Strip tables, list markers, emphasis, headings,
 * emojis and product IDs so Murf never reads "asterisk asterisk" or "HP-206" aloud.
 */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l) && !/^\s*[-:| ]+\s*$/.test(l)) // markdown table rows / separators
    .map((l) => l.replace(/^\s*#{1,6}\s*/, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))
    .join(' ')
    .replace(/\*\*|__|\*|`/g, '')
    .replace(/\s*\((?:[A-Z]{2}-\d{3})\)/g, '')
    .replace(/\b[A-Z]{2}-\d{3}\b/g, '')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s+([,.!?।])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Hard cap so a chatty model never reads a paragraph aloud; keeps any order ID and the closing question. */
export function capForVoice(text: string, maxWords = 55): string {
  if (text.split(/\s+/).length <= maxWords) return text;
  // Protect decimals ("9.5/10", "1.5m") so they are not treated as sentence ends.
  const DOT = '․';
  const sentences = (text.replace(/(\d)\.(\d)/g, `$1${DOT}$2`).match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g) ?? [text])
    .map((x) => x.trim().replaceAll(DOT, '.')).filter(Boolean);
  const keep: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const w = s.split(/\s+/).length;
    if (keep.length && words + w > maxWords - 15) break;
    // A single run-on "sentence" (e.g. a flattened list) longer than the budget: cut it at a clause boundary.
    keep.push(w > maxWords - 15 ? clip(s, maxWords - 15) : s);
    words += Math.min(w, maxWords - 15);
  }
  for (const s of sentences) if (/VC-\d{6}-[A-Z0-9]{4}/.test(s) && !keep.includes(s)) keep.push(s);
  const qSentence = [...sentences].reverse().find((s) => s.endsWith('?'));
  // Only the question clause itself (a run-on sentence may end with the question).
  const q = qSentence && (qSentence.split(/\s+/).length > 20 ? qSentence.match(/[^,:;–—]+\?$/)?.[0]?.trim() : qSentence);
  if (q && !keep.some((k) => k.endsWith(q))) keep.push(q);
  return balanceBrackets(keep.join(' '));
}

/** First `n` words, ending at the last comma/colon/dash boundary if one is reasonably close, then a full stop. */
function clip(s: string, n: number): string {
  const head = s.split(/\s+/).slice(0, n).join(' ');
  const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(':'), head.lastIndexOf(' – '), head.lastIndexOf(' — '), head.lastIndexOf(';'));
  const base = cut > head.length * 0.5 ? head.slice(0, cut) : head;
  return base.replace(/[\s,:;–—-]+$/, '') + '.';
}

/** Drop brackets left unbalanced after trimming ("…(8. ) Would you…" -> "… Would you…"). */
function balanceBrackets(t: string): string {
  let depth = 0;
  let out = '';
  for (const ch of t) {
    if (ch === '(') depth++;
    if (ch === ')') { if (depth === 0) continue; depth--; }
    out += ch;
  }
  if (depth > 0) out = out.replace(/\([^()]*$/, '');
  return out.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Does the reply respect the customer's language choice? */
function languageMatches(text: string, lang: Lang, wantDevanagari: boolean): boolean {
  const deva = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  if (wantDevanagari) return deva >= 10;
  if (lang === 'en') return deva === 0 && detectLanguage(text) === 'en';
  return deva === 0; // Roman Hindi / Hinglish
}

/** One cheap tool-free call that only translates/rewrites the already-decided reply. */
async function rewriteInLanguage(reply: string, langRule: string): Promise<string> {
  const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
    body: JSON.stringify({ model: config.llm.model, temperature: 0, messages: [
      { role: 'system', content: `Rewrite the shopping assistant reply below. Keep every fact, product name, price and question exactly; change only the language. Plain text, no markdown. ${langRule}` },
      { role: 'user', content: reply },
    ] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`rewrite HTTP ${res.status}`);
  const json: any = await res.json();
  return speakable(json.choices?.[0]?.message?.content ?? '');
}

export interface TurnResult { reply: string; mode: 'llm' | 'rules'; lang: Lang; tools: string[] }

/**
 * One conversational turn: LLM picks tools -> backend executes -> results go back to the LLM ->
 * repeat until it produces the spoken reply. Same function for voice (Agora) and text, keyed by session,
 * so both share cart, goal and shown-products state.
 */
export async function runTurn(sessionId: string, history: { role: 'user' | 'assistant'; content: string }[], channel: Channel = 'text'): Promise<TurnResult> {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const pref = sessionState(sessionId).language ?? 'auto';
  const lang = resolveLanguage(pref, lastUser);
  if (!config.llm.apiKey) return { reply: ruleBasedReply(sessionId, history, lang), mode: 'rules', lang, tools: [] };

  // Agora's TTS voice/locale is fixed when the agent joins: Hindi agents get the hi-IN voice (Devanagari OK),
  // everything else uses the en-IN voice, which reads Roman script best.
  const agoraHindi = channel === 'agora' && pref === 'hi';
  const wantDevanagari = lang === 'hi' && (channel !== 'agora' || agoraHindi);
  const langRule =
    lang === 'en' ? 'LANGUAGE (mandatory, overrides everything above): write the ENTIRE reply in natural English. Do NOT use Hindi or Hinglish words (no "bhai", "hai", "karoon", "ke liye"), even if the customer writes in Hinglish. Example: "The best option is the Logitech H390 USB Headset at 2,065 rupees after WELCOME10. Shall I add it to your cart?"'
    : wantDevanagari ? 'LANGUAGE (mandatory, overrides everything above): write the ENTIRE reply in Hindi using Devanagari script. Only product names, coupon codes and numbers may stay in English. Example: "सबसे अच्छा विकल्प Logitech H390 USB Headset है, WELCOME10 के बाद 2,065 रुपये में। क्या मैं इसे कार्ट में जोड़ दूँ?"'
    : lang === 'hi' ? 'LANGUAGE (mandatory): reply in simple Hindi written in Roman script (the voice is Indian English).'
    : 'LANGUAGE (mandatory): reply in Hinglish — a natural Hindi-English mix in Roman script.';
  const messages: ChatMsg[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n${langRule}` },
    ...history.slice(-16),
  ];
  messages.splice(messages.length - 1, 0, { role: 'system', content: `Live session state:\n${contextSnapshot(sessionId)}` });

  const used: string[] = [];
  const st = sessionState(sessionId);
  st.turn = (st.turn ?? 0) + 1;
  st.inTurn = true;
  const cartBefore = JSON.stringify(getCart(sessionId).items);
  const finish = (reply: string, mode: 'llm' | 'rules'): TurnResult => {
    // If the cart changed this turn and the model skipped the official summary, arm it now and show the
    // checkout card: the on-screen summary is what the customer confirms in the NEXT turn.
    const cart = getCart(sessionId);
    if (mode === 'llm' && cart.items.length && JSON.stringify(cart.items) !== cartBefore && !st.pendingOrder) {
      executeTool(sessionId, 'create_demo_order', { confirmed: false });
    }
    st.inTurn = false;
    return { reply: capForVoice(reply), mode, lang, tools: used };
  };
  try {
    for (let step = 0; step < 8; step++) {
      const msg = await callLLM(messages);
      if (!msg) throw new Error('LLM returned no message');
      if (msg.tool_calls?.length) {
        messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
        for (const tc of msg.tool_calls) {
          let args: unknown = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = { __invalid_json: tc.function.arguments }; }
          const result = executeTool(sessionId, tc.function.name, args);
          used.push(tc.function.name);
          console.log(`[tool] ${tc.function.name} ${tc.function.arguments} -> ${result.ok ? 'ok' : 'ERR ' + result.error.code}`);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue;
      }
      let reply = speakable(msg.content || '');
      if (pref !== 'auto' && reply && !languageMatches(reply, lang, wantDevanagari)) {
        try {
          const fixed = await rewriteInLanguage(reply, langRule);
          if (fixed && languageMatches(fixed, lang, wantDevanagari)) reply = fixed;
        } catch { /* keep the original reply rather than fail the turn */ }
      }
      return finish(reply || 'Maaf kijiye, phir se boliye?', 'llm');
    }
    return finish('Thoda time lag raha hai, kya aap phir se bata sakte hain?', 'llm');
  } catch (e) {
    console.error('[agent] LLM failure, using rule engine:', e instanceof Error ? e.message : e);
    // Only fall back if no state-changing tool ran yet in this turn, so actions are never executed twice.
    if (used.some((t) => ['add_to_cart', 'apply_coupon', 'create_demo_order', 'remove_from_cart'].includes(t))) {
      // Report only what the backend actually did.
      const c = getCart(sessionId);
      const done = c.items.length ? `cart mein ${c.items.map((i) => i.name).join(', ')} hai, total ${c.total.toLocaleString('en-IN')} rupees${c.discount ? `, ${c.discount} rupees discount ke saath` : ''}.` : 'cart abhi khaali hai.';
      return finish(`Network mein thodi dikkat aayi, par ${done} Aage kya karein?`, 'llm');
    }
    st.inTurn = false;
    return { reply: ruleBasedReply(sessionId, history, lang), mode: 'rules', lang, tools: used };
  }
}
