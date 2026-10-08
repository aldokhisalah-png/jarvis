// End-to-end test of the backend's planning path on a saved copy of real data, with an in-memory stand-in for Supabase.
//   JARVIS_TEST=1 deno run -A test/backend.test.ts <real.json>
// real.json: { classes, events, ppl, nut, travel } (what the app reads from Uni Planner, PPL Coach, Nutrition Coach, day_settings)
const J = JSON.parse(await Deno.readTextFile(Deno.args[0]));
const { replan, notifyUser } = await import('../supabase/functions/jarvis/index.ts');
const S: any = await import('../src/scheduler.js');

const tables: Record<string, any[]> = {
  planner_classes: J.classes, planner_events: J.events, ppl_records: J.ppl, nutrition_records: J.nut.map((r: any) => ({ ...r, deleted: false })),
  day_settings: [{ user_id: 'u', places: { home: { lat: 29.342096, lng: 47.979439 }, uni: { lat: 29.166897, lng: 48.100519 }, gym_rigae: { lat: 29.309464, lng: 47.919083 }, gym_sabah: { lat: 29.265434, lng: 48.082625 }, gym_mahboula: { lat: 29.146111, lng: 48.123934 } }, prefs: {}, travel: J.travel }],
  jarvis_memory: [{ id: 'm1', user_id: 'u', kind: 'day', date: S.localOf(new Date().toISOString()).date, text: 'No gym today', overrides: { noGym: true }, active: true, created_at: '2026-01-01' }],
  day_plans: [], jarvis_sent: [], jarvis_messages: []
};
function q(table: string) {
  const f: ((r: any) => boolean)[] = []; let single = false, op = 'select', payload: any = null;
  const api: any = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(k: string, v: any) { f.push(r => k === 'user_id' || r[k] === v); return api; }, in(k: string, v: any[]) { f.push(r => v.includes(r[k])); return api; },
    gte(k: string, v: any) { f.push(r => r[k] >= v); return api; }, lte(k: string, v: any) { f.push(r => r[k] <= v); return api; }, lt(k: string, v: any) { f.push(r => r[k] < v); return api; },
    maybeSingle() { single = true; return api; }, single() { single = true; return api; },
    upsert(p: any, o: any) { op = 'upsert'; payload = p; api.onConflict = o?.onConflict; return api; }, insert(p: any) { op = 'insert'; payload = p; return api; }, update(p: any) { op = 'update'; payload = p; return api; }, delete() { op = 'delete'; return api; },
    then(res: any) {
      const T = tables[table] = tables[table] || [];
      if (op === 'upsert') {
        const keys = String(api.onConflict || 'id').split(',');
        const i = T.findIndex(r => keys.every(k => k === 'user_id' || r[k] === payload[k]));
        if (i >= 0) T[i] = { ...T[i], ...payload }; else T.push({ ...payload });
        return res({ data: [payload], error: null });
      }
      if (op === 'insert') { for (const p of [].concat(payload)) T.push({ id: crypto.randomUUID(), active: true, ...p }); return res({ data: payload, error: null }); }
      if (op === 'delete') { tables[table] = T.filter(r => !f.every(fn => fn(r))); return res({ data: [], error: null }); }
      const rows = T.filter(r => f.every(fn => fn(r)));
      return res({ data: single ? rows[0] ?? null : rows, error: null });
    }
  };
  return api;
}
const sb = { from: q };

// 1. a fresh plan for the week
const r = await replan(sb, 'u', { fresh: true });
const t = r.days[0];
console.log(`saved ${tables.day_plans.length} days; today ${t.date}: ${t.blocks.length} blocks, gym=${JSON.stringify(t.gym)} (expected none: "No gym today"), notes=${t.notes}`);
if (t.gym) throw new Error('day change ignored');
// 2. mid-day re-plan from a GPS fix at uni
const r2 = await replan(sb, 'u', { coords: { lat: 29.1669, lng: 48.1005 } });
console.log(`re-plan: where=${JSON.stringify({ loc: r2.loc, how: r2.how })}, blocks=${r2.days[0].blocks.length}`);
// 3. the week ahead is sane: every day has a sleep block and no overlapping drives
for (const d of r2.days) {
  const drives = d.blocks.filter((b: any) => b.type === 'drive').sort((a: any, b: any) => a.start - b.start);
  for (let i = 1; i < drives.length; i++) if (drives[i].start < drives[i - 1].end) throw new Error(`overlapping drives on ${d.date}`);
  if (!d.blocks.some((b: any) => b.type === 'sleep')) throw new Error(`no sleep on ${d.date}`);
  console.log(`${d.date}: ${d.blocks.length} blocks, gym ${d.gym ? S.PLACE_NAME[d.gym.at] + ' ' + S.t12(d.gym.start) : '—'}, bed ${S.t12(d.bed)}, warnings ${d.warnings.length}`);
}
console.log('backend planning path OK');
if (Deno.env.get('SHOW')) for (const b of r2.days[0].blocks) console.log(S.t12(b.start).padStart(7), b.type, b.title, '|', String(b.detail || '').slice(0, 80)), console.log(r2.days[0].warnings);
