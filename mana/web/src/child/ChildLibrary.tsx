import { api } from '../api';
import { Empty, Loading, useLoad } from '../ui';
import { speak } from '../voice';
import { useReadable } from './ReadAloud';
import { RecipesView } from '../RecipesView';
import { useAuth } from '../auth';

export function LibraryKidPage() {
  const { data, error, loading } = useLoad(() => api<any[]>('/library')); const { me } = useAuth(); const young = me?.age_group === 'young';
  const audio = (data ?? []).filter((x) => x.kind === 'audio'); const pdf = (data ?? []).filter((x) => x.kind === 'pdf');
  useReadable(['کتابخانه.', ...audio.map((a) => `قصه‌ی صوتی: ${a.title}`), ...pdf.map((a) => `کتاب: ${a.title}`)]);
  return <><h1 className="text-3xl font-extrabold">کتابخانه 📚</h1><Loading error={error} loading={loading} />{data?.length === 0 && <Empty>هنوز کتاب یا قصه‌ای نیست. مامان می‌تواند اضافه کند.</Empty>}
    {audio.length > 0 && <><h2 className="text-xl font-bold">🎧 قصه‌های صوتی{young ? ' (فقط گوش کن!)' : ''}</h2>{audio.map((a) => <div key={a.id} className="kid-card"><button className="flex items-center gap-3 w-full text-start" onClick={() => speak(a.title)}><span className="text-4xl">🎧</span><b className="text-xl flex-1">{a.title}</b></button>
      <audio className="w-full mt-2" controls preload="none" src={`/api/library/${a.id}/file`} /></div>)}</>}
    {pdf.length > 0 && <><h2 className="text-xl font-bold mt-2">📖 کتاب‌ها</h2>{pdf.map((a) => <a key={a.id} className="kid-card flex items-center gap-3" href={`/api/library/${a.id}/file`} target="_blank" rel="noreferrer"><span className="text-4xl">📖</span><b className="text-xl flex-1">{a.title}</b><span className="btn btn-ghost">باز کن</span></a>)}</>}</>;
}
export const RecipesKidPage = () => <RecipesView kid />;
