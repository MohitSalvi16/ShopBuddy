import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Download, Keyboard, MessagesSquare, Mic, User, X } from 'lucide-react';
import { useStore } from '../store';
import { BRAND } from '../brand';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

const time = (at: number) => new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** Full conversation history in a right-side panel, with a .txt export. */
export function ConversationDrawer() {
  const open = useStore((s) => s.chatOpen);
  const messages = useStore((s) => s.messages);
  const set = useStore((s) => s.set);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, messages.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ chatOpen: false }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, set]);

  const download = () => {
    const lines = messages.map((m) => `[${new Date(m.at).toLocaleString('en-IN')}] ${m.role === 'user' ? 'You' : BRAND.name} (${m.source}): ${m.text}`);
    const blob = new Blob([`${BRAND.name} conversation\n\n${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${BRAND.name.toLowerCase()}-conversation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => set({ chatOpen: false })} />
          <motion.aside role="dialog" aria-label="Conversation" className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-navy-900/95"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            <div className="flex items-center justify-between gap-2 border-b border-white/10 p-4">
              <div className="flex items-center gap-2">
                <MessagesSquare className="size-5 text-vaani-cyan" />
                <p className="font-display text-lg font-semibold">Conversation</p>
                <Badge variant="muted">{messages.length}</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary" onClick={download} disabled={!messages.length} aria-label="Download conversation"><Download /> Save</Button>
                <Button size="icon" variant="ghost" aria-label="Close conversation" onClick={() => set({ chatOpen: false })}><X /></Button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4 scroll-thin" data-testid="conversation-log">
              {messages.length === 0 && (
                <p className="mt-10 text-center text-sm text-slate-500">No conversation yet. Speak or type to {BRAND.name} and everything you say appears here.</p>
              )}
              {messages.map((m) => (
                <div key={m.id} data-testid={`conv-${m.role}`} className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
                  <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', m.role === 'user' ? 'bg-white/10' : 'bg-gradient-to-br from-vaani-purple to-vaani-cyan')}>
                    {m.role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                  </span>
                  <div className={cn('max-w-[82%]', m.role === 'user' && 'text-right')}>
                    <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-slate-500" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <span>{m.role === 'user' ? 'You' : BRAND.name}</span>
                      <span>·</span>
                      <span>{time(m.at)}</span>
                      {m.source === 'voice' ? <Mic className="size-3" aria-label="spoken" /> : <Keyboard className="size-3" aria-label="typed" />}
                    </div>
                    <div className={cn('inline-block rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed', m.role === 'user' ? 'rounded-tr-sm bg-white/10' : 'rounded-tl-sm border border-vaani-purple/30 bg-vaani-purple/10')}>
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
