/**
 * Deterministic rule-based agent (DEMO FALLBACK when no LLM key is set or the LLM is unreachable).
 * It understands common English / Hinglish / Devanagari shopping phrases and calls the SAME backend
 * tools as the LLM. Replies are built only from tool results — nothing is hardcoded as a success.
 */
import { executeTool, type ToolResult } from './tools.js';
import { detectCategory, sessionState, getCart, findProductMention, type UseCase } from './shop.js';
import { purchasedProductIds } from './reviews.js';
import { detectLanguage, normalizeForRules } from './lang.js';
import { config } from './config.js';

interface RuleState { askedPreference?: boolean; askedBudget?: boolean }
const state = new Map<string, RuleState>();
const rupees = (n: number) => `${Math.round(n).toLocaleString('en-IN')} rupees`;

function parseBudget(t: string): number | undefined {
  const m = [...t.replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)\s*(k\b|hazaar|hazar|thousand)?/g)]
    .map((x) => Number(x[1]) * (x[2] ? 1000 : 1))
    .filter((n) => n >= 200);
  return m.length ? Math.max(...m) : undefined;
}

function parseOrdinal(t: string, shown: number): number | undefined {
  const map: [RegExp, number][] = [
    [/\b(first|pehla|pehle|pehli|1st|number one|no\.? ?1|option 1)\b/, 1],
    [/\b(second|dusra|doosra|dusre|doosre|dusri|2nd|number two|no\.? ?2|option 2)\b/, 2],
    [/\b(third|teesra|tisra|teesre|3rd|number three|no\.? ?3|option 3)\b/, 3],
    [/\b(last|aakhri|akhri)\b/, shown],
  ];
  const found = map.map(([re, n]) => ({ m: t.match(re), n })).filter((f) => f.m?.index != null && f.n > 0).sort((a, b) => a.m!.index! - b.m!.index!);
  return found[0]?.n;
}

function parseOrdinals(t: string, shown: number): number[] {
  const out: number[] = [];
  const map: [RegExp, number][] = [[/\b(first|pehla|pehle|1st)\b/, 1], [/\b(second|dusra|doosra|dusre|2nd|two)\b/, 2], [/\b(third|teesra|3rd|three)\b/, 3], [/\b(last|aakhri)\b/, shown]];
  for (const [re, n] of map) if (re.test(t) && n > 0 && !out.includes(n)) out.push(n);
  return out.sort((a, b) => a - b);
}

const USE_CASES: [UseCase, RegExp][] = [
  ['calls', /\b(calls?|calling|meetings?|office|zoom|teams|wfh|work from home|conference)\b/],
  ['gaming', /\b(gaming|games?|pubg|bgmi|valorant)\b/],
  ['music', /\b(music|songs?|gaane|bass)\b/],
  ['travel', /\b(travel|flights?|commute|metro|train)\b/],
  ['workout', /\b(gym|workout|running|run|sports?)\b/],
];

function parseGoal(t: string) {
  const exclude: UseCase[] = [];
  let use: UseCase | undefined;
  for (const [uc, re] of USE_CASES) {
    const m = t.match(re);
    if (!m) continue;
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 18);
    const before = t.slice(Math.max(0, m.index! - 8), m.index!);
    if (/^\s*(ke liye|ki liye|for)?\s*(nahi|nahin|not)\b/.test(after) || /\b(not|no)\s+(for\s+)?$/.test(before)) exclude.push(uc);
    else use ??= uc;
  }
  const prefs: string[] = [];
  if (/comfort|aaram|all day|poora din|long hours/.test(t)) prefs.push('comfort');
  if (/battery|backup|playback/.test(t)) prefs.push('battery');
  if (/\bmic|microphone|awaaz saaf|clear voice/.test(t)) prefs.push('mic');
  if (/noise|anc|cancel/.test(t)) prefs.push('anc');
  if (/\bsound|audio|awaaz/.test(t) && !prefs.includes('mic')) prefs.push('sound');
  return { use, exclude, prefs };
}

const ok = (r: ToolResult): r is Extract<ToolResult, { ok: true }> => r.ok;
const errMsg = (r: ToolResult) => (r.ok ? '' : r.error.message);

export function ruleBasedReply(sessionId: string, history: { role: string; content: string }[], replyLang?: 'en' | 'hi' | 'hinglish'): string {
  const raw = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const t = normalizeForRules(raw).toLowerCase();
  const lang = replyLang ?? detectLanguage(raw);
  const hi = lang !== 'en'; // rule-engine templates: English or Roman Hinglish (Hindi falls back to Hinglish)
  const say = (h: string, e: string) => (hi ? h : e);
  const rs = state.get(sessionId) ?? {};
  state.set(sessionId, rs);
  const ss = sessionState(sessionId);
  const at = (n: number) => ss.shown[n - 1];

  const isYes = /\b(yes|yeah|yep|haan|haa|ha|ji|confirm|confirmed|theek hai|ok|okay|proceed|kar do order)\b/.test(t) && !/\b(no|nahi|cancel|mat)\b/.test(t);
  const isNo = /\b(no|nahi|cancel|ruko|wait|mat karo)\b/.test(t) && !/\b(yes|haan|confirm)\b/.test(t);

  // ---------------------------------------------------------- 1. confirmation
  if (isYes && (ss.pendingOrder || (ss.lastOrder && !getCart(sessionId).items.length))) {
    const cart = getCart(sessionId);
    const r = executeTool(sessionId, 'create_demo_order', { confirmed: true, expected_total: cart.items.length ? cart.total : undefined });
    if (!ok(r)) return say(`Order place nahi ho paya: ${errMsg(r)}`, `I couldn't place the order: ${errMsg(r)}`);
    const o = r.data.order;
    if (r.data.status === 'ALREADY_PLACED') return say(`Yeh order pehle hi place ho chuka hai, order ID ${o.order_id}. Duplicate nahi banaya.`, `That order is already placed, order ID ${o.order_id}. No duplicate was created.`);
    if (r.data.status === 'ORDER_PLACED') {
      return say(`Ho gaya! Demo order confirm hai. Order ID ${o.order_id}. Total ${rupees(o.total)}${o.discount ? `, ${rupees(o.discount)} ki bachat` : ''}. Delivery ${o.estimated_delivery} tak.`,
        `Done! Your demo order is confirmed. Order ID ${o.order_id}. Total paid ${rupees(o.total)}${o.discount ? ` after saving ${rupees(o.discount)}` : ''}, arriving by ${o.estimated_delivery}.`);
    }
    // not armed: a summary was (re)generated
    return summaryReply(r.data.summary, say);
  }
  if (isNo && ss.pendingOrder) {
    ss.pendingOrder = undefined;
    return say('Theek hai, order place nahi kiya. Aur kuch dekhein?', 'Okay, I have not placed the order. Anything else?');
  }

  // ---------------------------------------------------------- 2. order status
  if (/status|track|kahan hai|kab aayega|where is my order/.test(t)) {
    const r = executeTool(sessionId, 'get_order_status', {});
    if (!ok(r)) return say('Abhi tak koi order nahi hai.', 'You have no orders yet.');
    return say(`Order ${r.data.order_id} ${r.data.status} hai, ${r.data.estimated_delivery} tak pahunchega.`, `Order ${r.data.order_id} is ${r.data.status}, arriving by ${r.data.estimated_delivery}.`);
  }

  // ---------------------------------------------------------- 2b. rate a purchased product ("H390 ko 4 star", "rate it 5")
  const starMatch = t.match(/\b([1-5])\s*(?:star|stars|\/\s*5)\b/) ?? (/\b(rate|rating|dunga|dungi|dena)\b/.test(t) ? t.match(/\b(?:rate|rating)\b\D{0,15}\b([1-5])\b|\b([1-5])\b\D{0,12}\b(?:rating|dunga|dungi)\b/) : null);
  const stars = starMatch ? Number(starMatch[1] ?? starMatch[2]) : undefined;
  if (stars) {
    const bought = purchasedProductIds(sessionId);
    const named = raw.toUpperCase().match(/\b([A-Z]{2}-\d{3})\b/)?.[1] ?? findProductMention(t);
    const pid = named ?? (bought.length === 1 ? bought[0] : ss.focusId && bought.includes(ss.focusId) ? ss.focusId : bought[0]);
    if (!pid) return say('Rating dene ke liye pehle kuch kharidna hoga — sirf verified buyers rate kar sakte hain.', 'You can rate a product after buying it — ratings are for verified buyers only.');
    const r = executeTool(sessionId, 'rate_product', { product_id: pid, rating: stars });
    if (!ok(r)) return say(`Rating save nahi hui: ${errMsg(r)}`, `Couldn't save the rating: ${errMsg(r)}`);
    return say(`Shukriya! ${r.data.name} ko aapne ${stars} star diye. Naya average rating ${r.data.new_average}★ hai.`, `Thanks! You rated ${r.data.name} ${stars} stars. Its new average is ${r.data.new_average}★.`);
  }

  // ---------------------------------------------------------- 2c. reviews ("how is the Jabra", "second wala kaisa hai", "reviews?")
  if (/\breviews?\b|\brating kya\b|kaisa hai|kaisi hai|kaise hai|log kya|what do (?:people|buyers|customers) say|how is (?:the|it)|how good|is it good|worth it|achha hai kya|accha hai kya|feedback/.test(t)) {
    const n = parseOrdinal(t, ss.shown.length);
    const pid = raw.toUpperCase().match(/\b([A-Z]{2}-\d{3})\b/)?.[1] ?? findProductMention(t) ?? (n ? at(n) : ss.focusId ?? at(1));
    if (!pid) return say('Kis product ke reviews chahiye? Naam ya "pehla/dusra" boliye.', 'Which product? Say its name, or "the first/second one".');
    const r = executeTool(sessionId, 'get_review_insights', { product_id: pid });
    if (!ok(r)) return errMsg(r);
    const d = r.data;
    const good = d.praise[0]?.label, bad = d.complaints[0];
    const verdictHi = d.verdict === 'mostly_positive' ? 'Overall buyers khush hain' : d.verdict === 'mostly_negative' ? 'Overall reviews kamzor hain, main behtar option dikha sakta hoon' : 'Reviews mixed hain';
    const verdictEn = d.verdict === 'mostly_positive' ? 'Overall, buyers are happy' : d.verdict === 'mostly_negative' ? 'Overall the reviews are weak; I can show a better-rated option' : 'Reviews are mixed';
    return say(
      `${d.name} ka rating ${d.rating}★ hai. ${good ? `Log iski ${good} pasand karte hain. ` : ''}${bad ? `Shikayat: ${bad.label}${bad.severity === 'major' ? ', yeh dhyan dene wali baat hai' : ', par minor hai'}. ` : 'Koi badi shikayat nahi. '}${verdictHi}.`,
      `${d.name} is rated ${d.rating}★. ${good ? `Buyers like its ${good}. ` : ''}${bad ? `Main complaint: ${bad.label}${bad.severity === 'major' ? ', worth noting' : ', but it is minor'}. ` : 'No common complaints. '}${verdictEn}.`);
  }

  // ---------------------------------------------------------- 3. goal / budget memory
  const cat = detectCategory(t);
  const budget = parseBudget(t);
  const g = parseGoal(t);
  const goalUpdate: Record<string, unknown> = {};
  if (cat && cat !== ss.goal.category) { goalUpdate.category = cat; rs.askedPreference = false; }
  if (budget) goalUpdate.budget = budget;
  if (g.use) goalUpdate.use_case = g.use;
  if (g.exclude.length) goalUpdate.exclude_use_cases = g.exclude;
  if (g.prefs.length) goalUpdate.preferences = g.prefs;
  // goal-based inference: calls / meetings without a category -> headphones / headset
  let inferred = false;
  if (!cat && !ss.goal.category && g.use === 'calls') { goalUpdate.category = 'headphones'; inferred = true; }
  if (!cat && !ss.goal.category && g.use === 'gaming') { goalUpdate.category = 'headphones'; inferred = true; }

  // ---------------------------------------------------------- 4. devil's advocate on "cheapest"
  if (/cheapest|sabse sasta|lowest price|sabse kam/.test(t)) {
    Object.assign(ss.goal, goalUpdate);
    if (!ss.goal.category) return say('Kis cheez mein sabse sasta chahiye: headphones, earbuds, smartwatch?', 'Cheapest what: headphones, earbuds or a smartwatch?');
    const deal = executeTool(sessionId, 'find_best_deal', { ...ss.goal, limit: 3 });
    if (!ok(deal) || !deal.data.recommendations.length) return say('Is budget mein kuch in-stock nahi mila.', 'Nothing in stock matches that.');
    const cheapest = deal.data.recommendations.find((d: any) => d.tags.includes('cheapest')) ?? deal.data.recommendations[0];
    const c = executeTool(sessionId, 'critique_choice', { product_id: cheapest.product_id });
    if (ok(c) && c.data.verdict === 'reconsider' && c.data.better_alternative) {
      const b = c.data.better_alternative;
      return say(`Zaroor! Sabse sasta ${cheapest.name} hai, ${rupees(cheapest.final_price)}, accha price hai. Bas ek friendly tip: ${c.data.concerns[0].toLowerCase()}. Sirf ${rupees(b.extra_cost)} zyada mein ${b.name} aapke kaam ke liye kaafi behtar rahega. Dono compare karun?`,
        `Sure! The cheapest is ${cheapest.name} at ${rupees(cheapest.final_price)}, a great price. Quick friendly tip: ${c.data.concerns[0].toLowerCase()}. For just ${rupees(b.extra_cost)} more, ${b.name} would suit you much better. Want me to compare them?`);
    }
    return say(`Sabse sasta ${cheapest.name} hai, ${rupees(cheapest.final_price)}, aur aapki zaroorat ke liye theek hai. Cart mein daalun?`, `The cheapest is ${cheapest.name} at ${rupees(cheapest.final_price)}, and it is a reasonable fit. Add it to the cart?`);
  }

  // ---------------------------------------------------------- 5. compound actions: add / coupon / checkout
  const wantsAdd = /\b(cart|add|daal|dal do|le lo|lena|buy this|yeh lo)\b/.test(t) && !/remove|hata/.test(t);
  const explicitCode = raw.toUpperCase().match(/\b(WELCOME10|SAVE200|[A-Z]{3,}\d{2,})\b/)?.[1];
  const wantsCoupon = Boolean(explicitCode) || /coupon|discount|offer|promo|code|laga|kam kar/.test(t);
  const wantsCheckout = /\b(order|checkout|place|buy now|kharid|purchase)\b/.test(t) && !/compare/.test(t);
  if (wantsAdd || wantsCoupon || wantsCheckout) {
    const parts: string[] = [];
    if (wantsAdd) {
      const n = parseOrdinal(t, ss.shown.length);
      const explicitId = raw.toUpperCase().match(/\b([A-Z]{2}-\d{3})\b/)?.[1];
      const pid = explicitId ?? (n ? at(n) : ss.focusId ?? at(1));
      if (!pid) return say('Kaunsa product add karun? Pehle best deal dhoondhte hain — budget aur zaroorat bataiye.', 'Which product should I add? Tell me your budget and need first.');
      const qty = Number(t.match(/\b([1-5])\s*(pcs|piece|units?|quantity)\b/)?.[1] ?? 1);
      const r = executeTool(sessionId, 'add_to_cart', { product_id: pid, quantity: qty });
      if (!ok(r)) return say(`Add nahi ho paya: ${errMsg(r)}`, `Couldn't add it: ${errMsg(r)}`);
      parts.push(say(`${r.data.added.name} cart mein add ho gaya.`, `Added ${r.data.added.name} to your cart.`));
      if (r.data.advisor?.better_alternative) parts.push(say(`Ek chhota sa tip: ${r.data.advisor.concerns[0].toLowerCase()}, par choice aapki hai.`, `Small friendly heads-up: ${r.data.advisor.concerns[0].toLowerCase()}, but it's your call.`));
    }
    if (wantsCoupon) {
      let code = explicitCode;
      if (!code) {
        const fc = executeTool(sessionId, 'find_best_coupon', { cart_context: 'current_cart' });
        code = ok(fc) ? fc.data.best_coupon?.code : undefined;
        if (!code) parts.push(say('Is cart par abhi koi coupon eligible nahi hai.', 'No coupon is eligible for this cart yet.'));
      }
      if (code) {
        const r = executeTool(sessionId, 'apply_coupon', { coupon_code: code });
        if (!ok(r)) parts.push(say(`Coupon nahi laga: ${errMsg(r)}.`, `Coupon not applied: ${errMsg(r)}.`));
        else parts.push(say(`${code} laga diya, ${rupees(r.data.savings)} ki bachat.`, `Applied ${code}, saving ${rupees(r.data.savings)}.`));
      }
    }
    if (getCart(sessionId).items.length) {
      const r = executeTool(sessionId, 'create_demo_order', { confirmed: false });
      if (ok(r)) {
        const s = r.data.summary;
        parts.push(say(`Final total ${rupees(s.total)}${s.discount ? `, ${rupees(s.discount)} discount ke baad` : ''}. Demo checkout confirm karun?`,
          `Your final total is ${rupees(s.total)}${s.discount ? ` after the ${rupees(s.discount)} discount` : ''}. Would you like to proceed with demo checkout? Say yes to confirm.`));
      } else parts.push(errMsg(r));
    } else if (wantsCheckout) parts.push(say('Cart khaali hai, pehle koi product add kijiye.', 'Your cart is empty — add a product first.'));
    return parts.join(' ');
  }

  // ---------------------------------------------------------- 6. compare
  if (/compare|difference|farak|fark|tulna|\bvs\b|versus/.test(t)) {
    const ords = parseOrdinals(t, ss.shown.length);
    const picks = (ords.length >= 2 ? ords : [1, 2]).map(at).filter(Boolean);
    if (picks.length < 2) return say('Compare karne ke liye pehle kuch products dhoondhte hain. Kya chahiye?', 'Let me find some products first. What are you looking for?');
    const r = executeTool(sessionId, 'compare_products', { product_ids: picks.slice(0, 3) });
    if (!ok(r)) return errMsg(r);
    const [a, b] = r.data.products;
    const w = r.data.winners;
    const uc = ss.goal.use_case;
    const key = uc === 'calls' ? 'mic_score' : uc === 'gaming' ? 'latency_ms' : ss.goal.preferences?.includes('comfort') ? 'comfort_score' : 'battery_hours';
    const label = { mic_score: say('mic', 'microphone'), latency_ms: 'latency', comfort_score: 'comfort', battery_hours: 'battery' }[key];
    const winner = w[key] ? r.data.products.find((p: any) => p.id === w[key]) : null;
    const fmtv = (p: any) => (p.specs[key] != null ? `${p.specs[key]}${key === 'battery_hours' ? 'h' : key === 'latency_ms' ? 'ms' : '/10'}` : 'n/a');
    return say(`${a.name}: ${rupees(a.final_price)}, ${label} ${fmtv(a)}. ${b.name}: ${rupees(b.final_price)}, ${label} ${fmtv(b)}.${winner ? ` ${label} mein ${winner.name} aage hai.` : ''}`,
      `${a.name}: ${rupees(a.final_price)}, ${label} ${fmtv(a)}. ${b.name}: ${rupees(b.final_price)}, ${label} ${fmtv(b)}.${winner ? ` ${winner.name} wins on ${label}.` : ''}`);
  }

  // ---------------------------------------------------------- 7. "something cheaper"
  if (/\b(sasta|saste|cheaper|less expensive|kam price|kam daam|lower price)\b/.test(t)) {
    Object.assign(ss.goal, goalUpdate);
    const ref = ss.focusId;
    if (!ref) return say('Kis product se sasta? Pehle kuch dikhata hoon — kya chahiye?', 'Cheaper than what? Tell me what you need first.');
    const r = executeTool(sessionId, 'find_best_deal', { ...ss.goal, cheaper_than_product_id: ref, limit: 3 });
    if (!ok(r) || !r.data.recommendations.length) return say('Isse sasta koi in-stock option nahi hai jo aapki zaroorat poori kare.', 'There is nothing cheaper in stock that meets your needs.');
    return dealReply(r.data, say, true);
  }

  // ---------------------------------------------------------- 8. search / goal clarification / negotiation
  if (Object.keys(goalUpdate).length || (g.use || g.prefs.length)) {
    Object.assign(ss.goal, goalUpdate);
    const G = ss.goal;
    if (!G.category) return say('Samjha! Yeh headphones, earbuds, smartwatch ya speaker mein se kya chahiye?', 'Got it! Is this for headphones, earbuds, a smartwatch or a speaker?');
    const audio = ['earbuds', 'headphones', 'speaker'].includes(G.category);
    if (audio && !G.use_case && !G.preferences?.length && !rs.askedPreference) {
      rs.askedPreference = true;
      return say('Bilkul! Aapko kya zyada important hai: sound quality, battery life, noise cancellation, ya calls ke liye mic?', 'Sure! What matters most: sound quality, battery life, noise cancellation, or a good mic for calls?');
    }
    if (!G.budget && !rs.askedBudget) {
      rs.askedBudget = true;
      return say(`${inferred ? 'Meetings ke liye headphones ya headset sabse sahi rahega. ' : ''}Aapka budget kitna hai?`, `${inferred ? 'For meetings, headphones or a headset make most sense. ' : ''}What is your budget?`);
    }
    const r = executeTool(sessionId, 'find_best_deal', { ...G, limit: 3 });
    if (!ok(r)) return errMsg(r);
    if (!r.data.recommendations.length) return say('Is budget mein abhi kuch in-stock nahi hai. Budget thoda badhayein?', 'Nothing in stock fits that budget. Could you stretch it a little?');
    return dealReply(r.data, say, false);
  }

  if (/\b(hi|hello|hey|namaste|namaskar)\b/.test(t)) return say(`Hi! Main ${config.appName} hoon, aapka shopping buddy. Budget aur zaroorat bataiye — jaise "5000 ke andar office calls ke liye headphones".`, `Hi! I'm ${config.appName}, your shopping buddy. Tell me your budget and need, like "headphones under 5,000 for office calls".`);
  return say('Main headphones, earbuds, smartwatch, speakers aur accessories mein best deal dhoondh sakta hoon. Budget aur zaroorat bataiye.', 'I can find the best deal on headphones, earbuds, smartwatches, speakers and accessories. Tell me your budget and need.');
}

type Say = (h: string, e: string) => string;

function summaryReply(s: any, say: Say) {
  const items = s.items.map((i: any) => `${i.quantity} ${i.name}`).join(', ');
  return say(`Order mein ${items}. Discount ${rupees(s.discount)}, final total ${rupees(s.total)}. Payment simulated hai. Confirm karun?`,
    `Your order: ${items}. Discount ${rupees(s.discount)}, final total ${rupees(s.total)}. Payment is simulated. Shall I confirm?`);
}

function dealReply(d: any, say: Say, cheaper: boolean) {
  const recs = d.recommendations;
  const best = recs.find((r: any) => r.tags.includes('best_pick')) ?? recs[0];
  const bestPos = best.position;
  const coupon = best.best_coupon ? say(`, ${best.best_coupon.code} se ${rupees(best.discount)} off`, ` with ${rupees(best.discount)} off via ${best.best_coupon.code}`) : '';
  const why = (best.advantages[0] ?? '').toLowerCase();
  const da = d.devils_advocate;
  const critic = !cheaper && da && da.verdict === 'reconsider'
    ? say(` Sabse sasta ${da.name} hai, price accha hai, bas ek tip: ${da.concerns[0].toLowerCase()}.`, ` The cheapest, ${da.name}, is great value; one friendly tip: ${da.concerns[0].toLowerCase()}.`)
    : '';
  const intro = cheaper ? say(`Haan, ${recs.length} saste options hain.`, `Yes, ${recs.length} cheaper options.`) : say(`${recs.length} options mile.`, `I found ${recs.length} options.`);
  return `${intro}${critic}` + say(` Option ${bestPos}, ${best.name}, best pick hai: ${why}, final ${rupees(best.final_price)}${coupon}.`,
    ` Option ${bestPos}, ${best.name}, is the best pick: ${why}, final ${rupees(best.final_price)}${coupon}.`);
}
