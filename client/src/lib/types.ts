export interface Product {
  id: string; name: string; brand: string; category: string;
  price: number; mrp: number; rating: number; reviews: number; stock: number;
  highlights: string[]; specs: Record<string, string | number | boolean>; image: string;
}

export interface Deal {
  position: number; product_id: string; name: string; brand: string; category: string; image: string;
  price: number; mrp: number; rating: number; stock: number;
  best_coupon: { code: string; discount: number } | null; discount: number; final_price: number;
  scores: { requirement: number; quality: number; value: number; preference: number; total: number };
  advantages: string[]; disadvantages: string[]; reasoning: string; tags: string[];
}
export interface Critique {
  product_id?: string; name?: string; final_price?: number; score?: number;
  product?: { product_id: string; name: string; final_price: number; score: number };
  verdict: 'reconsider' | 'acceptable' | 'good_choice'; concerns: string[]; message: string;
  better_alternative: { product_id: string; name: string; final_price: number; score: number; extra_cost: number; why: string[] } | null;
}
export interface DealResult {
  goal: { category: string; budget: number | null; use_case: string; excluded_use_cases: string[]; preferences: string[] };
  weights: Record<string, number>; candidates_considered: number;
  excluded: { product_id: string; name: string; reason: string }[];
  recommendations: Deal[]; best_pick: string | null; devils_advocate: Critique | null;
}
export type PricedProduct = Product & { final_price?: number; best_coupon?: { code: string; discount: number } | null };

export interface CartItem { product_id: string; name: string; brand: string; price: number; quantity: number; image: string; line_total: number; stock: number }
export interface Cart {
  cart_id: string; items: CartItem[]; item_count: number; subtotal: number;
  coupon: { code: string; valid: boolean; note: string } | null;
  discount: number; delivery_fee: number; total: number; currency: string;
}

export interface Order {
  order_id: string; status: string; payment: string;
  items: { product_id: string; name: string; price: number; quantity: number }[];
  subtotal: number; discount: number; total: number; coupon_code: string | null;
  created_at: string; estimated_delivery: string;
}

export interface Caps {
  llm: boolean; llmProvider: string; murf: boolean; agoraVoice: boolean;
  missingForAgoraVoice: string[]; greeting: string;
  languages?: { understanding: string[]; stt: { lite: string[]; agora: string }; tts: { default: string; hindi: string } | null; note: string };
}

export interface Msg { id: string; role: 'user' | 'assistant'; text: string; source: 'voice' | 'text' }
export interface ToolEvent { id: string; name: string; args: unknown; ok: boolean; error?: string; at: number }

export type UiEvent =
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; source: 'voice' | 'text' }
  | { type: 'status'; state: 'thinking' | 'idle' }
  | { type: 'tool'; name: string; args: unknown; ok: boolean; error?: string }
  | { type: 'products'; title: string; items: Product[] }
  | { type: 'comparison'; items: PricedProduct[] }
  | { type: 'deal'; title: string; result: DealResult; items: Product[] }
  | { type: 'critique'; critique: Critique }
  | { type: 'focus'; product: Product }
  | { type: 'cart'; cart: Cart }
  | { type: 'checkout'; summary: Cart }
  | { type: 'order'; order: Order }
  | { type: 'agent'; state: string; detail?: string };

export type VoiceState = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting';
export type VoiceMode = 'agora' | 'lite';

export type LangPref = 'auto' | 'en' | 'hi' | 'hinglish';
