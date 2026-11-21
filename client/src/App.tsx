import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass, MessagesSquare, ShoppingCart } from 'lucide-react';
import { ConversationDrawer } from './components/ConversationDrawer';
import { useStore } from './store';
import { api, sessionId } from './lib/api';
import type { UiEvent } from './lib/types';
import { Onboarding } from './components/Onboarding';
import { VoicePanel, type VoiceControls } from './components/VoicePanel';
import { Results, Comparison, ToolLog, OrderSuccess, CartDrawer } from './components/ShopPanels';
import { DevilsAdvocate, BudgetCard } from './components/DealPanels';
import { ReviewsPanel } from './components/ReviewPanels';
import { Badge } from './components/ui/badge';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BRAND } from './brand';
import type { AgoraVoice } from './voice/agoraVoice';
import { LiteVoice, liteSupported } from './voice/liteVoice';

export default function App() {
  const { onboarded, caps, set, handle, mode, cart, messages } = useStore();
  const agoraRef = useRef<AgoraVoice | null>(null);
  // Agora SDK is ~1.5MB: load it only when Agora Live voice is used.
  const getAgora = async () => (agoraRef.current ??= new (await import('./voice/agoraVoice')).AgoraVoice());
  const lite = useRef(new LiteVoice());
  const [connected, setConnected] = useState(false);

  // Capabilities + live event stream from the backend
  useEffect(() => {
    api.config().then((c) => set({ caps: c, mode: c.agoraVoice ? 'agora' : 'lite' })).catch(() => set({ error: 'Backend not reachable on /api — is the server running on :4000?' }));
    let es: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      es = new EventSource(`/api/events?session=${sessionId}`);
      es.onopen = () => setConnected(true);
      es.onmessage = (m) => { try { handle(JSON.parse(m.data) as UiEvent); } catch { /* ignore malformed */ } };
      es.onerror = () => { setConnected(false); es?.close(); retry = window.setTimeout(connect, 2000); };
    };
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, [set, handle]);


  const toggle = useCallback(async () => {
    const s = useStore.getState();
    if (s.voice !== 'off') {
      if (s.mode === 'agora') await (await getAgora()).stop(); else lite.current.stop();
      return;
    }
    if (s.mode === 'agora') await (await getAgora()).start().catch(() => {});
    else await lite.current.start().catch((e) => set({ error: e.message }));
  }, [set]);

  const sendText = useCallback((t: string) => {
    const s = useStore.getState();
    // In Agora mode the agent hears the mic; typed text still runs the same agent via REST.
    if (s.mode === 'agora' && s.voice !== 'off') {
      api.chat([...s.messages.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: t }], s.language).catch((e) => set({ error: e.message }));
      return;
    }
    lite.current.handleUtterance(t);
  }, [set]);

  const controls: VoiceControls = { toggle, sendText, canAgora: Boolean(caps?.agoraVoice), liteSupported };

  return (
    <div className="min-h-full">
      <AnimatePresence mode="wait">
        {!onboarded ? (
          <motion.div key="onb" exit={{ opacity: 0, y: -20 }} className="min-h-full">
            <Onboarding caps={caps} onStart={() => set({ onboarded: true })} />
          </motion.div>
        ) : (
          <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-[1500px] px-4 py-4 sm:px-6">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-vaani-purple to-vaani-cyan"><Compass className="size-5" /></span>
                <div>
                  <p className="font-display text-lg font-semibold leading-none">{BRAND.name}</p>
                  <p className="text-[11px] text-slate-500">{BRAND.subtitle} · demo store</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={connected ? 'success' : 'danger'}>{connected ? 'Live sync' : 'Offline'}</Badge>
                <Badge variant={mode === 'agora' ? 'cyan' : 'default'}>{mode === 'agora' ? 'Agora Live voice' : 'Lite voice'}</Badge>
                <Badge variant={caps?.murf ? 'success' : 'warn'}>{caps?.murf ? 'Murf Falcon' : 'No TTS key'}</Badge>
                <button onClick={() => set({ chatOpen: true, cartOpen: false })} aria-label="Open conversation"
                  className="relative flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm hover:bg-white/10">
                  <MessagesSquare className="size-4" /> <span className="hidden sm:inline">Conversation</span>
                  {messages.length > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-vaani-purple px-1 text-[11px] font-bold text-white">{messages.length}</span>}
                </button>
                <button onClick={() => set({ cartOpen: true, chatOpen: false })} aria-label="Open cart"
                  className="relative flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm hover:bg-white/10">
                  <ShoppingCart className="size-4" /> Cart
                  {(cart?.item_count ?? 0) > 0 && (
                    <motion.span key={cart?.item_count} initial={{ scale: 1.6 }} animate={{ scale: 1 }}
                      className="grid min-w-5 place-items-center rounded-full bg-vaani-cyan px-1 text-[11px] font-bold text-navy-900">{cart?.item_count}</motion.span>
                  )}
                </button>
              </div>
            </header>
            <main className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
              <div className="min-w-0 lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]"><ErrorBoundary name="Voice panel"><VoicePanel controls={controls} /></ErrorBoundary></div>
              <div className="min-w-0 space-y-4"><ErrorBoundary name="Shopping panel">
                <DevilsAdvocate />
                <ReviewsPanel />
                <Results />
                <Comparison />
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
                  <BudgetCard />
                  <ToolLog />
                </div>
              </ErrorBoundary></div>
            </main>
            <CartDrawer />
            <ConversationDrawer />
            <OrderSuccess />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
