import { create } from 'zustand';
import type { LangPref, Caps, Cart, Critique, DealResult, Msg, Order, PricedProduct, Product, ToolEvent, UiEvent, VoiceMode, VoiceState } from './lib/types';

interface State {
  caps: Caps | null;
  onboarded: boolean;
  voice: VoiceState;
  mode: VoiceMode;
  thinking: boolean;
  micLevel: number;
  agentLevel: number;
  error: string | null;
  messages: Msg[];
  results: { title: string; items: Product[]; deals?: DealResult } | null;
  comparison: PricedProduct[] | null;
  critique: Critique | null;
  cartOpen: boolean;
  ttsNote: string | null;
  language: LangPref;
  setLanguage: (l: LangPref) => void;
  focus: Product | null;
  cart: Cart | null;
  checkout: Cart | null;
  order: Order | null;
  tools: ToolEvent[];
  set: (p: Partial<State>) => void;
  handle: (e: UiEvent) => void;
}

const LANG_KEY = 'shopbuddy.language';
const initialLanguage = (): LangPref => {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'auto' || v === 'en' || v === 'hi' || v === 'hinglish') return v; } catch { /* storage blocked */ }
  return 'auto';
};

const uid = () => Math.random().toString(36).slice(2, 10);

export const useStore = create<State>((set, get) => ({
  caps: null,
  onboarded: false,
  voice: 'off',
  mode: 'lite',
  thinking: false,
  micLevel: 0,
  agentLevel: 0,
  error: null,
  messages: [],
  results: null,
  comparison: null,
  critique: null,
  cartOpen: false,
  ttsNote: null,
  language: initialLanguage(),
  setLanguage: (l) => { try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } set({ language: l }); },
  focus: null,
  cart: null,
  checkout: null,
  order: null,
  tools: [],
  set: (p) => set(p),
  handle: (e) => {
    switch (e.type) {
      case 'transcript': {
        const last = get().messages.at(-1);
        // Agora may retry a turn; avoid showing the exact same line twice in a row.
        if (last && last.role === e.role && last.text === e.text) return;
        set({ messages: [...get().messages, { id: uid(), role: e.role, text: e.text, source: e.source }] });
        break;
      }
      case 'status': set({ thinking: e.state === 'thinking' }); break;
      case 'tool': set({ tools: [{ id: uid(), name: e.name, args: e.args, ok: e.ok, error: e.error, at: Date.now() }, ...get().tools].slice(0, 30) }); break;
      case 'products': set({ results: { title: e.title, items: e.items }, comparison: null, focus: null, critique: null }); break;
      case 'deal': set({ results: { title: e.title, items: e.items, deals: e.result }, comparison: null, focus: null, critique: e.result.devils_advocate?.verdict === 'reconsider' ? e.result.devils_advocate : null }); break;
      case 'critique': set({ critique: e.critique }); break;
      case 'comparison': set({ comparison: e.items }); break;
      case 'focus': set({ focus: e.product }); break;
      case 'cart': { const co = get().checkout; set({ cart: e.cart, checkout: co && e.cart.items.length && co.total === e.cart.total ? co : null }); break; }
      case 'checkout': set({ checkout: e.summary, cartOpen: true }); break;
      case 'order': set({ order: e.order, checkout: null }); break;
      case 'agent': break;
    }
  },
}));
