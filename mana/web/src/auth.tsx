import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export type Me = { id: string; username: string; display_name: string; role: 'parent' | 'member' | 'child'; avatar_photo_id: string | null; totp_enabled?: boolean; age_group: 'young' | 'teen' | 'adult' | null; permissions: Record<string, number>; settings: null | { voice_notifications: boolean; read_aloud_default: boolean; mic_allowed: boolean; weekly_goal_stars: number; notifications_enabled: boolean } };
const Ctx = createContext<{ me: Me | null; loading: boolean; login: (u: string, p: string, totp?: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void> }>(null as any);
export const useAuth = () => useContext(Ctx);
/** Permission level for a module: 0 none, 1 read, 2 write (Mana always 2). */
export const useLevel = (m: string) => useAuth().me?.permissions?.[m] ?? 0;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [loading, setLoading] = useState(true);
  const refresh = async () => { try { setMe(await api<Me>('/me')); } catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const login = async (username: string, password: string, totp?: string) => { await api('/auth/login', { body: { username: username.trim().toLowerCase(), password, ...(totp ? { totp } : {}) } }); await refresh(); };
  const logout = async () => { await api('/auth/logout', { method: 'POST', body: {} }); setMe(null); };
  return <Ctx.Provider value={{ me, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}
