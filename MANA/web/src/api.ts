export class ApiError extends Error { constructor(public status: number, public body: any) { super(body?.message ?? body?.error ?? `HTTP ${status}`); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const r = await fetch('/api' + path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), credentials: 'same-origin',
    headers: { 'x-requested-with': 'mana', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data);
  return data as T;
}
export const photoUrl = (id: string) => `/api/photos/${id}/file`;
export const errText = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.status === 0 || e.status >= 500) return 'خطای سرور. دوباره تلاش کنید.';
    if (e.body?.issues) return 'اطلاعات واردشده معتبر نیست: ' + e.body.issues.map((i: any) => i.path).join('، ');
    if (e.body?.message) return e.body.message;
    const m: Record<string, string> = { forbidden: 'دسترسی مجاز نیست.', insufficient_stars: 'ستاره‌ها کافی نیست.', snooze_limit: 'بیشتر از این نمی‌شود عقب انداخت.', not_pending: 'این مورد قبلاً بررسی شده.', invalid_data: 'اطلاعات نامعتبر است.', unsupported_type: 'فقط عکس JPEG، PNG یا WebP.' };
    return m[e.body?.error] ?? 'خطا: ' + (e.body?.error ?? e.status);
  }
  return 'اتصال به سرور برقرار نشد.';
};
