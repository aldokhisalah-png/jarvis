// End-to-end test of the jarvis Edge Function (the real file) against an in-memory database and a scripted Claude.
// Run: deno run -A --import-map=test/import_map.json test/function.test.ts
import { DB, UID } from './fake-supabase.ts';
import { SAMPLE } from '../src/sample-data.js';

// ---- a fixed clock: Mon 5 Oct 2026, 03:30 in Kuwait (changeable) ----
const RealDate = Date; let NOW = RealDate.parse('2026-10-05T00:30:00Z');
class FakeDate extends RealDate { constructor(...a: any[]) { super(...(a.length ? a : [NOW]) as [any]); } static now() { return NOW; } }
(globalThis as any).Date = FakeDate;
const setLocal = (hhmm: string, date = '2026-10-05') => { NOW = RealDate.parse(`${date}T${hhmm}:00+03:00`); };
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓ ' + m); };

// ---- push keys (real ones, so notifications are actually encrypted and signed) ----
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const vk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const vjwk = await crypto.subtle.exportKey('jwk', vk.privateKey);
const vpub = b64u(await crypto.subtle.exportKey('raw', vk.publicKey));
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = b64u(await crypto.subtle.exportKey('raw', ua.publicKey));

// ---- his data, shaped like the real tables ----
const own = (rows: any[]) => rows.map(r => ({ user_id: UID, ...r }));
Object.assign(DB, {
  planner_classes: own(SAMPLE.classes.map((c: any) => ({ id: crypto.randomUUID(), instructor: null, ...c }))),
  planner_events: own(SAMPLE.events.map((e: any) => ({ all_day: false, note: null, remind: true, ...e }))),
  planner_settings: own([SAMPLE.plannerSettings]),
  ppl_records: own(SAMPLE.pplRows), nutrition_records: own(SAMPLE.nutritionRows),
  day_settings: own([{ places: SAMPLE.settings.places, prefs: { parking: 10, arrivalBuffer: 0 }, travel: {} }]),
  jarvis_memory: own(SAMPLE.memory.map((m: any) => ({ serves: [], track: null, target: null, ...m, date: null, overrides: {}, active: true, created_at: '2026-10-04T10:00:00Z' }))),
  day_plans: [], jarvis_messages: [], jarvis_reviews: [], jarvis_reports: [], jarvis_sent: [], jarvis_marks: [],
  jarvis_push_subs: [{ endpoint: 'https://push.example/sub1', user_id: UID, p256dh: uaPub, auth: b64u(crypto.getRandomValues(new Uint8Array(16))), device: 'test' }],
  planner_private: [{ key: 'CRON_SECRET', value: 'cron-s3cret' }, { key: 'VAPID_PUBLIC_KEY', value: vpub }, { key: 'VAPID_PRIVATE_KEY', value: vjwk.d }]
});
const before = JSON.stringify(['planner_classes', 'planner_events', 'planner_settings', 'ppl_records', 'nutrition_records'].map(t => DB[t]));

// ---- the outside world ----
const B = (start: string, end: string, type: string, title: string, extra: any = {}) => ({ start, end, type, title, reason: 'r', ...extra });
const MONDAY = { summary: 'Lab at 8:30, two lectures, Legs at 6pm, lights out 9pm.', blocks: [
  B('05:00', '05:00', 'wake', 'Wake up', { loc: 'home' }), B('05:05', '05:20', 'cook', 'Make breakfast', { loc: 'home' }), B('05:20', '05:40', 'meal', 'Breakfast', { loc: 'home' }),
  B('05:40', '07:00', 'study', 'Prepare CE 337 Graded Lab 1', { loc: 'home', ref: 'lab337-1' }), B('07:50', '08:20', 'travel', 'Drive to uni', { from: 'home', to: 'uni' }),
  B('08:30', '11:00', 'class', 'CE 337 Lab', { loc: 'uni' }), B('11:00', '11:30', 'travel', 'Drive home', { from: 'uni', to: 'home' }),
  B('11:30', '12:00', 'cook', 'Cook lunch', { loc: 'home' }), B('12:00', '12:20', 'meal', 'Lunch', { loc: 'home' }), B('12:25', '12:55', 'travel', 'Drive to uni', { from: 'home', to: 'uni' }),
  B('13:00', '14:15', 'class', 'BIOL 110 Lecture', { loc: 'uni' }), B('14:15', '15:30', 'study', 'BIOL 110 quiz', { loc: 'uni', ref: 'quiz-bio' }), B('16:00', '16:10', 'meal', 'Pre-workout', { loc: 'uni' }),
  B('16:30', '17:45', 'class', 'CE 468 Lecture', { loc: 'uni' }), B('17:45', '18:00', 'travel', 'Drive to Oxygen Rigae', { from: 'uni', to: 'gym_rigae' }), B('18:00', '19:30', 'gym', 'Legs', { loc: 'gym_rigae' }),
  B('19:30', '19:40', 'travel', 'Drive home', { from: 'gym', to: 'home' }), B('19:40', '20:05', 'cook', 'Cook dinner', { loc: 'home' }), B('20:05', '20:25', 'meal', 'Dinner', { loc: 'home' }),
  B('20:30', '20:40', 'meal', 'Evening shake', { loc: 'home' }), B('21:00', '21:00', 'sleep', 'Lights out', { loc: 'home' })] };
const LATE = { summary: 'Gym at 10pm, lights out 12:30am.', blocks: [
  B('11:40', '12:00', 'cook', 'Cook lunch', { loc: 'home' }), B('12:00', '12:20', 'meal', 'Lunch', { loc: 'home' }), B('12:25', '12:55', 'travel', 'Drive to uni', { from: 'home', to: 'uni' }),
  B('13:00', '14:15', 'class', 'BIOL 110 Lecture', { loc: 'uni' }), B('16:30', '17:45', 'class', 'CE 468 Lecture', { loc: 'uni' }), B('17:45', '18:15', 'travel', 'Drive home', { from: 'uni', to: 'home' }),
  B('18:15', '19:00', 'cook', 'Cook dinner', { loc: 'home' }), B('19:00', '19:20', 'meal', 'Dinner', { loc: 'home' }), B('21:45', '22:00', 'travel', 'Drive to Oxygen Rigae', { from: 'home', to: 'gym_rigae' }),
  B('22:00', '23:30', 'gym', 'Legs', { loc: 'gym_rigae' }), B('23:30', '23:45', 'travel', 'Drive home', { from: 'gym', to: 'home' }), B('00:30', '00:30', 'sleep', 'Lights out', { loc: 'home' })] };
// Tuesday 6 Oct: CE 400 10:00, CE 400 Lab 11:00, CE 462 12:30–14:10, MA 265 17:00–18:15
const TUESDAY = { summary: 'Three classes, Push after MA 265.', blocks: [
  B('05:00', '05:00', 'wake', 'Wake up', { loc: 'home' }), B('05:05', '05:20', 'cook', 'Make breakfast', { loc: 'home', makes: [{ meal: 'breakfast' }] }), B('05:20', '05:40', 'meal', 'Breakfast', { meal: 'breakfast', loc: 'home' }), B('09:20', '09:50', 'travel', 'Drive to uni', { from: 'home', to: 'uni' }),
  B('10:00', '10:50', 'class', 'CE 400 Lecture', { loc: 'uni' }), B('11:00', '11:50', 'class', 'CE 400 Lab', { loc: 'uni' }), B('12:30', '14:10', 'class', 'CE 462 Lecture', { loc: 'uni' }),
  B('17:00', '18:15', 'class', 'MA 265 Lecture', { loc: 'uni' }), B('18:15', '18:30', 'travel', 'Drive to Oxygen Rigae', { from: 'uni', to: 'gym_rigae' }), B('18:30', '19:50', 'gym', 'Push', { loc: 'gym_rigae' }),
  B('19:50', '20:00', 'travel', 'Drive home', { from: 'gym', to: 'home' }), B('21:00', '21:00', 'sleep', 'Lights out', { loc: 'home' })] };

let askScript: any = null, planScript: any = () => MONDAY;
const claudeCalls: any[] = [], pushes: string[] = [];
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('router.project-osrm.org')) return Response.json({ code: 'Ok', durations: [[0, 1080, 480], [1080, 0, 840], [480, 840, 0]] });
  if (url.startsWith('https://push.example/')) { pushes.push(String(init.headers.Authorization).slice(0, 10)); return new Response(null, { status: 201 }); }
  if (url.startsWith('https://maps.app.goo.gl/')) return new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/place/American+University+of+the+Middle+East/@29.30,48.08,17z/data=!3d29.2987!4d48.0853' } });
  if (url.includes('api.anthropic.com')) {
    const body = JSON.parse(init.body); claudeCalls.push(body);
    const s = body.system as string;
    const input = s.includes('You plan ONE day') ? planScript(body) : s.includes('He is talking to you') ? askScript(body)
      : s.includes('Something got in the way') ? { situation: 'Tight evening.', pick: 1, why: 'No cooking.', options: [
          { title: 'Same dinner, faster', kind: 'faster', how: 'Microwave the sweet potato.', minutes: 15, meal: 'dinner' },
          { title: 'No-cook protein bowl', kind: 'swap', how: 'Yogurt, whey, banana.', minutes: 5, meal: 'dinner', foods: [{ food: 'greek_yogurt', grams: 300 }, { food: 'whey', grams: 30 }, { food: 'banana', grams: 120 }] }] }
      : s.includes('Analyse ONE') ? { status: 'watch', headline: 'Set 2 heavier than Set 1 on lat pulldown.', going: ['5 sessions'], changes: [{ what: 'Lat pulldown Set 1', from: '40 kg', to: '45 kg', why: '10 reps hit the top of 6–10' }] }
      : { headline: 'A thin week of data.', sections: [{ area: 'ppl', title: 'PPL Coach', points: ['x'] }], changes: [{ app: 'Uni Planner', what: 'Confirm the CE 462 quiz date', why: 'y' }] };
    return Response.json({ content: [{ type: 'tool_use', id: 'tu' + claudeCalls.length, name: 'answer', input }], usage: { input_tokens: 1, output_tokens: 1 } });
  }
  throw new Error('unexpected fetch ' + url);
};
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'test' })) Deno.env.set(k, v);
let handler: (r: Request) => Promise<Response> = null as any;
(Deno as any).serve = (h: any) => { handler = h; return {}; };
await import('../supabase/functions/jarvis/index.ts');
const call = async (body: any, headers: any = { Authorization: 'Bearer good-token' }) => (await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))).json();
const plan = (d: string) => DB.day_plans.find((p: any) => p.date === d)?.plan;
const settle = () => new Promise(r => setTimeout(r, 50));

console.log('1 · Claude plans today');
let r = await call({ action: 'plan', date: '2026-10-05' });
ok(r.plan && r.plan.blocks.length === MONDAY.blocks.length && DB.day_plans[0].source === 'ai', 'plan saved');
ok(/Gym at 6pm if possible/.test(claudeCalls[0].messages[0].content) && claudeCalls[0].tools[0].input_schema.properties.blocks, 'Claude gets his rules and the plan shape');

console.log('2 · "gym at 10pm tonight"');
setLocal('11:40');
askScript = () => ({ reply: 'Done — gym at 10pm tonight, just for today.', remember: [{ kind: 'day', date: '2026-10-05', text: 'Not sleeping at 9pm today — gym at 10pm', mustKeep: { gymAt: '22:00' } }], replan: '2026-10-05' });
planScript = () => LATE;
r = await call({ action: 'ask', date: '2026-10-05', message: "I don't want to sleep at 9pm today, I'm going to the gym at 10pm", coords: { lat: 29.0862, lng: 48.1301 } });
ok(r.memory[0].kind === 'day' && DB.jarvis_memory.some((m: any) => m.kind === 'day' && m.overrides.gymAt === '22:00'), 'remembered for today');
ok(r.plan && r.plan.blocks.find((b: any) => b.type === 'gym').start === '22:00' && plan('2026-10-05').blocks[0].type === 'wake', 'today rebuilt from now, morning kept');
ok(DB.jarvis_messages.map((m: any) => m.role).join() === 'user,jarvis', 'conversation saved');

console.log('3 · analysis and report');
r = await call({ action: 'review' });
ok(r.ppl.status === 'watch' && DB.jarvis_reviews.length === 3, 'three app reviews saved');
r = await call({ action: 'report' });
ok(r.report.changes.length === 1 && DB.jarvis_messages.some((m: any) => m.kind === 'report'), 'weekly report saved and posted');
r = await call({ action: 'ahead' });
ok(r.days.length === 7 && r.days[0].changes.length === 1, 'week ahead, with today\'s change');

console.log('3b · the kitchen, problems and his pick');
r = await call({ action: 'pantry', changes: [{ food: 'eggs', status: 'out' }] });
ok(r.pantry[0].food === 'eggs' && DB.day_settings[0].prefs.pantry[0].food === 'eggs', 'out of eggs, saved in Jarvis\'s settings');
r = await call({ action: 'kitchen' });
ok(r.outOf[0].name === 'Eggs' && Array.isArray(r.cookTimes), 'the kitchen and what Jarvis has learned');
const di = plan('2026-10-05').blocks.findIndex((b: any) => b.title === 'Dinner');
r = await call({ action: 'solve', date: '2026-10-05', i: di, problem: 'No time to cook dinner', nowMin: 700, coords: { lat: 29.0862, lng: 48.1301 } });
ok(r.options.length === 2 && r.options[1].food.kcal > 0 && /as edited/.test(r.options[1].food.log) && plan('2026-10-05').problems.length === 1, 'options with computed macros, kept with the day');
r = await call({ action: 'choose', date: '2026-10-05', id: r.id, option: 1, nowMin: 700, coords: { lat: 29.0862, lng: 48.1301 } });
ok(r.plan.blocks.find((b: any) => b.title === 'Dinner').instead.fromHisChoice && plan('2026-10-05').swaps[0].meal === 'dinner', 'his pick re-plans the day and is saved');
r = await call({ action: 'pantry', changes: [{ food: 'eggs', status: 'have' }] });
ok(r.pantry.length === 0, 'eggs back');

console.log('3c · the big goals and marks');
r = await call({ action: 'goals' });
ok(r.bigGoals.length === 2 && r.bigGoals[0].habits.length === 3 && r.bigGoals[1].habits.length === 3 && /12%/.test(r.bigGoals[0].target || r.bigGoals[0].progress.target) && !r.bigGoals[0].progress.appVsGoal, 'two big goals, three habits each, and his 12% goal matches Nutrition Coach');
const mk = r.markable[0];
r = await call({ action: 'mark', ref: mk.ref, score: 12, outOf: 15 });
ok(r.score === 12 && DB.jarvis_marks.length === 1 && DB.jarvis_marks[0].user_id === UID, 'a mark is saved to his own table');
r = await call({ action: 'goals' });
ok(r.bigGoals[1].progress.marksRecorded === 1, 'and shows up in his grades progress');

console.log('4 · evening: Jarvis plans tomorrow and says when to get up');
setLocal('23:05', '2026-10-05');   // lights out moved to 12:30am, so tomorrow is planned 90 min before: 11pm
planScript = () => TUESDAY;
const before4 = pushes.length;
r = await call({}, { 'x-cron-secret': 'cron-s3cret' });
for (let k = 0; k < 60 && !(plan('2026-10-06') && pushes.length > before4); k++) await settle();   // tomorrow is planned in the background
ok(plan('2026-10-06') && DB.jarvis_sent.some((s: any) => s.key === 'tplan:2026-10-06'), "tomorrow's plan made in the evening");
ok(pushes.length > before4 && pushes.at(-1) === 'vapid t=ey', 'notification sent, signed with the VAPID key');
r = await call({}, { 'x-cron-secret': 'wrong' });
ok(r.error === 'Bad cron secret.', 'cron needs the secret');

console.log('5 · links and safety');
r = await call({ action: 'resolve-link', url: 'https://maps.app.goo.gl/abc' });
ok(r.lat === 29.2987 && /American University/.test(r.label), 'Google Maps short link → the pin');
r = await call({ action: 'plan' }, { Authorization: 'Bearer bad' });
ok(r.error === 'Sign in first.', 'no token, no access');
ok(JSON.stringify(['planner_classes', 'planner_events', 'planner_settings', 'ppl_records', 'nutrition_records'].map(t => DB[t])) === before, 'his three apps were only read');
console.log('\nfunction test passed');
