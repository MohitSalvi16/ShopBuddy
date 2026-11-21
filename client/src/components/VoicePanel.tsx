import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, Mic, Radio, AlertTriangle, X, User, Bot, Languages } from 'lucide-react';
import { useStore } from '../store';
import type { LangPref, VoiceState } from '../lib/types';
import { VoiceOrb, Waveform } from './VoiceOrb';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { cn } from '../lib/utils';
import { BRAND } from '../brand';

const LANGS: { value: LangPref; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Replies in the language you speak' },
  { value: 'en', label: 'English', hint: 'Replies in English' },
  { value: 'hi', label: 'हिंदी', hint: 'हिंदी में जवाब · Hindi voice' },
  { value: 'hinglish', label: 'Hinglish', hint: 'Replies in Hinglish' },
];

const SAMPLES = [
  'Bhai, ₹5,000 ke andar office calls ke liye best headphones chahiye.',
  'Compare the first two.',
  'Second wala cart mein add kar do aur coupon apply karo.',
  'Yes, confirm.',
];

export interface VoiceControls {
  toggle: () => void;
  sendText: (t: string) => void;
  canAgora: boolean;
  liteSupported: boolean;
}

export function useDisplayState(): VoiceState {
  const { voice, thinking, agentLevel, mode } = useStore();
  if (voice === 'off' || voice === 'connecting' || voice === 'reconnecting') return voice;
  if (mode === 'agora') {
    if (agentLevel > 0.06) return 'speaking';
    if (thinking) return 'thinking';
    return 'listening';
  }
  return voice;
}

/** True on short viewports (e.g. 1280x720 laptops) so the transcript keeps enough room. */
function useShortScreen() {
  const q = '(max-height: 860px) and (min-width: 1024px)';
  const [short, setShort] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setShort(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return short;
}

export function VoicePanel({ controls }: { controls: VoiceControls }) {
  const { messages, mode, micLevel, agentLevel, error, caps, set, thinking, ttsNote, language, setLanguage } = useStore();
  // Agora fixes ASR language + TTS voice when the agent joins, so the choice is locked during a live Agora call.
  const state = useDisplayState();
  const short = useShortScreen();
  const langLocked = mode === 'agora' && state !== 'off';
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, which React would treat as a cleanup fn and crash.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, thinking]);

  const nextSample = SAMPLES.find((s) => !messages.some((m) => m.role === 'user' && m.text === s));
  const submit = (t: string) => { const v = t.trim(); if (!v) return; controls.sendText(v); setText(''); };

  return (
    <Card className="flex h-full min-h-[600px] flex-col overflow-hidden lg:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-vaani-cyan" />
          <span className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">{BRAND.name}</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5 text-xs">
          {(['agora', 'lite'] as const).map((m) => (
            <button key={m} disabled={state !== 'off' || (m === 'agora' && !controls.canAgora) || (m === 'lite' && !controls.liteSupported)}
              onClick={() => set({ mode: m })}
              title={m === 'agora' ? (controls.canAgora ? 'Agora RTC + Conversational AI + Murf' : `Missing: ${caps?.missingForAgoraVoice.join(', ')}`) : 'Browser speech recognition + Murf TTS'}
              className={cn('rounded-md px-2.5 py-1 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40', mode === m ? 'bg-gradient-to-r from-vaani-purple/70 to-vaani-cyan/60 text-white' : 'text-slate-400 hover:text-white')}>
              {m === 'agora' ? 'Agora Live' : 'Lite voice'}
            </button>
          ))}
        </div>
      </div>

      <div className={cn('flex flex-col items-center px-5', short ? 'gap-2 pt-3 pb-3' : 'gap-3 pt-6 pb-4')}>
        <VoiceOrb state={state} level={state === 'speaking' ? agentLevel : micLevel} onClick={controls.toggle} size={short ? 120 : 200} />
        <Waveform level={state === 'speaking' ? agentLevel : state === 'listening' ? micLevel : 0} color={state === 'speaking' ? 'purple' : 'cyan'} />
        <div className="flex flex-wrap items-center justify-center gap-2">
          {state === 'off'
            ? <Button onClick={controls.toggle}><Mic /> Start conversation</Button>
            : <Button variant="danger" onClick={controls.toggle}><Square /> End conversation</Button>}
        </div>
        <div className="flex w-full flex-col items-center gap-1" role="radiogroup" aria-label="Reply language">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            <Languages className="mx-1 size-3.5 text-vaani-cyan" aria-hidden />
            {LANGS.map((l) => (
              <button key={l.value} role="radio" aria-checked={language === l.value} disabled={langLocked}
                title={langLocked ? 'End the call to change language' : l.hint}
                onClick={() => setLanguage(l.value)}
                className={cn('rounded-lg px-2.5 py-1 text-xs transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                  language === l.value ? 'bg-gradient-to-r from-vaani-purple/80 to-vaani-cyan/70 text-white' : 'text-slate-400 hover:text-white')}>
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">{langLocked ? 'End the call to change language' : LANGS.find((l) => l.value === language)?.hint}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          <Badge variant={mode === 'agora' ? 'cyan' : 'default'}>{mode === 'agora' ? 'Agora RTC · ConvoAI · Murf' : 'Web Speech · Murf Falcon'}</Badge>
          <Badge variant="muted">{caps?.llmProvider ?? '…'}</Badge>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mx-5 mb-2 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{error}</span>
            <button onClick={() => set({ error: null })} aria-label="Dismiss error" className="cursor-pointer"><X className="size-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {ttsNote && <p className="mx-5 mb-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">{ttsNote}</p>}

      <div className="flex-1 space-y-3 overflow-y-auto border-t border-white/10 px-5 py-4 scroll-thin" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-center text-sm text-slate-500">Conversation transcript appears here. Speak, or tap a suggestion below.</p>
        )}
        {messages.map((m) => (
          <motion.div key={m.id} data-testid={`msg-${m.role}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', m.role === 'user' ? 'bg-white/10' : 'bg-gradient-to-br from-vaani-purple to-vaani-cyan')}>
              {m.role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
            </span>
            <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed', m.role === 'user' ? 'rounded-tr-sm bg-white/10' : 'rounded-tl-sm border border-vaani-purple/30 bg-vaani-purple/10')}>
              {m.text}
              <span className="ml-2 align-middle text-[10px] text-slate-500">{m.source === 'voice' ? '🎙' : ''}</span>
            </div>
          </motion.div>
        ))}
        {thinking && (
          <div className="flex items-center gap-1.5 pl-9">
            {[0, 1, 2].map((i) => <motion.span key={i} className="size-1.5 rounded-full bg-vaani-cyan" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />)}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 p-3">
        {nextSample && (
          <button onClick={() => submit(nextSample)} className="mb-2 w-full truncate rounded-lg border border-dashed border-vaani-cyan/30 px-3 py-1.5 text-left text-xs text-cyan-200/80 transition hover:bg-vaani-cyan/10 cursor-pointer">
            Try: “{nextSample}”
          </button>
        )}
        <form onSubmit={(e) => { e.preventDefault(); submit(text); }} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type in English, Hindi or Hinglish…"
            className="h-10 flex-1 rounded-xl border border-white/10 bg-navy-800/80 px-3 text-sm placeholder:text-slate-500 focus:border-vaani-cyan/50 focus:outline-none" />
          <Button type="submit" size="icon" aria-label="Send"><Send /></Button>
        </form>
      </div>
    </Card>
  );
}
