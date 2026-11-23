import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { unreadConvs } from './Chat';

/** Unread counters for chat and Mom's messages (polled while the app is open). */
export function useUnread() {
  const { me } = useAuth(); const [chat, setChat] = useState(0); const [inbox, setInbox] = useState(0);
  useEffect(() => {
    if (!me) return; let dead = false;
    const tick = async () => {
      try { if ((me.permissions.chat ?? 0) >= 1) { const r = await api<any[]>('/chat/summary'); if (!dead) setChat(unreadConvs(me.id, r).length); } } catch { /* offline */ }
      try { if (me.role !== 'parent' && (me.permissions.inbox ?? 0) >= 1) { const r = await api<{ count: number }>('/mom-messages/unread'); if (!dead) setInbox(r.count); } } catch { /* offline */ }
    };
    void tick(); const t = setInterval(tick, 15000);
    window.addEventListener('mana-chat-seen', tick); window.addEventListener('mana-inbox-changed', tick);
    return () => { dead = true; clearInterval(t); window.removeEventListener('mana-chat-seen', tick); window.removeEventListener('mana-inbox-changed', tick); };
  }, [me]);
  return { chat, inbox };
}
