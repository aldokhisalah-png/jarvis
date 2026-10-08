// jarvis — server side. Builds Salah's days from his rules (scheduler.js, no AI), and uses Claude only to:
//   1. turn what he tells Jarvis into schedule changes ("no gym today", "I'm at my grandmother's 4–7"),
//   2. double-check that each day is actually doable,
//   3. decide what to do when live traffic breaks the plan.
// Reads Uni Planner, PPL Coach and Nutrition Coach — never writes to them.
//
// In:
//   • The app, with his login token (row-level security limits everything to his rows).
//   • pg_cron every minute with x-cron-secret: notifications, live traffic, the nightly re-plan.
//
// POST { action: 'plan', coords? }              → re-plan from now (where he is: live location, else his last check)
// POST { action: 'tick', date, ref, done }      → check / uncheck a block, then re-plan the rest of today
// POST { action: 'tell', message, coords? }     → Claude turns it into changes; re-plan; reply
// POST { action: 'forget', id }                 → drop a change or note he told Jarvis
// POST { action: 'place', key, url? , coords? } → set one of his places (Google Maps link or "I'm here")
// POST { action: 'test-push' }
//
// Secrets: ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, AI_MODEL (optional). Push keys + cron secret: table planner_private.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sched from './scheduler.js';
const S: any = Sched;                                   // plain JS module
import { sendPush } from './push.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const MODEL = env('AI_MODEL') || 'claude-sonnet-5-5';
const TZ = 180;
const MONTHLY_CAP = 4500;                               // Google Routes: free up to 5,000 a month per endpoint
const DAYS_AHEAD = 7;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** His day, not the calendar's: until 03:00 it's still last night (yesterday's date, minutes past 1440). */
function localNow() { const l = S.localOf(new Date().toISOString(), TZ); return l.min < 180 ? { date: S.addDays(l.date, -1), min: l.min + 1440 } : l; }

function serverKey() {
  if (env('SUPABASE_SERVICE_ROLE_KEY')) return env('SUPABASE_SERVICE_ROLE_KEY');
  try { const k = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); return k.default || Object.values(k)[0] || ''; } catch { return ''; }
}
let _svc: any = null;
const svc = () => _svc || (_svc = createClient(env('SUPABASE_URL'), serverKey(), { auth: { persistSession: false } }));
const cfg = { loaded: false, cronSecret: '', vapid: { publicKey: '', privateKey: '', subject: '' } };
async function loadConfig() {
  if (cfg.loaded) return;
  const { data } = await svc().from('planner_private').select('key,value');
  const t = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
  const get = (k: string) => env(k) || t[k] || '';
  cfg.cronSecret = get('CRON_SECRET');
  cfg.vapid = { publicKey: get('VAPID_PUBLIC_KEY'), privateKey: get('VAPID_PRIVATE_KEY'), subject: get('VAPID_SUBJECT') || 'mailto:jarvis@example.com' };
  cfg.loaded = true;
}

// ---------------------------------------------------------------- Claude
async function aiJson({ system, user, schema, maxTokens = 3000 }: any, attempt = 1): Promise<any> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Jarvis needs ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens,
      system: `${system}\n\nAnswer by calling the "answer" tool exactly once, with every required field. Do not reply in plain text.`,
      messages: [{ role: 'user', content: user }], tools: [{ name: 'answer', description: 'Your answer.', input_schema: schema }], tool_choice: { type: 'any' } })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude request failed (${r.status}): ${j?.error?.message || 'unknown error'}`);
  const call = (j.content || []).find((c: any) => c.type === 'tool_use' && c.name === 'answer');
  if (call) return call.input;
  const text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'), a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through */ } }
  console.error('claude no answer', j.stop_reason, (j.content || []).map((c: any) => c.type).join(','), text.slice(0, 300));
  if (attempt < 2) return aiJson({ system, user, schema, maxTokens: maxTokens * 2 }, attempt + 1);
  throw new Error(`Claude gave no answer (${j.stop_reason}).`);
}

// ---------------------------------------------------------------- data
const one = async (q: any) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
async function loadAll(sb: any, uid: string, today: string) {
  const [classes, events, ppl, nut, settings, memory, plans] = await Promise.all([
    one(sb.from('planner_classes').select('course,kind,weekday,start_time,end_time,room').eq('user_id', uid)),
    one(sb.from('planner_events').select('id,course,title,kind,due_at,all_day,weight,note,done').eq('user_id', uid)
      .gte('due_at', new Date(Date.now() - 5 * 864e5).toISOString()).lte('due_at', new Date(Date.now() + 90 * 864e5).toISOString())),
    one(sb.from('ppl_records').select('kind,key,body').eq('user_id', uid)),
    one(sb.from('nutrition_records').select('kind,id,body').eq('user_id', uid).eq('deleted', false).eq('kind', 'plan_version')),
    one(sb.from('day_settings').select('places,prefs,travel').eq('user_id', uid).maybeSingle()),
    one(sb.from('jarvis_memory').select('id,kind,text,date,overrides,category,created_at').eq('user_id', uid).eq('active', true).order('created_at')),
    one(sb.from('day_plans').select('date,plan').eq('user_id', uid).gte('date', S.addDays(today, -14)).lte('date', S.addDays(today, DAYS_AHEAD + 1)).order('date'))
  ]);
  const st = settings || { places: {}, prefs: {}, travel: {} };
  st.places = st.places || {}; st.prefs = st.prefs || {}; st.travel = st.travel || {};
  return { classes: classes || [], events: events || [], ppl: S.pplFromRows(ppl || []), nutrition: S.nutritionFromRows(nut || []), settings: st,
    dayChanges: (memory || []).filter((m: any) => m.kind === 'day' && m.date >= S.addDays(today, -1)),
    notes: (memory || []).filter((m: any) => m.kind === 'rule' && m.category === 'standing'),
    plans: (plans || []).filter((p: any) => p.plan && p.plan.version === 2) };
}
async function saveSettings(sb: any, uid: string, patch: any) {
  const cur = await one(sb.from('day_settings').select('places,prefs,travel').eq('user_id', uid).maybeSingle()) || {};
  await one(sb.from('day_settings').upsert({ user_id: uid, ...cur, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
}
const savePlan = (sb: any, uid: string, date: string, plan: any) => one(sb.from('day_plans').upsert({ user_id: uid, date, plan, source: 'rules', updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' }));

/** Every change he told Jarvis for a date, merged in the order he said them. */
function mergeChanges(rows: any[]) {
  const out: Record<string, any> = {};
  for (const r of rows) {
    const c = r.overrides || {}, cur = out[r.date] = out[r.date] || {};
    for (const [k, v] of Object.entries(c)) {
      if (Array.isArray(v) && Array.isArray(cur[k])) cur[k] = [...cur[k], ...v];
      else cur[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- drive times (Google, cached)
const KEY_PLACES = ['home', 'grandma', 'uni', 'gym', 'gym_rigae', 'gym_mahboula', 'gym_sabah'];   // same key as before, so cached traffic stays valid
const month = () => localNow().date.slice(0, 7);
function usage(settings: any) { const t = settings.travel = settings.travel || {}; if (!t.usage || t.usage.month !== month()) t.usage = { month: month(), matrix: 0, routes: 0 }; return t.usage; }
const googleOn = () => !!env('GOOGLE_MAPS_API_KEY');
const canSpend = (settings: any, kind: 'matrix' | 'routes', n: number) => googleOn() && usage(settings)[kind] + n <= MONTHLY_CAP;
const placesKey = (places: any) => KEY_PLACES.map(k => places[k] ? `${k}:${(+places[k].lat).toFixed(5)},${(+places[k].lng).toFixed(5)}` : `${k}:-`).join('|');
const wp = (p: any) => ({ waypoint: { location: { latLng: { latitude: +p.lat, longitude: +p.lng } } } });
const secs = (d: string | undefined) => d ? parseInt(String(d).replace('s', ''), 10) : NaN;
async function gMatrix(origins: any[], dests: any[], departure?: Date) {
  const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env('GOOGLE_MAPS_API_KEY'), 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition,status' },
    body: JSON.stringify({ origins: origins.map(wp), destinations: dests.map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', ...(departure ? { departureTime: departure.toISOString() } : {}) })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google traffic: ${j?.error?.message || r.status}`);
  const out = origins.map(() => dests.map(() => null as number | null));
  for (const el of (Array.isArray(j) ? j : [])) if (el.condition === 'ROUTE_EXISTS' && isFinite(secs(el.duration))) out[el.originIndex][el.destinationIndex] = secs(el.duration) / 60;
  return out;
}
async function gRoute(a: any, b: any) {
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env('GOOGLE_MAPS_API_KEY'), 'X-Goog-FieldMask': 'routes.duration' },
    body: JSON.stringify({ origin: wp(a), destination: wp(b), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google traffic: ${j?.error?.message || r.status}`);
  const s = secs(j.routes?.[0]?.duration);
  return isFinite(s) ? s / 60 : null;
}
async function osrmTable(pts: { lat: number, lng: number }[]) {
  const coords = pts.map(p => `${(+p.lng).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';');
  const r = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`, { headers: { 'User-Agent': 'jarvis (personal app)' } });
  if (!r.ok) throw new Error(`Couldn't get drive times (map service ${r.status}).`);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error(`Couldn't get drive times (${j.code}).`);
  return j.durations as (number | null)[][];
}
const dist = (a: any, b: any) => { const R = 6371e3, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const localToDate = (date: string, min: number) => new Date(Date.parse(date + 'T00:00:00Z') + (min - TZ) * 60000);
const knownPlaces = (places: any) => S.PLACES.filter((k: string) => places[k] && isFinite(+places[k].lat));

/** Empty-road minutes between his places (the fallback). Cached until a place moves. */
async function freeFlow(sb: any, uid: string, settings: any, force = false) {
  const places = settings.places, t = settings.travel, key = placesKey(places);
  if (!force && t.computed_for === key) return t;
  const have = knownPlaces(places);
  for (const k of Object.keys(t)) if (/^[a-z_]+-[a-z_]+$/.test(k)) delete t[k];
  t.computed_for = key; t.computed_at = new Date().toISOString(); t.profiles = {};
  if (have.length >= 2) {
    const m = await osrmTable(have.map((k: string) => places[k]));
    for (let i = 0; i < have.length; i++) for (let j = i + 1; j < have.length; j++) { const a = m[i][j], b = m[j][i]; if (a != null && b != null) t[[have[i], have[j]].sort().join('-')] = Math.round(Math.max(a, b) / 60); }
  }
  await saveSettings(sb, uid, { travel: t });
  return t;
}
/** Google's predicted drive time by hour for the weekday of `date`. Cached 14 days per weekday. */
async function trafficProfile(sb: any, uid: string, settings: any, date: string) {
  const places = settings.places, have = knownPlaces(places);
  if (have.length < 2 || !googleOn()) return null;
  const t = settings.travel, dow = S.dowOf(date), key = placesKey(places);
  const cached = t.profiles && t.profiles[dow];
  if (cached && cached.key === key && Date.now() - Date.parse(cached.at) < 14 * 864e5) return cached.data;
  const HOURS = [6, 8, 10, 12, 14, 16, 18, 20, 22];
  const pairs = have.flatMap((a: string) => have.filter((b: string) => b !== a && !(S.isGym(a) && S.isGym(b))).map((b: string) => [a, b]));
  const cost = HOURS.length * pairs.length;
  if (!canSpend(settings, 'matrix', cost)) return cached ? cached.data : null;
  const data: Record<string, [number, number][]> = {}, jobs: (() => Promise<void>)[] = [];
  for (const h of HOURS) {
    let when = localToDate(date, h * 60);
    while (when.getTime() < Date.now() + 5 * 60000) when = new Date(when.getTime() + 7 * 864e5);
    for (const a of have) { const others = pairs.filter((p: string[]) => p[0] === a).map((p: string[]) => p[1]); if (!others.length) continue; jobs.push(async () => {
      const m = await gMatrix([places[a]], others.map((b: string) => places[b]), when);
      others.forEach((b: string, i: number) => { const v = m[0][i]; if (v != null) (data[`${a}>${b}`] = data[`${a}>${b}`] || []).push([h * 60, Math.round(v * 10) / 10]); });
    }); }
  }
  for (let i = 0; i < jobs.length; i += 9) await Promise.all(jobs.slice(i, i + 9).map(f => f()));
  for (const k of Object.keys(data)) data[k].sort((x, y) => x[0] - y[0]);
  usage(settings).matrix += cost;
  t.profiles = { ...(t.profiles || {}), [dow]: { key, at: new Date().toISOString(), data } };
  await saveSettings(sb, uid, { travel: t });
  return data;
}
/** Where he is from a GPS fix: one of his places (within 400 m), or 'here' with drive times from there. */
async function whereAmI(sb: any, uid: string, settings: any, coords: any) {
  const places = settings.places, known = knownPlaces(places);
  if (!coords || !isFinite(+coords.lat) || !known.length) return null;
  let best: string | null = null, bd = Infinity;
  for (const k of known) { const d = dist(coords, places[k]); if (d < bd) { bd = d; best = k; } }
  if (best && bd <= 400) return { loc: best, profile: {} };
  const profile: any = {};
  try {
    if (canSpend(settings, 'matrix', known.length)) {
      const m = await gMatrix([coords], known.map((k: string) => places[k]));
      usage(settings).matrix += known.length; await saveSettings(sb, uid, { travel: settings.travel });
      known.forEach((k: string, i: number) => { const v = m[0][i]; if (v != null) profile[`here>${k}`] = [[0, v], [1439, v]]; });
    } else {
      const m = await osrmTable([coords, ...known.map((k: string) => places[k])]);
      known.forEach((k: string, i: number) => { const v = m[0][i + 1]; if (v != null) profile[`here>${k}`] = [[0, v / 60], [1439, v / 60]]; });
    }
  } catch { return null; }
  return { loc: 'here', profile };
}

// ---------------------------------------------------------------- planning
const refsDone = (plans: any[]) => { const s = new Set<string>(); for (const p of plans) for (const b of (p.plan?.blocks || [])) if (b.done && b.ref) s.add(b.ref); return s; };
const locAfter = (b: any) => b.type === 'drive' ? b.to : b.type === 'errand' ? 'home' : b.loc;

/** Where he is now: a fresh GPS fix, else the last thing he checked off today, else where today's plan has him. */
function placeNow(todayPlan: any, now: { min: number }, classes: any[], date: string) {
  const bl = (todayPlan?.blocks || []) as any[];
  const doneLast = bl.filter(b => b.done && b.loc !== 'car').sort((a, b) => (a.doneAtMin ?? a.end) - (b.doneAtMin ?? b.end)).pop();
  const inClass = classes.some(c => +c.weekday === S.dowOf(date) && S.toMin(c.start_time)! <= now.min && S.toMin(c.end_time)! > now.min);
  if (inClass) return { loc: 'uni', how: 'in class' };
  if (doneLast) return { loc: locAfter(doneLast), how: `you checked “${doneLast.title}”` };
  const cur = bl.filter(b => b.type !== 'wake' && b.type !== 'sleep' && b.start <= now.min && !b.instant).pop();
  return { loc: cur ? (cur.type === 'drive' && cur.end > now.min ? cur.to : locAfter(cur)) || 'home' : 'home', how: 'from the plan' };
}

async function replan(sb: any, uid: string, opts: { coords?: any, reason?: string | null, fresh?: boolean } = {}) {
  const now = localNow(), today = now.date;
  const D = await loadAll(sb, uid, today);
  const st = D.settings;
  if (opts.coords && isFinite(+opts.coords.lat)) { st.prefs.lastFix = { lat: +(+opts.coords.lat).toFixed(5), lng: +(+opts.coords.lng).toFixed(5), at: new Date().toISOString() }; await saveSettings(sb, uid, { prefs: st.prefs }); }
  const ff = await freeFlow(sb, uid, st).catch(() => st.travel);
  const profiles: Record<string, any> = {};
  for (let i = 0; i <= DAYS_AHEAD; i++) { const d = S.addDays(today, i); const dw = S.dowOf(d); if (!(dw in profiles)) profiles[dw] = await trafficProfile(sb, uid, st, d).catch(e => { console.error('traffic', e); return null; }); }
  const byDate: Record<string, any> = Object.fromEntries(D.plans.map((p: any) => [p.date, p.plan]));
  const todayPlan = byDate[today];
  const yesterday = byDate[S.addDays(today, -1)];

  // where he is
  let here: any = null, loc = 'home', how = '';
  const fix = st.prefs.lastFix, fresh = fix && Date.now() - Date.parse(fix.at) < 15 * 60000 ? fix : null;
  if (fresh) { here = await whereAmI(sb, uid, st, fresh); if (here) { loc = here.loc; how = loc === 'here' ? 'your live location' : `you’re at ${S.PLACE_NAME[loc]}`; } }
  if (!here) { const p = placeNow(todayPlan, now, D.classes, today); loc = p.loc; how = p.how; }

  const started = todayPlan && !opts.fresh && todayPlan.wake != null && now.min >= todayPlan.wake;
  const rules = { ...(st.prefs.rules || {}) };
  const driveFor = (date: string) => S.makeDrive({ profile: { ...(profiles[S.dowOf(date)] || {}), ...(date === today && here ? here.profile : {}) }, freeFlow: ff });
  const done = refsDone(D.plans);
  // what was planned earlier today counts as happened (meals, drives, errands, walking) — only uni work he didn't check moves forward,
  // and the gym follows PPL Coach (a logged session is a done gym)
  let walkedSoFar = 0;
  if (started) for (const b of todayPlan.blocks || []) if (b.end <= now.min) {
    if (b.ref && !['study', 'gym'].includes(b.type)) done.add(b.ref);
    if (b.walk && (b.done || b.type !== 'walk')) walkedSoFar += b.walk; else if (b.type === 'walk') walkedSoFar += b.walk || 0;
  }
  const out = S.planDays({ from: today, n: DAYS_AHEAD, today, classes: D.classes, events: D.events, ppl: D.ppl, nutrition: D.nutrition, rules,
    known: [...knownPlaces(st.places), ...(here && here.loc === 'here' ? ['here'] : [])], driveFor, changes: mergeChanges(D.dayChanges), doneRefs: [...done],
    firstStart: started ? { min: now.min, loc } : null, firstWalkDone: walkedSoFar,
    prevBedAbs: yesterday && yesterday.bed != null ? yesterday.bed - 1440 : null });

  // today: keep what already happened or was checked, add the new rest of the day
  const days = out.days;
  if (started) {
    const kept = (todayPlan.blocks || []).filter((b: any) => b.done || b.end <= now.min || b.type === 'wake' || (b.type === 'maid' && b.start <= now.min));
    const keptRefs = new Set(kept.map((b: any) => b.ref).filter(Boolean));
    days[0].blocks = [...kept, ...days[0].blocks.filter((b: any) => !b.ref || !keptRefs.has(b.ref))].sort((a: any, b: any) => a.start - b.start);
    days[0].wake = todayPlan.wake;
  }
  for (const d of days) {
    const old = byDate[d.date];
    // checks on future days survive a re-plan
    const oldDone = new Map(((old && old.blocks) || []).filter((b: any) => b.done && b.ref).map((b: any) => [b.ref, b]));
    for (const b of d.blocks) if (b.ref && oldDone.has(b.ref)) { b.done = true; b.doneAt = (oldDone.get(b.ref) as any).doneAt; }
    d.where = d.date === today ? { loc, how } : null;
    d.sig = signature(d);
    d.check = old && old.sig === d.sig ? old.check || null : null;     // keep the AI check while the day is unchanged
    d.planned_at = new Date().toISOString();
    d.reason = d.date === today ? opts.reason || null : null;
    await savePlan(sb, uid, d.date, d);
  }
  return { days, loc, how, settings: st, D };
}
const signature = (d: any) => d.blocks.filter((b: any) => !b.done).map((b: any) => `${b.type}${b.startT}${b.title}`).join('|');

// ---------------------------------------------------------------- the AI parts
const CHANGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    noGym: { type: 'boolean', description: 'No gym that day.' },
    gymAt: { type: 'string', description: 'HH:MM — he wants to train at this time.' },
    gymPlace: { type: 'string', enum: S.GYMS, description: 'He wants this branch.' },
    cancelClasses: { description: 'true = no classes that day, or a list of course codes that are off.', anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }] },
    busy: { type: 'array', description: 'Times he is busy somewhere.', items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'title', 'place'], properties: {
      from: { type: 'string', description: 'HH:MM' }, to: { type: 'string', description: 'HH:MM' }, title: { type: 'string' },
      place: { type: 'string', enum: ['home', 'grandma', 'uni', 'gym_rigae', 'gym_mahboula', 'gym_sabah', 'other'] } } } },
    skipMeals: { type: 'array', items: { type: 'string', enum: ['breakfast', 'lunch', 'preworkout', 'dinner', 'evening'] }, description: 'Meals he won’t eat from the plan that day (e.g. eating out covers dinner).' },
    tasks: { type: 'array', description: 'Extra things to fit in.', items: { type: 'object', additionalProperties: false, required: ['title', 'minutes'], properties: { title: { type: 'string' }, minutes: { type: 'number' }, at: { type: 'string', description: 'HH:MM if he gave a time' } } } },
    wakeAt: { type: 'string', description: 'HH:MM' }, bedBy: { type: 'string', description: 'HH:MM' },
    noGroceries: { type: 'boolean' }
  }
};
const RULE_KEYS = Object.keys(S.RULES);
const TELL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'dayChanges', 'ruleChanges', 'notes', 'forget'],
  properties: {
    reply: { type: 'string', description: 'One or two short sentences to Salah: what you changed. Plain words, no jargon.' },
    dayChanges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['date', 'summary', 'change'], properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' }, summary: { type: 'string', description: 'What he said, short, e.g. "No gym today"' }, change: CHANGE_SCHEMA } } },
    ruleChanges: { type: 'array', description: 'A standing change to one of his rules (from now on).', items: { type: 'object', additionalProperties: false, required: ['key', 'value', 'summary'], properties: {
      key: { type: 'string', enum: RULE_KEYS }, value: { type: 'number' }, summary: { type: 'string' } } } },
    notes: { type: 'array', items: { type: 'string' }, description: 'Standing things to remember that none of the fields above can express. Say in the reply that these are noted but not automatic.' },
    forget: { type: 'array', items: { type: 'string' }, description: 'ids of earlier changes/notes he wants dropped' }
  }
};
const RULE_TEXT = `His rules (already built in — don't re-add them):
- Classes are fixed; leave to be at uni ${S.RULES.classEarly} min before class (covers parking).
- Quiz/assignment/pre-lab/homework: 30 min on the day it opens (no open date → 48 h before the deadline). Graded lab: 30 min revision the day before. GCA: 2 h study 2 days before. Exams: 3 h a day from 14 days before exam week, 4 h a day from 7 days before.
- Gym every day unless he says no. Branch closest to where he is / goes next (Rigae on ties). Never Sabah Al-Salem 5–9am or 11am–3pm. 10pm–4am quiet, 4pm–9pm packed.
- Groceries every Saturday. Meals from Nutrition Coach; the maid cooks 7am–9pm; he cooks outside that. Cooler in the car; microwaves at the gyms and the gas station near uni.
- 1.5 h on the walking pad at home a day. Sleep: 8 h preferred, never under 6 h. Priority when short on time: uni → gym → food → sleep.
Rule numbers you can change (minutes unless noted): ${RULE_KEYS.map(k => `${k}=${(S.RULES as any)[k]}`).join(', ')}.`;

async function tell(sb: any, uid: string, message: string, coords: any) {
  const now = localNow(), today = now.date;
  const D = await loadAll(sb, uid, today);
  const week = D.plans.filter((p: any) => p.date >= today).slice(0, 3).map((p: any) => `${S.dlong(p.date)} (${p.date}): ${(p.plan.blocks || []).filter((b: any) => !['wake', 'maid'].includes(b.type)).map((b: any) => `${S.t12(b.start)} ${b.title}`).join(' · ')}`).join('\n');
  const changes = D.dayChanges.map((m: any) => `[${m.id}] ${m.date}: ${m.text}`).join('\n') || 'none';
  const notes = D.notes.map((m: any) => `[${m.id}] ${m.text}`).join('\n') || 'none';
  const ruleNow = JSON.stringify(D.settings.prefs.rules || {});
  const a = await aiJson({
    system: `You are Jarvis, Salah's scheduling assistant in Kuwait. A rule-based planner builds his day; your only job here is to turn what he just told you into structured changes for it. Today is ${S.DAYS[S.dowOf(today)]} ${today}, it's ${S.t12(now.min)}. "Today/tonight/tomorrow" are relative to that.\n\n${RULE_TEXT}\n\nOnly record what he actually said. A one-day thing goes in dayChanges (one entry per date). "From now on / always / every …" goes in ruleChanges if it maps to a rule number, otherwise notes. If he asks a question, answer it in reply and change nothing. Never invent times he didn't give.`,
    user: `What he said: """${message.slice(0, 1500)}"""\n\nThe next days as planned now:\n${week || '(no plan yet)'}\n\nChanges he already told you (id, date, text):\n${changes}\n\nStanding notes (id, text):\n${notes}\n\nRule numbers he already changed: ${ruleNow}`,
    schema: TELL_SCHEMA, maxTokens: 2500
  });
  for (const id of a.forget || []) await one(sb.from('jarvis_memory').delete().eq('user_id', uid).eq('id', id)).catch(() => {});
  for (const c of a.dayChanges || []) if (/^\d{4}-\d{2}-\d{2}$/.test(c.date)) await one(sb.from('jarvis_memory').insert({ user_id: uid, kind: 'day', date: c.date, text: String(c.summary).slice(0, 480) || 'Change', overrides: c.change || {}, source: 'chat' }));
  for (const n of a.notes || []) await one(sb.from('jarvis_memory').insert({ user_id: uid, kind: 'rule', strength: 'must', category: 'standing', text: String(n).slice(0, 480), source: 'chat' }));
  if ((a.ruleChanges || []).length) {
    const rules = { ...(D.settings.prefs.rules || {}) };
    for (const r of a.ruleChanges) if (RULE_KEYS.includes(r.key) && isFinite(+r.value)) rules[r.key] = +r.value;
    await saveSettings(sb, uid, { prefs: { ...D.settings.prefs, rules } });
  }
  await one(sb.from('jarvis_messages').insert([{ user_id: uid, role: 'user', body: message.slice(0, 2000) }, { user_id: uid, role: 'jarvis', body: a.reply, data: { dayChanges: a.dayChanges, ruleChanges: a.ruleChanges, notes: a.notes } }]));
  const changed = (a.dayChanges || []).length || (a.ruleChanges || []).length || (a.forget || []).length;
  let plan = null;
  if (changed) { const r = await replan(sb, uid, { coords, reason: a.reply }); plan = r.days[0]; await checkDay(sb, uid, r.days[0]).catch(e => console.error('check', e)); }
  return { reply: a.reply, changed: !!changed, plan };
}

const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'issues'],
  properties: { ok: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['at', 'problem', 'fix'], properties: {
    at: { type: 'string', description: 'time, e.g. 2:15pm' }, problem: { type: 'string' }, fix: { type: 'string', description: 'something he can tell Jarvis, e.g. "Move the gym to 10pm"' } } } } }
};
/** Claude double-checks a day is doable. Only when the day changed since the last check. */
async function checkDay(sb: any, uid: string, day: any) {
  if (!day || day.check || !env('ANTHROPIC_API_KEY')) return day && day.check;
  const lines = day.blocks.filter((b: any) => b.type !== 'maid').map((b: any) => `${S.t12(b.start)}${b.end !== b.start ? '–' + S.t12(b.end) : ''} ${b.title}${b.loc && b.type !== 'drive' ? ` @${b.loc}` : ''}${b.detail ? ` (${String(b.detail).slice(0, 120)})` : ''}${b.done ? ' [done]' : ''}`).join('\n');
  const a = await aiJson({
    system: `You check Salah's daily plan, built by a rule-based planner, for whether it's actually doable. ${RULE_TEXT}\nLook for real problems only: impossible back-to-back moves, no time to eat or get from the car to class, drives that look too short for Kuwait traffic at that hour, meals at odd times, too little sleep, a deadline at risk, anything clashing with the changes he asked for. If it's fine, ok=true and no issues. At most 4 issues, each one short sentence. Times are local (Kuwait).`,
    user: `${S.DAYS[S.dowOf(day.date)]} ${day.date}${day.where ? `, he is now at ${day.where.loc}` : ''}:\n${lines}\nPlanner warnings: ${(day.warnings || []).join(' / ') || 'none'}`,
    schema: CHECK_SCHEMA, maxTokens: 1200
  });
  day.check = { ok: !!a.ok, issues: (a.issues || []).slice(0, 4), at: new Date().toISOString() };
  await savePlan(sb, uid, day.date, day);
  return day.check;
}

/** Live traffic says a drive takes longer than planned. Rules move the leave time; Claude decides only if that breaks something. */
async function trafficShift(sb: any, uid: string, plan: any, i: number, need: number, nowMin: number) {
  const b = plan.blocks[i], planned = b.end - b.start, extra = Math.ceil(need - planned);
  if (extra < 3) return null;
  const newStart = b.end - Math.ceil(need);
  const prev = plan.blocks.filter((x: any) => x.end > newStart && x.start < b.start && !x.done && !x.instant && x !== b && x.type !== 'wake').pop();
  if (newStart >= nowMin && (!prev || !['class', 'exam', 'gym', 'busy'].includes(prev.type))) {
    b.start = newStart; b.startT = S.hhmm(newStart); b.trafficNote = `Traffic: +${extra} min`; b.detail = `${Math.ceil(need)} min drive now · ${b.detail.replace(/^\d+ min drive · /, '')}`;
    if (prev) { prev.end = Math.max(prev.start, newStart); prev.endT = S.hhmm(prev.end); }
    await savePlan(sb, uid, plan.date, plan);
    return { title: `Leave at ${S.t12(newStart)} — traffic`, body: `${b.title.replace('Leave for', 'To')} takes ${Math.ceil(need)} min right now (${extra} more than planned).${prev ? ` ${prev.title} ends a bit earlier.` : ''}` };
  }
  // can't absorb it: ask Claude what to do, tell him straight
  const late = Math.max(0, nowMin - newStart);
  const a = await aiJson({
    system: `You are Jarvis, Salah's scheduling assistant. Live traffic just made a planned drive longer. Decide the most useful thing to tell him in a phone notification. ${RULE_TEXT}`,
    user: `Now ${S.t12(nowMin)}. Drive: ${b.title} (${b.detail}), planned to leave ${S.t12(b.start)}, takes ${Math.ceil(need)} min now instead of ${planned}. ${late ? `Even leaving now he arrives about ${late} min later than planned.` : `He'd have to leave at ${S.t12(newStart)}, which cuts into: ${prev ? prev.title : 'nothing'}.`}\nRest of today: ${plan.blocks.filter((x: any) => x.start >= b.start).map((x: any) => `${S.t12(x.start)} ${x.title}`).join(' · ')}`,
    schema: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string', description: 'max 50 chars' }, body: { type: 'string', description: 'max 180 chars, what to do now' } } },
    maxTokens: 400
  });
  b.trafficNote = `Traffic: +${extra} min`; await savePlan(sb, uid, plan.date, plan);
  return a;
}

// ---------------------------------------------------------------- requests from the app
async function resolveLink(url: any) {
  let u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('Paste a Google Maps link.');
  const googleHost = (h: string) => /(^|\.)google\.[a-z.]+$/.test(h) || /(^|\.)goo\.gl$/.test(h);
  const parse = (s: string) => {
    let t = s; try { t = decodeURIComponent(s); } catch { /* keep as is */ }
    const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    return m ? { lat: +(+m[1]).toFixed(6), lng: +(+m[2]).toFixed(6) } : null;
  };
  for (let i = 0; i < 5; i++) {
    if (!googleHost(new URL(u).hostname)) throw new Error('That isn’t a Google Maps link.');
    const hit = parse(u); if (hit) return hit;
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (jarvis personal app)' } });
    const loc = r.headers.get('location');
    if (!loc) { const h2 = parse((await r.text()).slice(0, 200000)); if (h2) return h2; break; }
    u = new URL(loc, u).href;
  }
  throw new Error('I couldn’t find a location in that link. Open Jarvis at the place and use “I’m here” instead.');
}

async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    await loadConfig();
    const secret = req.headers.get('x-cron-secret');
    if (secret) {
      if (!cfg.cronSecret || secret !== cfg.cronSecret) return json({ error: 'Bad cron secret.' }, 401);
      return json(await runCron());
    }
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user } } = auth ? await sb.auth.getUser(auth.replace(/^Bearer\s+/i, '')) : { data: { user: null } };
    if (!user) return json({ error: 'Sign in first.' }, 401);
    const uid = user.id;
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'plan';
    const coords = body.coords && isFinite(+body.coords.lat) && isFinite(+body.coords.lng) ? { lat: +body.coords.lat, lng: +body.coords.lng } : null;

    if (action === 'plan') {
      const r = await replan(sb, uid, { coords, reason: body.reason || null });
      background(checkDay(sb, uid, r.days[0]).then(() => checkDay(sb, uid, r.days[1])));
      return json({ today: r.days[0], where: { loc: r.loc, how: r.how } });
    }
    if (action === 'tick') {
      const p = await one(sb.from('day_plans').select('plan').eq('user_id', uid).eq('date', body.date).maybeSingle());
      if (!p) return json({ error: 'No plan for that day.' }, 404);
      const b = (p.plan.blocks || []).find((x: any) => x.ref === body.ref);
      if (!b) return json({ error: 'That item isn’t in the plan any more.' }, 404);
      const now = localNow();
      b.done = !!body.done; b.doneAt = body.done ? new Date().toISOString() : null; b.doneAtMin = body.done ? now.min : null;
      await savePlan(sb, uid, body.date, p.plan);
      if (body.date !== now.date) return json({ ok: true });
      const r = await replan(sb, uid, { coords, reason: null });
      background(checkDay(sb, uid, r.days[0]));
      return json({ today: r.days[0], where: { loc: r.loc, how: r.how } });
    }
    if (action === 'tell') {
      if (!String(body.message || '').trim()) return json({ error: 'Say something first.' }, 400);
      return json(await tell(sb, uid, String(body.message), coords));
    }
    if (action === 'forget') {
      await one(sb.from('jarvis_memory').delete().eq('user_id', uid).eq('id', body.id));
      const r = await replan(sb, uid, { coords });
      return json({ today: r.days[0] });
    }
    if (action === 'rule') {                                           // reset one rule number to his default
      const st = await one(sb.from('day_settings').select('prefs').eq('user_id', uid).maybeSingle()) || { prefs: {} };
      const rules = { ...((st.prefs || {}).rules || {}) }; delete rules[body.key];
      await saveSettings(sb, uid, { prefs: { ...(st.prefs || {}), rules } });
      const r = await replan(sb, uid, {}); return json({ today: r.days[0] });
    }
    if (action === 'place') {
      if (!S.PLACES.includes(body.key)) return json({ error: 'Unknown place.' }, 400);
      const at = coords || await resolveLink(body.url);
      const st = await one(sb.from('day_settings').select('places').eq('user_id', uid).maybeSingle()) || { places: {} };
      await saveSettings(sb, uid, { places: { ...(st.places || {}), [body.key]: { lat: at.lat, lng: at.lng, label: body.label || S.PLACE_NAME[body.key] } } });
      const r = await replan(sb, uid, {});
      return json({ ok: true, at, today: r.days[0] });
    }
    if (action === 'test-push') return json(await testPush(uid));
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
}
if (!env('JARVIS_TEST')) Deno.serve(handler);
export { handler, replan, tell, checkDay, notifyUser, loadAll };

// ---------------------------------------------------------------- notifications + scheduled work
async function deliver(uid: string, subs: any[], payload: Record<string, unknown>, ttl = 1800) {
  let ok = 0;
  for (const s of subs.filter(x => x.user_id === uid)) {
    try {
      const status = await sendPush(s, payload, cfg.vapid, ttl);
      if (status === 404 || status === 410) await svc().from('jarvis_push_subs').delete().eq('endpoint', s.endpoint);
      else if (status >= 200 && status < 300) ok++;
    } catch (e) { console.error('push error', e); }
  }
  return ok;
}
async function testPush(uid: string) {
  if (!cfg.vapid.privateKey) return { error: 'Push keys are not set up.' };
  const { data: subs } = await svc().from('jarvis_push_subs').select('*').eq('user_id', uid);
  if (!subs?.length) return { error: 'No devices have Jarvis notifications turned on yet.' };
  return { devices: subs.length, delivered: await deliver(uid, subs, { title: 'Jarvis', body: 'Notifications work on this device.', tag: 'test', url: './' }) };
}
async function claim(uid: string, key: string) {
  const { data, error } = await svc().from('jarvis_sent').upsert({ user_id: uid, key }, { onConflict: 'user_id,key', ignoreDuplicates: true }).select('key');
  if (error) { console.error(error); return false; }
  return !!data?.length;
}
async function sendOnce(uid: string, subs: any[], key: string, payload: Record<string, unknown>, ttl?: number) {
  if (!await claim(uid, key)) return 0;
  const ok = await deliver(uid, subs, payload, ttl);
  if (!ok) await svc().from('jarvis_sent').delete().eq('user_id', uid).eq('key', key);
  return ok;
}
const background = (p: Promise<unknown>) => { const w = (globalThis as any).EdgeRuntime?.waitUntil; if (w) w.call((globalThis as any).EdgeRuntime, p.catch(e => console.error('background', e))); else p.catch(e => console.error('background', e)); };

async function runCron() {
  const { data: subs, error } = await svc().from('jarvis_push_subs').select('*');
  if (error) throw error;
  const users = [...new Set((subs ?? []).map((s: any) => s.user_id))] as string[];
  const now = localNow();
  let sent = 0;
  for (const uid of users) { try { sent += await notifyUser(uid, subs!, now); } catch (e) { console.error('cron user', e); } }
  if (now.min % 60 === 0) await svc().from('jarvis_sent').delete().lt('sent_at', new Date(Date.now() - 3 * 864e5).toISOString());
  return { users: users.length, sent };
}

async function notifyUser(uid: string, subs: any[], now: { date: string, min: number }) {
  const sb = svc(), today = now.date, n = now.min;
  const within = (t: number, w = 5) => n >= t && n < t + w;
  let sent = 0;
  // the whole week is rebuilt every night at 3am (new deadlines, PPL Coach and Nutrition Coach changes); and whenever today has no plan
  let p0 = await one(sb.from('day_plans').select('plan').eq('user_id', uid).eq('date', today).maybeSingle());
  if (p0 && p0.plan?.version !== 2) p0 = null;                     // a plan from the old Jarvis: make a new one
  if ((n >= 180 && n < 195 && await claim(uid, `nightly:${today}`)) || (!p0 && await claim(uid, `gen:${today}:${Math.floor(n / 60)}`))) {
    background(replan(sb, uid, { reason: null, fresh: n < 240 }).then(r => checkDay(sb, uid, r.days[0])));
    return 0;
  }
  if (!p0) return 0;
  const plan = p0.plan, blocks = (plan.blocks || []) as any[];
  const { data: st } = await sb.from('day_settings').select('places,prefs,travel').eq('user_id', uid).maybeSingle();
  const settings = st || { places: {}, prefs: {}, travel: {} }; settings.travel = settings.travel || {};
  const fix = settings.prefs?.lastFix, fresh = fix && Date.now() - Date.parse(fix.at) < 15 * 60000 ? fix : null;

  // wake up
  const wake = blocks.find(b => b.type === 'wake');
  if (wake && within(wake.start, 15)) {
    const first = blocks.find(b => ['class', 'exam'].includes(b.type)), leave = blocks.find(b => b.type === 'drive' && !b.done);
    sent += await sendOnce(uid, subs, `wake:${today}`, { title: `Good morning — ${S.DAYS[S.dowOf(today)]}`, body: [first ? `${first.title} at ${S.t12(first.start)}.` : 'No classes today.', leave ? `Leave at ${S.t12(leave.start)}.` : '', plan.gym ? `Gym: ${S.PLACE_NAME[plan.gym.at]} at ${S.t12(plan.gym.start)}.` : ''].filter(Boolean).join(' '), tag: 'wake', url: './' });
  }
  // AI check found problems with today
  if (plan.check && !plan.check.ok && plan.check.issues?.length && n >= (wake ? wake.start : 360) && n < 1380)
    sent += await sendOnce(uid, subs, `check:${today}:${plan.sig?.length || 0}:${plan.check.at}`, { title: 'Jarvis: something in today won’t work', body: plan.check.issues.map((i: any) => `${i.at}: ${i.problem}`).join(' '), tag: 'check', url: './' }, 3600);

  for (const [i, b] of blocks.entries()) {
    if (b.done) continue;
    // drives: live traffic ~60/35/20/10 min out (uni from 90), the leave reminder, and "where are you?" afterwards
    if (b.type === 'drive') {
      const s = b.start;
      const stage = (b.to === 'uni' ? [90, 60, 35, 20, 10] : [60, 35, 20, 10]).find(m => n >= s - m && n < s - m + 5);
      const origin = fresh || (b.from && b.from !== 'here' && settings.places[b.from]);
      if (stage && origin && settings.places[b.to] && canSpend(settings, 'routes', 1) && await claim(uid, `tchk:${today}:${b.ref}:${stage}`)) {
        background((async () => {
          const live = await gRoute(origin, settings.places[b.to]);
          usage(settings).routes += 1; await saveSettings(sb, uid, { travel: settings.travel });
          if (live == null) return;
          const msg = await trafficShift(sb, uid, plan, i, live, n);
          if (msg) await deliver(uid, subs, { title: msg.title, body: msg.body, tag: 'traffic', url: './' }, 1800);
        })());
      }
      const bring = (b.bring || []).length ? ` Bring: ${b.bring.map((x: string) => x.split(' — ')[0]).join(', ')}.` : '';
      if (within(s - 10)) sent += await sendOnce(uid, subs, `leave10:${today}:${b.ref}`, { title: `Leave at ${S.t12(s)} → ${b.title.replace('Leave for ', '')}`, body: `${b.detail}.${bring}`, tag: 'leave', url: './' }, 900);
      if (within(s)) sent += await sendOnce(uid, subs, `leave0:${today}:${b.ref}`, { title: `Leave now → ${b.title.replace('Leave for ', '')}`, body: `${b.detail}.${bring}`, tag: 'leave', url: './' }, 900);
      // he should have arrived: if nothing confirms where he is, ask him to open the app (it sends his location)
      if (within(b.end + 15, 10) && !fresh) sent += await sendOnce(uid, subs, `where:${today}:${b.ref}`, { title: `Made it to ${S.PLACE_NAME[b.to] || 'there'}?`, body: 'Open Jarvis so I can see where you are and keep the rest of today right. Tap the drive to check it off.', tag: 'where', url: './' }, 1800);
      continue;
    }
    if (!b.check || ['class', 'exam', 'wake', 'sleep'].includes(b.type) || b.type === 'place') continue;
    if (!within(b.start)) continue;
    const title = b.type === 'maid' ? b.title : b.type === 'gym' ? `Gym: ${b.title}` : b.title;
    const body = b.type === 'maid' ? 'Open Jarvis and tap it to copy the message.' : [b.detail, b.walk ? 'On the walking pad.' : '', b.supplements?.length ? `With: ${b.supplements.join(', ')}.` : ''].filter(Boolean).join(' ');
    sent += await sendOnce(uid, subs, `blk:${today}:${b.ref}`, { title, body: String(body).slice(0, 240), tag: 'block', url: './' }, 900);
  }
  return sent;
}
