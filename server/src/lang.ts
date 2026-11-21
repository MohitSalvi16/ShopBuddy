/**
 * Language helpers for English / Hindi / Hinglish.
 * - detectLanguage: decides the reply language & TTS locale.
 * - normalizeForRules: maps common Devanagari shopping words + digits to Roman Hinglish so the
 *   deterministic rule engine understands hi-IN speech-recognition output. (The LLM path needs no mapping.)
 */
export type Lang = 'en' | 'hi' | 'hinglish';

const DEVANAGARI = /[ऀ-ॿ]/;
const HINGLISH_WORDS = /\b(mujhe|chahiye|chahie|karo|kar|kardo|hai|hain|kya|wala|wali|wale|mein|andar|ke|ka|ki|liye|achhi|accha|acha|koi|kitna|dikhao|batao|haan|nahi|nahin|bhai|sasta|isse|laga|lagao|daal|dal|aur|bhi|thoda|zyada|kuch|yaar|boliye|chalega)\b/g;

export function detectLanguage(text: string): Lang {
  if (DEVANAGARI.test(text)) return 'hi';
  const hits = text.toLowerCase().match(HINGLISH_WORDS)?.length ?? 0;
  return hits >= 2 || (hits === 1 && text.split(/\s+/).length <= 4) ? 'hinglish' : 'en';
}

const DIGITS: Record<string, string> = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };

const WORDS: [string, string][] = [
  ['हेडफ़ोन', 'headphones'], ['हेडफोन', 'headphones'], ['हेडसेट', 'headset'], ['ईयरबड्स', 'earbuds'], ['इयरबड्स', 'earbuds'], ['बड्स', 'buds'],
  ['स्मार्टवॉच', 'smartwatch'], ['घड़ी', 'watch'], ['स्पीकर', 'speaker'], ['चार्जर', 'charger'], ['पावर बैंक', 'power bank'],
  ['मुझे', 'mujhe'], ['चाहिए', 'chahiye'], ['चाहिये', 'chahiye'], ['के अंदर', 'ke andar'], ['अंदर', 'andar'], ['तक', 'tak'], ['रुपये', 'rupees'], ['रुपए', 'rupees'], ['हज़ार', 'hazaar'], ['हजार', 'hazaar'],
  ['सबसे सस्ता', 'cheapest'], ['सस्ता', 'sasta'], ['सस्ते', 'sasta'], ['बेस्ट', 'best'], ['अच्छा', 'accha'], ['अच्छी', 'achhi'], ['दिखाओ', 'dikhao'], ['दिखाइए', 'dikhao'],
  ['ऑफिस', 'office'], ['ऑफ़िस', 'office'], ['कॉल', 'call'], ['कॉलिंग', 'calling'], ['मीटिंग', 'meeting'], ['गेमिंग', 'gaming'], ['म्यूजिक', 'music'], ['गाने', 'music'], ['बैटरी', 'battery'], ['आरामदायक', 'comfortable'],
  ['कार्ट', 'cart'], ['डाल दो', 'daal do'], ['ऐड', 'add'], ['कूपन', 'coupon'], ['डिस्काउंट', 'discount'], ['छूट', 'discount'], ['लगा दो', 'laga do'], ['लगाओ', 'lagao'],
  ['ऑर्डर', 'order'], ['कन्फर्म', 'confirm'], ['हाँ', 'haan'], ['हां', 'haan'], ['जी', 'ji'], ['नहीं', 'nahi'], ['ठीक है', 'theek hai'],
  ['पहला', 'pehla'], ['पहले', 'pehle'], ['दूसरा', 'dusra'], ['दूसरे', 'dusre'], ['दूसरी', 'dusri'], ['तीसरा', 'teesra'], ['वाला', 'wala'], ['वाली', 'wali'],
  ['तुलना', 'compare'], ['कंपेयर', 'compare'], ['के लिए', 'ke liye'], ['लिए', 'liye'], ['और', 'aur'], ['भाई', 'bhai'], ['कुछ', 'kuch'], ['इससे', 'isse'], ['है', 'hai'], ['में', 'mein'], ['का', 'ka'], ['की', 'ki'], ['के', 'ke'],
];

export function normalizeForRules(text: string): string {
  let t = text.replace(/[०-९]/g, (d) => DIGITS[d]);
  for (const [hi, ro] of WORDS) t = t.split(hi).join(` ${ro} `);
  return t.replace(/\s+/g, ' ').trim();
}

/** Murf locale for a reply: Devanagari text -> hi-IN voice, otherwise the configured (en-IN) locale. */
export function ttsLocaleFor(text: string, defaultLocale: string, hindiLocale: string) {
  return DEVANAGARI.test(text) ? hindiLocale : defaultLocale;
}

export type LangPref = 'auto' | 'en' | 'hi' | 'hinglish';
export const LANG_PREFS: LangPref[] = ['auto', 'en', 'hi', 'hinglish'];

/** Effective reply language: the explicit choice wins, otherwise match the customer's last message. */
export function resolveLanguage(pref: LangPref | undefined, lastUserText: string): Lang {
  return pref && pref !== 'auto' ? pref : detectLanguage(lastUserText);
}
