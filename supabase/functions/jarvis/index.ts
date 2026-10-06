// jarvis — Salah's chief of staff, server side.
// Jarvis READS Uni Planner, PPL Coach and Nutrition Coach (never writes to them). It plans his days with Claude,
// talks with him and remembers what he says, analyses each app, writes a weekly report and sends notifications.
// The thinking lives in core.js / brain.js / engine.js (the same files the app and the preview use).
//
// Two ways in:
//   • The app, with his login token — requests run AS him, so row-level security limits them to his rows.
//   • pg_cron every minute with header x-cron-secret — notifications and scheduled work, using the server key;
//     every query on that path is scoped to one user_id.
// JWT verification is OFF at the gateway because the cron call has no user token; this file checks both itself.
//
// Secrets: ANTHROPIC_API_KEY (required), GOOGLE_MAPS_API_KEY (traffic, optional), AI_MODEL (optional).
// Push keys and the cron secret are shared with Uni Planner (table planner_private).
//
// POST { action: 'plan', date, nowMin?, coords?, request? } → Claude plans the day (saved); request = a change he picked
// POST { action: 'solve', date, i?, problem?, missing? }    → options for something in the way (no time, missing food, gym won't fit…)
// POST { action: 'choose', date, id, option }               → go with one option: the day is re-planned around it
// POST { action: 'pantry', changes: [{food, status}] }     → what he's out of / has again
// POST { action: 'kitchen' }                                → what Jarvis has learned: cook times, what's missing, recent days
// POST { action: 'goals' }                                  → his big goals with progress, the habits and rules under them, marks
// POST { action: 'mark', ref?, course?, title?, score, outOf } → a mark he got (Uni Planner has no scores)
// POST { action: 'ask', date, message, nowMin?, coords? }  → Jarvis answers; may remember, forget, set a rest day, re-plan
// POST { action: 'ahead' }                                  → the next 7 days (facts + saved plans)
// POST { action: 'review', app? }                           → analyse one app, or all three (saved)
// POST { action: 'report' }                                 → the weekly report (saved, and posted in the chat)
// POST { action: 'eta', coords, to }                        → live drive minutes from where he is
// POST { action: 'traffic', date, i, coords, to, nowMin }   → live drive no longer fits: shift the leave time or re-plan, and say what changed
// POST { action: 'travel' }                                 → recompute drive times between his places
// POST { action: 'resolve-link', url }                      → coordinates from a Google Maps link
// POST { action: 'test-push' }                              → a test notification
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as E from './engine.js';
import { createJarvis, shapeApps } from './core.js';
import { sendPush } from './push.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const MODEL = env('AI_MODEL') || 'claude-sonnet-5-5';
const TZ = 180;                                         // Kuwait, no daylight saving
const MONTHLY_CAP = 4500;                               // Google Routes: free up to 5,000 a month per endpoint
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const localNow = () => E.localOf(new Date().toISOString(), TZ);
const clock = { today: () => localNow().date, nowMin: () => localNow().min };

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
async function aiJson({ system, turns, schema, task }: any) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Jarvis needs ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    // Newer models don't allow forcing a tool, so the tool is offered and the system prompt says to answer with it;
    // if a reply ever comes back as text instead, the JSON in it is used.
    body: JSON.stringify({ model: MODEL, max_tokens: task === 'plan' ? 16000 : 8000,
      system: `${system}\n\nAlways give your final answer by calling the "answer" tool exactly once, with every required field. Do not answer in plain text.`,
      messages: turns, tools: [{ name: 'answer', description: 'Give your final answer in this shape.', input_schema: schema }], tool_choice: { type: 'auto' } })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude request failed (${r.status}): ${j?.error?.message || 'unknown error'}`);
  const call = (j.content || []).find((c: any) => c.type === 'tool_use' && c.name === 'answer');
  if (call) return call.input;
  const text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'), a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new Error(j.stop_reason === 'max_tokens' ? 'Claude ran out of room before finishing — try again.' : 'Claude gave no answer.');
}

// ---------------------------------------------------------------- his data (read his apps, write only Jarvis's tables)
function supabaseDb(sb: any, uid: string) {
  const one = async (q: any) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
  return {
    async load() {
      const t = clock.today();
      const [classes, events, ps, ppl, nut, settings, memory, plans, marks] = await Promise.all([
        one(sb.from('planner_classes').select('course,kind,weekday,start_time,end_time,room,instructor').eq('user_id', uid)),
        one(sb.from('planner_events').select('id,course,title,kind,due_at,all_day,weight,note,done,remind').eq('user_id', uid)
          .gte('due_at', new Date(Date.now() - 40 * 864e5).toISOString()).lte('due_at', new Date(Date.now() + 75 * 864e5).toISOString())),
        one(sb.from('planner_settings').select('*').eq('user_id', uid).maybeSingle()),
        one(sb.from('ppl_records').select('kind,key,body').eq('user_id', uid)),
        one(sb.from('nutrition_records').select('kind,id,body,deleted').eq('user_id', uid).eq('deleted', false).in('kind', ['profile', 'plan_version', 'measurement', 'food_log', 'weekly_review', 'phase_history', 'grocery_check'])),
        one(sb.from('day_settings').select('places,prefs,travel').eq('user_id', uid).maybeSingle()),
        one(sb.from('jarvis_memory').select('id,kind,strength,text,serves,track,target,category,course,qid,date,overrides,active,created_at').eq('user_id', uid).eq('active', true).order('created_at')),
        one(sb.from('day_plans').select('date,plan').eq('user_id', uid).gte('date', E.addDays(t, -42)).lte('date', E.addDays(t, 14)).order('date')),
        one(sb.from('jarvis_marks').select('id,event_id,course,title,weight,score,out_of,created_at').eq('user_id', uid).order('created_at'))
      ]);
      const from = E.addDays(t, -1);
      return { classes, events, plannerSettings: ps || {}, ...shapeApps({ pplRows: ppl, nutritionRows: nut }),
        settings: settings || { places: {}, prefs: {}, travel: {} }, memory: (memory || []).filter((m: any) => m.kind !== 'day' || m.date >= from), plans: plans || [], marks: marks || [] };
    },
    async getPlan(date: string) { const r = await one(sb.from('day_plans').select('plan').eq('user_id', uid).eq('date', date).maybeSingle()); return r ? r.plan : null; },
    async savePlan(date: string, plan: any) { await one(sb.from('day_plans').upsert({ user_id: uid, date, plan, source: 'ai', updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' })); },
    async deletePlans(dates: string[]) { if (dates.length) await one(sb.from('day_plans').delete().eq('user_id', uid).in('date', dates)); },
    async insertMemory(row: any) { return await one(sb.from('jarvis_memory').insert({ user_id: uid, ...row }).select('id,kind,strength,text,serves,track,target,category,course,qid,date,overrides').single()); },
    async insertMark(row: any) { return await one(sb.from('jarvis_marks').insert({ user_id: uid, ...row }).select('id,event_id,course,title,weight,score,out_of').single()); },
    async deleteMemory(id: string) { const r = await one(sb.from('jarvis_memory').delete().eq('user_id', uid).eq('id', id).select('kind,text,date')); return r && r[0] || null; },
    async saveSettings(patch: any) {
      const cur = await one(sb.from('day_settings').select('places,prefs,travel').eq('user_id', uid).maybeSingle()) || {};
      await one(sb.from('day_settings').upsert({ user_id: uid, ...cur, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
    },
    async saveMessage(m: any) { await one(sb.from('jarvis_messages').insert({ user_id: uid, ...m })); },
    async recentMessages(n: number) { const r = await one(sb.from('jarvis_messages').select('role,kind,body,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(n)); return (r || []).reverse(); },
    async saveReview(app: string, review: any, stats: any) { await one(sb.from('jarvis_reviews').insert({ user_id: uid, app, review, stats })); },
    async latestReviews() {
      const r = await one(sb.from('jarvis_reviews').select('app,review,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(30));
      const out: any = { ppl: null, nutrition: null, uni: null };
      for (const x of r || []) if (!out[x.app]) out[x.app] = x.review;
      return out;
    },
    async saveReport(row: any) { await one(sb.from('jarvis_reports').insert({ user_id: uid, source: 'ai', ...row })); },
    async latestReport() { const r = await one(sb.from('jarvis_reports').select('report').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)); return r && r[0] ? r[0].report : null; }
  };
}

// ---------------------------------------------------------------- drive times
const month = () => localNow().date.slice(0, 7);
function usage(settings: any) { const t = settings.travel = settings.travel || {}; if (!t.usage || t.usage.month !== month()) t.usage = { month: month(), matrix: 0, routes: 0 }; return t.usage; }
const googleOn = () => !!env('GOOGLE_MAPS_API_KEY');
const canSpend = (settings: any, kind: 'matrix' | 'routes', n: number) => googleOn() && usage(settings)[kind] + n <= MONTHLY_CAP;
const placesKey = (places: any) => E.PLACES.map((k: string) => places[k] ? `${k}:${(+places[k].lat).toFixed(5)},${(+places[k].lng).toFixed(5)}` : `${k}:-`).join('|');
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

/** Empty-road minutes between his places (the fallback). Cached until a place moves. */
async function freeFlow(db: any, settings: any, force = false) {
  const places = settings.places || {}, t = settings.travel = settings.travel || {}, key = placesKey(places);
  if (!force && t.computed_for === key) return t;
  const have = E.PLACES.filter((k: string) => places[k] && isFinite(+places[k].lat));
  for (const k of Object.keys(t)) if (/^[a-z]+-[a-z]+$/.test(k)) delete t[k];
  t.computed_for = key; t.computed_at = new Date().toISOString(); t.profiles = {};
  if (have.length >= 2) {
    const m = await osrmTable(have.map((k: string) => places[k]));
    for (let i = 0; i < have.length; i++) for (let j = i + 1; j < have.length; j++) { const a = m[i][j], b = m[j][i]; if (a != null && b != null) t[[have[i], have[j]].sort().join('-')] = Math.round(Math.max(a, b) / 60); }
  }
  await db.saveSettings({ travel: t });
  return t;
}
/** Google's predicted drive time by departure hour for the weekday of `date`. Cached 14 days per weekday. */
async function trafficProfile(db: any, settings: any, date: string) {
  const places = settings.places || {}, have = E.PLACES.filter((k: string) => places[k] && isFinite(+places[k].lat));
  if (have.length < 2 || !googleOn()) return null;
  const t = settings.travel, dow = E.dowOf(date), key = placesKey(places);
  const cached = t.profiles && t.profiles[dow];
  if (cached && cached.key === key && Date.now() - Date.parse(cached.at) < 14 * 864e5) return cached.data;
  // every 2 hours from 6am to 10pm (Jarvis interpolates between), and never gym → gym: keeps six places inside the free monthly quota
  const HOURS = [6, 8, 10, 12, 14, 16, 18, 20, 22];
  const pairs = have.flatMap((a: string) => have.filter((b: string) => b !== a && !(E.isGym(a) && E.isGym(b))).map((b: string) => [a, b]));
  const cost = HOURS.length * pairs.length;
  if (!canSpend(settings, 'matrix', cost)) return cached ? cached.data : null;
  const data: Record<string, [number, number][]> = {}, jobs: (() => Promise<void>)[] = [];
  for (const h of HOURS) {
    let when = localToDate(date, h * 60);
    while (when.getTime() < Date.now() + 5 * 60000) when = new Date(when.getTime() + 7 * 864e5);
    for (const a of have) { const others = pairs.filter(p => p[0] === a).map(p => p[1]); if (!others.length) continue; jobs.push(async () => {
      const m = await gMatrix([places[a]], others.map((b: string) => places[b]), when);
      others.forEach((b: string, i: number) => { const v = m[0][i]; if (v != null) (data[`${a}>${b}`] = data[`${a}>${b}`] || []).push([h * 60, Math.round(v * 10) / 10]); });
    }); }
  }
  for (let i = 0; i < jobs.length; i += 9) await Promise.all(jobs.slice(i, i + 9).map(f => f()));
  for (const k of Object.keys(data)) data[k].sort((x, y) => x[0] - y[0]);
  usage(settings).matrix += cost;
  t.profiles = { ...(t.profiles || {}), [dow]: { key, at: new Date().toISOString(), data } };
  await db.saveSettings({ travel: t });
  return data;
}
/** Where he is: one of his places (within 400 m), or 'here' with drive times from there. */
async function whereAmI(db: any, settings: any, coords: any) {
  const places = settings.places || {};
  if (!coords || !isFinite(+coords.lat)) return { loc: null, freeFlow: {}, profile: {} };
  const known = E.PLACES.filter((k: string) => places[k]);
  let best: string | null = null, bd = Infinity;
  for (const k of known) { const d = dist(coords, places[k]); if (d < bd) { bd = d; best = k; } }
  if (best && bd <= 400) return { loc: best, freeFlow: {}, profile: {} };
  if (!known.length) return { loc: null, freeFlow: {}, profile: {} };
  try {
    if (canSpend(settings, 'matrix', known.length)) {
      const m = await gMatrix([coords], known.map((k: string) => places[k]));
      usage(settings).matrix += known.length; await db.saveSettings({ travel: settings.travel });
      const profile: any = {}; known.forEach((k: string, i: number) => { const v = m[0][i]; if (v != null) profile[`here>${k}`] = [[0, v], [1439, v]]; });
      return { loc: 'here', freeFlow: {}, profile };
    }
    const m = await osrmTable([coords, ...known.map((k: string) => places[k])]);
    const ff: any = {}; known.forEach((k: string, i: number) => { const v = m[0][i + 1]; if (v != null) ff[['here', k].sort().join('-')] = Math.round(v / 60); });
    return { loc: 'here', freeFlow: ff, profile: {} };
  } catch { return { loc: null, freeFlow: {}, profile: {} }; }
}
function placesAdapter(db: any) {
  return {
    async drive({ settings, date, coords }: any) {
      const parking = (settings.prefs && settings.prefs.parking) ?? 10;
      const ff = await freeFlow(db, settings).catch(() => settings.travel || {});
      let profile: any = null; try { profile = await trafficProfile(db, settings, date); } catch (e) { console.error('traffic', e); }
      const where = coords ? await whereAmI(db, settings, coords) : { loc: null, freeFlow: {}, profile: {} };
      const prof = (profile || Object.keys(where.profile).length) ? { ...(profile || {}), ...where.profile } : null;
      return { drive: E.makeDrive({ profile: prof, freeFlow: { ...ff, ...where.freeFlow }, parking }), startLoc: where.loc };
    }
  };
}
async function eta(db: any, settings: any, coords: any, to: string) {
  const places = settings.places || {};
  if (!coords || !places[to]) return { error: `Set your ${to} location first.` };
  const parking = to === 'uni' ? ((settings.prefs && settings.prefs.parking) ?? 10) : 0;
  if (canSpend(settings, 'routes', 1)) {
    const live = await gRoute(coords, places[to]);
    usage(settings).routes += 1; await db.saveSettings({ travel: settings.travel });
    if (live != null) return { minutes: Math.ceil(live) + parking, drive: Math.ceil(live), parking, live: true };
  }
  const m = await osrmTable([coords, places[to]]);
  const raw = m[0][1] == null ? null : m[0][1]! / 60;
  return raw == null ? { error: 'No route found.' } : { minutes: Math.ceil(raw) + parking, drive: Math.ceil(raw), parking, live: false };
}
/** Coordinates from a Google Maps link (short links are followed, but only to Google). */
async function resolveLink(url: any) {
  let u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('Paste a Google Maps link, or coordinates like 29.31, 47.98.');
  const googleHost = (h: string) => /(^|\.)google\.[a-z.]+$/.test(h) || /(^|\.)goo\.gl$/.test(h);
  const parse = (s: string) => {
    const t = decodeURIComponent(s);
    const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (!m) return null;
    const name = t.match(/\/place\/([^/@?]+)/);
    return { lat: +(+m[1]).toFixed(6), lng: +(+m[2]).toFixed(6), label: name ? name[1].replace(/\+/g, ' ').slice(0, 80) : null };
  };
  for (let i = 0; i < 5; i++) {
    if (!googleHost(new URL(u).hostname)) throw new Error('That isn’t a Google Maps link.');
    const hit = parse(u); if (hit) return hit;
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (jarvis personal app)' } });
    const loc = r.headers.get('location');
    if (!loc) { const h2 = parse((await r.text()).slice(0, 200000)); if (h2) return h2; break; }
    u = new URL(loc, u).href;
  }
  throw new Error('I couldn’t find a location in that link. Use “I’m here” at the place, or paste its coordinates.');
}

// ---------------------------------------------------------------- requests from the app
Deno.serve(async req => {
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
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'plan';
    if (action === 'resolve-link') return json(await resolveLink(body.url));
    if (action === 'test-push') return json(await testPush(user.id));
    const db = supabaseDb(sb, user.id);
    if (body.coords && isFinite(+body.coords.lat) && isFinite(+body.coords.lng)) {        // the server uses it for traffic checks while it's fresh
      const { data: cur } = await sb.from('day_settings').select('prefs').eq('user_id', user.id).maybeSingle();
      await db.saveSettings({ prefs: { ...((cur && cur.prefs) || {}), lastFix: { lat: +(+body.coords.lat).toFixed(5), lng: +(+body.coords.lng).toFixed(5), at: new Date().toISOString() } } }).catch(() => {});
    }
    const J = createJarvis({ db, ai: { json: aiJson }, places: placesAdapter(db), clock, planBudgetMs: 95000 });
    if (action === 'plan') return json(await J.plan({ date: body.date, nowMin: body.nowMin, coords: body.coords, request: body.request ? String(body.request).slice(0, 600) : null }));
    if (action === 'solve') return json(await J.solve({ date: body.date, i: body.i, about: body.about, problem: body.problem, missing: body.missing, nowMin: body.nowMin, coords: body.coords }));
    if (action === 'choose') return json(await J.choose({ date: body.date, id: body.id, option: body.option, nowMin: body.nowMin, coords: body.coords }));
    if (action === 'pantry') return json(await J.setPantry({ changes: body.changes || [] }));
    if (action === 'kitchen') return json(await J.kitchen());
    if (action === 'goals') return json(await J.goals());
    if (action === 'mark') return json(await J.addMark({ ref: body.ref, course: body.course, title: body.title, weight: body.weight, score: body.score, outOf: body.outOf }));
    if (action === 'ask') return json(await J.ask({ date: body.date, message: body.message, nowMin: body.nowMin, coords: body.coords }));
    if (action === 'ahead') return json({ days: await J.ahead() });
    if (action === 'review') return json(body.app ? { [body.app]: await J.review({ app: body.app }) } : await J.reviewAll());
    if (action === 'report') return json({ report: await J.report() });
    const settings = (await db.load()).settings;
    if (action === 'travel') return json({ travel: await freeFlow(db, settings, true) });
    if (action === 'eta') return json(await eta(db, settings, body.coords, body.to));
    if (action === 'traffic') {                                     // the app saw a live drive time that no longer fits
      const t = await eta(db, settings, body.coords, body.to);
      if (t.error || t.minutes == null) return json({ action: 'none', error: t.error });
      return json(await J.traffic({ date: body.date, i: body.i, need: t.minutes, nowMin: body.nowMin, coords: body.coords, source: 'from his phone, live' }));
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e), errors: (e as any).errors || undefined }, 500);
  }
});

// ---------------------------------------------------------------- notifications + scheduled work
const NOTIFY_DEFAULTS = { tomorrow: true, wake: true, leave: true, lead: 10, report: true, blocks: { gym: true, study: true, homework: true, cook: true, meal: false, sleep: true } };
const notifyPrefs = (settings: any) => { const n = (settings.prefs && settings.prefs.notify) || {}; return { ...NOTIFY_DEFAULTS, ...n, blocks: { ...NOTIFY_DEFAULTS.blocks, ...(n.blocks || {}) } }; };
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
  const ok = await deliver(uid, subs, { title: 'Jarvis', body: 'Notifications are working on this device.', tag: 'test', url: './' });
  return { devices: subs.length, delivered: ok };
}
async function claim(uid: string, key: string, value: string | null = null) {
  const { data, error } = await svc().from('jarvis_sent').upsert({ user_id: uid, key, value }, { onConflict: 'user_id,key', ignoreDuplicates: true }).select('key');
  if (error) { console.error(error); return false; }
  return !!data?.length;
}
async function sendOnce(uid: string, subs: any[], key: string, payload: Record<string, unknown>, ttl?: number) {
  if (!await claim(uid, key)) return 0;
  const ok = await deliver(uid, subs, payload, ttl);
  if (!ok) await svc().from('jarvis_sent').delete().eq('user_id', uid).eq('key', key);
  return ok;
}
// Long work (Claude) keeps running after the cron call returns.
const background = (p: Promise<unknown>) => { const w = (globalThis as any).EdgeRuntime?.waitUntil; if (w) w.call((globalThis as any).EdgeRuntime, p.catch(e => console.error('background', e))); else p.catch(e => console.error('background', e)); };

async function runCron() {
  const { data: subs, error } = await svc().from('jarvis_push_subs').select('*');
  if (error) throw error;
  const users = [...new Set((subs ?? []).map((s: any) => s.user_id))] as string[];
  const now = localNow();
  let sent = 0;
  for (const uid of users) { try { sent += await notifyUser(uid, subs!, now.date, now.min); } catch (e) { console.error('cron user', e); } }
  if (now.min % 60 === 0) await svc().from('jarvis_sent').delete().lt('sent_at', new Date(Date.now() - 3 * 864e5).toISOString());
  return { users: users.length, sent };
}

const bringText = (p: any) => (p.bring || []).length ? `Bring: ${(p.bring || []).map((b: any) => b.what).join(', ')}.` : '';
const maidText = (p: any) => { const m = (p.blocks || []).filter((b: any) => b.type === 'cook' && b.by === 'maid' && b.message); return m.length ? `Text your maid tonight: ${m.map((b: any) => `“${b.message}”`).join(' ')}` : ''; };
const firstClassText = (p: any) => { const c = (p.blocks || []).find((b: any) => b.type === 'class' || b.type === 'exam'); const lv = (p.blocks || []).find((b: any) => b.type === 'travel' && b.to === 'uni'); return c ? `Leave ${E.t12(E.toMin(lv ? lv.start : c.start))} for ${c.title} at ${E.t12(E.toMin(c.start))}.` : ''; };

async function notifyUser(uid: string, subs: any[], today: string, n: number) {
  const db = supabaseDb(svc(), uid);
  const J = createJarvis({ db, ai: { json: aiJson }, places: placesAdapter(db), clock, planBudgetMs: 120000 });
  const { data: st } = await svc().from('day_settings').select('prefs').eq('user_id', uid).maybeSingle();
  const np = notifyPrefs({ prefs: st && st.prefs || {} });
  const within = (t: number) => n >= t && n < t + 15;               // tolerate a late or skipped cron run
  let sent = 0;
  const todayPlan = await db.getPlan(today);
  const tomorrow = E.addDays(today, 1);

  // evening: Jarvis plans tomorrow and tells him when to get up (about 90 min before tonight's lights out, else 19:30)
  const sleepB = todayPlan && (todayPlan.blocks || []).find((b: any) => b.type === 'sleep');
  const eveningAt = sleepB ? Math.max(18 * 60, E.planMin(sleepB.start)! - 90) : 19 * 60 + 30;
  if (np.tomorrow && n >= eveningAt && n < 23 * 60 + 30 && !(await db.getPlan(tomorrow)) && await claim(uid, `tplan:${tomorrow}`)) {
    background((async () => {
      const r = await J.plan({ date: tomorrow });
      const w = r.plan.blocks.find((b: any) => b.type === 'wake');
      await deliver(uid, subs, { title: `Tomorrow: up at ${w ? E.t12(E.toMin(w.start)) : '—'}`, body: [r.plan.summary, firstClassText(r.plan), bringText(r.plan), maidText(r.plan)].filter(Boolean).join(' '), tag: 'tomorrow', url: './' }, 43200);
    })());
  }
  // early morning: no plan yet for today → make one
  if (!todayPlan && n >= 3 * 60 && n < 12 * 60 && await claim(uid, `gen:${today}`)) background(J.plan({ date: today }));
  // nightly: fresh analysis of each app
  if (n >= 2 * 60 && n < 2 * 60 + 15 && await claim(uid, `reviews:${today}`)) background(J.reviewAll());
  // weekly report, Saturday 9pm
  if (np.report && E.dowOf(today) === 6 && within(21 * 60) && await claim(uid, `report:${today}`)) background((async () => {
    const r = await J.report();
    await deliver(uid, subs, { title: 'Your weekly report is ready', body: r.headline || '', tag: 'report', url: './#ask' }, 43200);
  })());
  if (!todayPlan) return sent;
  const blocks = (todayPlan.blocks || []) as any[];

  // wake-up brief
  const wake = blocks.find(b => b.type === 'wake');
  if (np.wake && wake && within(E.toMin(wake.start)!)) sent += await sendOnce(uid, subs, `wake:${today}`, { title: `Good morning — ${E.DAYS[E.dowOf(today)]}`, body: [todayPlan.summary, firstClassText(todayPlan)].filter(Boolean).join(' '), tag: 'wake', url: './' });

  // live traffic: checked about 60, 35, 20 and 10 min before each drive, from his phone's last position when it's fresh.
  // A delay Jarvis can absorb moves the leave time (out of free time); a bigger one re-plans the rest of the day. Either way he's told.
  const { data: setRow } = await svc().from('day_settings').select('places,prefs,travel').eq('user_id', uid).maybeSingle();
  const settings = setRow || { places: {}, prefs: {}, travel: {} }, places = settings.places || {};
  const fix = settings.prefs && settings.prefs.lastFix, fresh = fix && Date.now() - Date.parse(fix.at) < 15 * 60000 ? fix : null;
  for (const [i, b] of blocks.entries()) {
    if (b.type !== 'travel' || b.skipped || b.done || !b.to) continue;
    const s = E.planMin(b.start)!, e = E.planMin(b.end)!;
    if (n < s - 95 || n > e) continue;
    const stage = (b.to === 'uni' ? [90, 60, 35, 20, 10] : [60, 35, 20, 10]).find(m => n >= s - m && n < s - m + 5);   // class drives are watched from 90 min out
    const from = b.from || (i > 0 ? blocks[i - 1].loc : null), origin = fresh || (from && places[from]);
    if (stage && origin && places[b.to] && canSpend(settings, 'routes', 1) && await claim(uid, `tchk:${today}:${b.to}:${b.end}:${stage}`)) {
      background((async () => {
        const live = await gRoute(origin, places[b.to]);
        usage(settings).routes += 1; await db.saveSettings({ travel: settings.travel });
        if (live == null) return;
        const need = Math.ceil(live) + (b.to === 'uni' ? ((settings.prefs && settings.prefs.parking) ?? 10) : 0);
        const r = await J.traffic({ date: today, i, need, nowMin: n, source: fresh ? 'from his phone\'s location' : 'from where the plan has him' });
        if (['shift', 'replan', 'alert'].includes(r.action)) await deliver(uid, subs, { title: r.title, body: r.message, tag: 'traffic', url: './' }, 1800);
      })());
    }
    if (np.leave && n >= s - np.lead && n < e) {
      const next = blocks.slice(i + 1).find((x: any) => !['travel', 'free'].includes(x.type));
      const firstOut = from === 'home' && !blocks.slice(0, i).some((x: any) => x.type === 'travel' && (x.from || 'home') === 'home');
      const shop = (b.shop || []).length ? `Stop for ${(b.shop as string[]).map(f => (E.FOODS as any)[f] ? (E.FOODS as any)[f][0].toLowerCase() : f).join(', ')} on the way.` : '';
      sent += await sendOnce(uid, subs, `leave:${today}:${b.start}:${b.to}`, { title: `Leave ${n >= s ? 'now' : 'at ' + E.t12(s)} → ${(E.PLACE_NAME as any)[b.to]}`, body: [b.trafficNote || '', firstOut ? bringText(todayPlan) : '', shop, next ? `Next: ${next.title} at ${E.t12(E.toMin(next.start))}.` : ''].filter(Boolean).join(' '), tag: 'leave', url: './' }, 900);
    }
  }
  // the start of each block he wants a nudge for
  for (const b of blocks) {
    if (b.done || b.skipped || !np.blocks[b.type] || b.by === 'maid') continue;
    const s = E.planMin(b.start)!;
    if (!within(b.type === 'sleep' ? s - 30 : s)) continue;
    const title = b.type === 'sleep' ? `Lights out at ${E.t12(s)} — start winding down` : b.title;
    const help = ['cook', 'gym', 'study', 'homework'].includes(b.type) ? 'Can’t right now? Open Jarvis → Problem? for options.' : '';
    sent += await sendOnce(uid, subs, `blk:${today}:${b.start}:${b.type}`, { title, body: [b.detail, b.type === 'sleep' ? '' : `Until ${E.t12(E.planMin(b.end)!)}`, help].filter(Boolean).join(' · '), tag: 'block', url: './' }, 900);
  }
  return sent;
}
