import { useEffect, useRef, useState } from 'react';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { listen, speak, sttErrorText, sttSupported, stopSpeaking } from '../voice';
import { Avatar, Modal, useAction, useToast } from '../ui';

export const useKid = () => useAuth().me!.role === 'child';
export const card = (kid: boolean) => (kid ? 'kid-card' : 'card');

/** 🎤 dictation: speech → text appended to the field. Nothing is recorded or stored by MANA. */
export function DictateButton({ onText, kid }: { onText: (t: string) => void; kid?: boolean }) {
  const { me } = useAuth(); const toast = useToast(); const [on, setOn] = useState(false); const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);
  const micOff = me!.settings?.mic_allowed === false;
  const go = () => {
    if (on) { stop.current(); return; }
    if (micOff) { toast('مانا هنوز اجازه‌ی میکروفون را نداده.', 'err'); return; }
    if (!sttSupported()) { toast(sttErrorText('unsupported'), 'err'); return; }
    stopSpeaking(); const l = listen(); stop.current = l.stop; setOn(true);
    l.result.then((t) => { setOn(false); onText(t); }).catch((e) => { setOn(false); toast(sttErrorText(e.message), 'err'); });
  };
  return <button type="button" onClick={go} aria-label="گفتن با صدا" className={`btn ${on ? 'btn-danger listening' : 'btn-ghost'} ${kid ? '!text-xl' : ''}`}>{on ? '👂 دارم گوش می‌دم…' : '🎤 با صدا بنویس'}</button>;
}
export const SpeakButton = ({ text }: { text: string }) => <button type="button" className="btn btn-ghost !px-3" aria-label="بخوان" onClick={() => speak(text)}>🔊</button>;

/** Change MY profile photo: upload a new picture (camera/gallery) or pick from my own photos. */
export function AvatarChange({ kid }: { kid?: boolean }) {
  const { me, refresh } = useAuth(); const act = useAction(); const [busy, setBusy] = useState(false); const [pick, setPick] = useState<any[] | null>(null);
  if ((me!.permissions.avatar ?? 0) < 2) return <p className="text-sm text-slate-500">تغییر عکس پروفایل برای این حساب غیرفعال است.</p>;
  const upload = async (f: File) => { setBusy(true); const fd = new FormData(); fd.append('file', f); await act(async () => { await api('/me/avatar', { form: fd }); await refresh(); }, 'عکس پروفایل عوض شد ✨'); setBusy(false); };
  const openGallery = async () => { await act(async () => { setPick(await api<any[]>(`/photos?owner_id=${me!.id}`)); }); };
  return <div className="space-y-3">
    <div className="flex items-center gap-4"><Avatar id={me!.avatar_photo_id} name={me!.display_name} size={kid ? 120 : 88} />
      <div className="space-y-2"><label className={`btn btn-teal cursor-pointer ${kid ? '!text-xl' : ''}`}>{busy ? 'در حال بارگذاری…' : '📷 عکس جدید'}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} /></label>
        <button className="btn btn-ghost block" onClick={openGallery}>🖼 انتخاب از عکس‌های من</button></div></div>
    <p className="text-xs text-slate-500">JPEG، PNG یا WebP تا ۸ مگابایت. همه‌ی اعضای خانواده عکس پروفایل را می‌بینند.</p>
    {pick && <Modal title="انتخاب عکس پروفایل" onClose={() => setPick(null)}>{pick.length === 0 ? <p className="text-slate-500">هنوز عکسی نداری؛ «عکس جدید» را بزن.</p> :
      <div className="grid grid-cols-3 gap-2">{pick.map((p) => <button key={p.id} onClick={async () => { await act(async () => { await api('/me/avatar', { body: { photo_id: p.id } }); await refresh(); }, 'عکس پروفایل عوض شد ✨'); setPick(null); }}><img src={`/api/photos/${p.id}/file`} alt="" className="aspect-square w-full object-cover rounded-xl" /></button>)}</div>}</Modal>}</div>;
}
export { errText };
