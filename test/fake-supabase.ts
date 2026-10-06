// A tiny in-memory stand-in for @supabase/supabase-js, enough for the jarvis function's queries.
// Every client shares one database (globalThis.__DB), like the real project does.
export const DB: Record<string, any[]> = (globalThis as any).__DB = (globalThis as any).__DB || {};
export const UID = '5ab604e4-1ddb-499f-a675-e15de3093b66';
let tick = 0;
const uuid = () => crypto.randomUUID();
const KEYS: Record<string, string[]> = {
  day_settings: ['user_id'], day_plans: ['user_id', 'date'], jarvis_sent: ['user_id', 'key'], jarvis_push_subs: ['endpoint']
};

function builder(table: string) {
  const filters: ((r: any) => boolean)[] = [];
  let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select', payload: any = null, opts: any = {};
  let returning = false, order: [string, boolean] | null = null, lim: number | null = null, single: 'one' | 'maybe' | null = null;
  const t = () => (DB[table] = DB[table] || []);
  const run = async () => {
    if (mode === 'insert' || mode === 'upsert') {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((r: any) => ({ ...r }));
      const out: any[] = [];
      for (const r of rows) {
        if (table === 'jarvis_memory') Object.assign(r, { active: r.active ?? true, overrides: r.overrides ?? {}, created_at: r.created_at ?? new Date(Date.now() + tick++).toISOString() });
        if (table === 'jarvis_messages') r.created_at = r.created_at ?? new Date(Date.now() + tick++).toISOString();
        if (!r.id && ['jarvis_memory', 'jarvis_messages', 'jarvis_reports', 'jarvis_reviews'].includes(table)) r.id = uuid();
        if (['jarvis_reviews', 'jarvis_reports'].includes(table)) r.created_at = r.created_at ?? new Date(Date.now() + tick++).toISOString();
        const keys = KEYS[table];
        const hit = mode === 'upsert' && keys ? t().find(x => keys.every(k => x[k] === r[k])) : null;
        if (hit) { if (opts.ignoreDuplicates) continue; Object.assign(hit, r); out.push(hit); }
        else { t().push(r); out.push(r); }
      }
      return { data: returning ? (single ? out[0] || null : out) : null, error: null };
    }
    let rows = t().filter(r => filters.every(f => f(r)));
    if (mode === 'update') { rows.forEach(r => Object.assign(r, payload)); return { data: returning ? rows : null, error: null }; }
    if (mode === 'delete') { DB[table] = t().filter(r => !rows.includes(r)); return { data: returning ? rows : null, error: null }; }
    if (order) { const [k, asc] = order; rows = rows.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)); }
    if (lim != null) rows = rows.slice(0, lim);
    rows = rows.map(r => JSON.parse(JSON.stringify(r)));
    if (single) return { data: rows[0] || null, error: single === 'one' && !rows.length ? { message: 'no rows' } : null };
    return { data: rows, error: null };
  };
  const b: any = {
    select() { if (mode !== 'select') returning = true; return b; },
    insert(p: any) { mode = 'insert'; payload = p; return b; },
    upsert(p: any, o: any = {}) { mode = 'upsert'; payload = p; opts = o; return b; },
    update(p: any) { mode = 'update'; payload = p; return b; },
    delete() { mode = 'delete'; return b; },
    eq(k: string, v: any) { filters.push(r => r[k] === v); return b; },
    neq(k: string, v: any) { filters.push(r => r[k] !== v); return b; },
    gt(k: string, v: any) { filters.push(r => r[k] > v); return b; },
    gte(k: string, v: any) { filters.push(r => r[k] >= v); return b; },
    lt(k: string, v: any) { filters.push(r => r[k] < v); return b; },
    lte(k: string, v: any) { filters.push(r => r[k] <= v); return b; },
    in(k: string, vs: any[]) { filters.push(r => vs.includes(r[k])); return b; },
    order(k: string, o: any = {}) { order = [k, o.ascending !== false]; return b; },
    limit(n: number) { lim = n; return b; },
    maybeSingle() { single = 'maybe'; return run(); },
    single() { single = 'one'; return run(); },
    then(res: any, rej: any) { return run().then(res, rej); }
  };
  return b;
}

export function createClient(_url: string, _key: string, _opts: any = {}) {
  return {
    from: builder,
    auth: { getUser: async (tok: string) => ({ data: { user: tok === 'good-token' ? { id: UID, email: 'salah@test' } : null } }) }
  };
}
