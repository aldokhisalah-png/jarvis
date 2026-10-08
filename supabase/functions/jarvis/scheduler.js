// =====================================================================
// JARVIS SCHEDULER — Salah's rules, as code. No AI in here.
//
// Builds each day from his three apps and the rules he gave (8 Oct 2026):
//   • Classes are fixed. Leave from wherever he is to be at uni 10 min before (that covers parking).
//   • Quiz / assignment / pre-lab / homework: 30 min on the day it opens (no "opens" date → 48 h before the deadline).
//   • Graded lab: 30 min revision the day before.   • GCA: 2 h study 2 days before.
//   • Exams: 3 h a day (total) from 14 days before exam week, 4 h a day from 7 days before, through exam week.
//   • Gym every day unless he says no. Branch = shortest trip from where he is to where he goes next
//     (ties → Rigae, his favourite). Never Sabah Al-Salem 5–9am or 11am–3pm.
//     Crowds: 10pm–4am quiet (best) · 4am–4pm fine · 9–10pm busy · 4–9pm packed.
//     Uni → gym: bring headphones.  Gym → uni: bring a gym bag, shower at the gym (15 min).
//   • Groceries every Saturday. Meals from Nutrition Coach. The maid cooks 7am–9pm; outside that he cooks.
//     No fridge: a cooler in the car, microwaves at every gym and the gas station near uni.
//   • 1.5 h on the walking pad at home, spread out, while eating / studying / relaxing at the desk.
//   • Sleep: no set time, 8 h preferred, never under 6 h. When time is short: uni → gym → food → sleep.
// Times are minutes after the day's local midnight; a night can run past 1440 (00:30 = 1470).
// =====================================================================

export const RULES = {
  classEarly: 10,          // at uni this many minutes before class (includes parking)
  taskMin: 30,             // quiz / assignment / pre-lab / homework
  openFallbackH: 48,       // no "opens" date in Uni Planner → assume it opened this long before the deadline
  labReviewMin: 30,        // revision the day before a graded lab
  gcaStudyMin: 120, gcaDaysBefore: 2,
  examStartDays: 14, examDailyMin: 180, examFinalWeekMin: 240,
  studyChunkMax: 120,      // longest single study block (his questionnaire answer)
  sleepPrefer: 480, sleepMin: 360,
  walkMin: 90,             // walking pad, per day
  maidFrom: 420, maidTo: 1260,
  groceryDow: 6, groceryMin: 45, groceryDrive: 10,   // Saturday, co-op near home (10 min drive)
  showerMin: 15,           // at the gym, when going gym → uni
  readyMin: 20, eatMin: 20, cookSelfMin: 15,          // questionnaire answers
  lunchAt: 780, dinnerAt: 1140,                       // 1pm, 7pm (questionnaire answers)
  examMinutes: 120,        // an exam with no end time in Uni Planner
  defaultBed: 1380         // first night with nothing to go by: 11pm
};

// ---------------------------------------------------------------- time
const pad = n => String(n).padStart(2, '0');
export const mod = m => ((Math.round(m) % 1440) + 1440) % 1440;
export const hhmm = m => `${pad(Math.floor(mod(m) / 60))}:${pad(mod(m) % 60)}`;
export const t12 = m => { const d = mod(m), h = Math.floor(d / 60), mm = d % 60; return `${h % 12 || 12}${mm ? ':' + pad(mm) : ''}${h < 12 ? 'am' : 'pm'}`; };
export const toMin = s => { if (s == null || s === '') return null; if (typeof s === 'number') return s; const m = String(s).match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
export const dowOf = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dlong = d => `${DAYS[dowOf(d)].slice(0, 3)} ${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;
export const TZ = 180;   // Kuwait, UTC+3, no daylight saving
export function localOf(ts, tz = TZ) { const d = new Date(Date.parse(ts) + tz * 60000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
const abs = (date, min, base) => dayDiff(base, date) * 1440 + min;   // minutes since `base` midnight

// ---------------------------------------------------------------- places
export const PLACES = ['home', 'grandma', 'uni', 'gym_rigae', 'gym_mahboula', 'gym_sabah'];
export const GYMS = ['gym_rigae', 'gym_mahboula', 'gym_sabah'];     // Rigae first: his favourite, wins ties
export const PLACE_NAME = { home: 'home', grandma: 'your grandmother’s', uni: 'uni', gym_rigae: 'Oxygen Rigae', gym_mahboula: 'Oxygen Mahboula', gym_sabah: 'Oxygen Sabah Al-Salem', here: 'where you are', other: 'there' };
export const isGym = k => /^gym_/.test(k || '');
const SABAH_BLOCKED = [[300, 540], [660, 900]];                       // 5–9am, 11am–3pm
/** Gym crowd tier for a time: 0 quiet (10pm–4am) · 1 fine (4am–4pm) · 2 busy (9–10pm) · 3 packed (4–9pm). */
export const crowdTier = m => { const d = mod(m); return d >= 1320 || d < 240 ? 0 : d < 960 ? 1 : d < 1260 ? 3 : 2; };
const CROWD_WORD = ['quiet', 'not busy', 'getting busy', 'packed'];
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
function sabahOk(s, e) {
  for (let off = -1440; off <= 1440; off += 1440) for (const [a, b] of SABAH_BLOCKED) if (overlaps(s, e, a + off, b + off)) return false;
  return true;
}
const interp = (pts, t) => {
  t = mod(t);
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (t - a) / (b - a); }
  return pts[pts.length - 1][1];
};
/** Drive minutes a→b leaving at t. profile: Google's predicted times by hour ('a>b'); freeFlow: empty-road ('a-b', sorted). */
export function makeDrive({ profile = null, freeFlow = {}, other = 20 } = {}) {
  return (a, b, t) => {
    if (a === b) return 0;
    if (a === 'other' || b === 'other') return other;
    const pts = profile && profile[`${a}>${b}`];
    if (pts && pts.length) return Math.ceil(interp(pts, t == null ? 720 : t));
    const r = freeFlow[[a, b].sort().join('-')];
    return r == null ? null : Math.ceil(r);
  };
}

// ---------------------------------------------------------------- PPL Coach (copied from its code)
const CATS = { compound: { between: 180, after: 210 }, moderate: { between: 120, after: 150 }, isolation: { between: 90, after: 90 } };
const ex = (id, name, cat, sets) => ({ id, name, cat, sets });
const PROGRAM = {
  push: [ex('incline-db-press', 'Incline Dumbbell Press', 'compound', 4), ex('flat-machine-press', 'Flat Machine Chest Press', 'moderate', 3), ex('cable-chest-fly', 'Cable Chest Fly', 'moderate', 3), ex('machine-shoulder-press', 'Machine Shoulder Press', 'moderate', 3), ex('cable-lateral-raise', 'Cable Lateral Raise', 'isolation', 4), ex('oh-cable-tri-ext', 'Overhead Cable Triceps Extension', 'isolation', 3), ex('seated-cable-pushdown', 'Seated Cable Triceps Pushdown', 'isolation', 3)],
  pull: [ex('lat-pulldown', 'Lat Pulldown', 'compound', 4), ex('chest-supported-row', 'Chest-Supported Row', 'compound', 4), ex('sa-cable-pulldown', 'Single-Arm Cable Pulldown', 'isolation', 3), ex('sa-rear-delt-fly', 'Single-Arm Cable Rear-Delt Fly', 'isolation', 4), ex('btb-cable-curl', 'Behind-the-Back Cable Curl', 'isolation', 3), ex('cable-hammer-curl', 'Cable Hammer Curl', 'isolation', 3)],
  legs: [ex('hack-squat', 'Hack Squat', 'compound', 4), ex('rdl', 'Romanian Deadlift', 'compound', 4), ex('leg-press', 'Leg Press', 'compound', 3), ex('leg-extension', 'Leg Extension', 'isolation', 3), ex('seated-leg-curl', 'Seated Leg Curl', 'isolation', 4), ex('standing-calf-raise', 'Standing Calf Raise', 'isolation', 4), ex('abs', 'Abs', 'isolation', 3)]
};
const ROTATION = ['push', 'pull', 'legs', 'rest'];
const WORKOUT_NAME = { push: 'Push', pull: 'Pull', legs: 'Legs' };
const nextDay = last => !last ? 'push' : ROTATION[(ROTATION.indexOf(last) + 1) % ROTATION.length];
const trainThrough = w => w === 'rest' ? 'push' : w;     // he trains every day: at the Rest step he picks Push and carries on
/** PPL Coach's own "~N minutes" for a workout (home screen estimate, rounded to 5). */
export function workoutMinutes(day) {
  const list = PROGRAM[day] || [];
  const secs = list.reduce((n, e) => { const c = CATS[e.cat]; return n + e.sets * 45 + (e.sets - 1) * c.between + c.after + 60; }, 0);
  return Math.round(secs / 300) * 5;
}
/** The workout for `date`: PPL Coach's rotation from his last session, skipping his rest days. */
export function workoutFor(date, today, ppl = {}) {
  const rest = new Set(ppl.restDays || []);
  if (ppl.lastSessionDate === date && ppl.lastSessionDay) return { workout: ppl.lastSessionDay, done: true };
  let last = ppl.lastCompleted;
  const from = ppl.lastSessionDate === today ? addDays(today, 1) : today;
  for (let d = from, i = 0; d < date && i < 60; d = addDays(d, 1), i++) if (!rest.has(d)) last = trainThrough(nextDay(last));
  return { workout: trainThrough(last ? nextDay(last) : 'push') };
}
/** What PPL Coach says, from its rows in Supabase. */
export function pplFromRows(rows = []) {
  const kv = k => { const r = rows.find(x => x.kind === 'kv' && x.key === k); return r && r.body ? r.body.v : null; };
  const sessions = rows.filter(r => r.kind === 'session' && r.body && r.body.date).map(r => r.body).sort((a, b) => a.date < b.date ? -1 : 1);
  const last = sessions[sessions.length - 1];
  const meta = kv('meta') || {};
  return { lastCompleted: meta.lastCompleted || (last && last.day) || null, restDays: kv('restDays') || [],
    lastSessionDate: last ? localOf(last.date).date : null, lastSessionDay: last ? last.day : null,
    sessionDates: sessions.map(s => localOf(s.date).date) };
}

// ---------------------------------------------------------------- Nutrition Coach (its foods, plan and day types)
export const FOODS = {   // per 100 g as in Nutrition Coach: [name, kcal, protein, carbs, fat]
  eggs: ['Eggs', 143, 12.56, 0.72, 9.51], greek_yogurt: ['Greek yogurt', 59, 10.19, 3.6, 0.39], blueberries: ['Blueberries', 57, 0.74, 14.49, 0.33],
  banana: ['Banana', 89, 1.09, 22.84, 0.33], chicken_breast: ['Chicken breast', 165, 31.02, 0, 3.57], rice: ['Rice', 130, 2.69, 28.17, 0.28],
  broccoli: ['Broccoli', 35, 2.38, 7.18, 0.41], spinach: ['Spinach', 23, 2.86, 3.63, 0.39], olive_oil: ['Olive oil', 884, 0, 0, 100],
  salmon: ['Salmon', 206, 22.1, 0, 12.35], lean_beef: ['Lean beef', 162, 30.09, 0, 3.77], liver: ['Beef liver', 191, 29.08, 5.13, 5.26],
  sweet_potato: ['Sweet potato', 90, 2.01, 20.71, 0.15], cucumber: ['Cucumber', 15, 0.65, 3.63, 0.11], red_pepper: ['Red pepper', 26, 0.99, 6.03, 0.3],
  milk: ['Milk', 50, 3.3, 4.8, 1.98], whey: ['Whey', 352, 78.13, 6.25, 1.56], strawberries: ['Strawberries', 32, 0.67, 7.68, 0.3], walnuts: ['Walnuts', 654, 15.23, 13.71, 65.21]
};
const BASE_MEALS = [
  { key: 'breakfast', name: 'Breakfast', items: [['eggs', 150], ['greek_yogurt', 150], ['blueberries', 100], ['banana', 120]] },
  { key: 'lunch', name: 'Lunch', items: [['chicken_breast', 150], ['rice', 150], ['broccoli', 150], ['spinach', 100], ['olive_oil', 10]] },
  { key: 'preworkout', name: 'Pre-workout', items: [['greek_yogurt', 150], ['banana', 120]] },
  { key: 'dinner', name: 'Dinner', items: [['DINNER', 120], ['sweet_potato', 190], ['cucumber', 100], ['red_pepper', 100]] },
  { key: 'evening', name: 'Evening shake', items: [['milk', 254], ['whey', 25], ['strawberries', 150], ['walnuts', 15]] }
];
const DINNER_WEEK = { 0: 'salmon', 1: 'salmon', 2: 'beef', 3: 'salmon', 4: 'beef', 5: 'salmon', 6: 'beef_liver' };
const SUPPLEMENTS = { breakfast: ['Creatine 5 g', 'Vitamin D3 25 µg', 'Omega-3 1000 mg'], preworkout: ['Pre-workout (200 mg caffeine)'], evening: ['Magnesium 200 mg', 'Ashwagandha 300 mg'] };
function baseDay(type) {
  return BASE_MEALS.map(m => ({ key: m.key, name: m.name, items: m.items.flatMap(([k, g]) => k !== 'DINNER' ? [{ food: k, grams: g }]
    : type === 'salmon' ? [{ food: 'salmon', grams: g }] : type === 'beef' ? [{ food: 'lean_beef', grams: g }] : [{ food: 'lean_beef', grams: g - 25 }, { food: 'liver', grams: 25 }]) }));
}
export function mealsFor(date, planVersion) {
  const type = DINNER_WEEK[dowOf(date)];
  const day = (planVersion && planVersion.days && planVersion.days[type] && planVersion.days[type].day) || baseDay(type);
  return day.map(m => ({ key: m.key, name: m.key === 'evening' ? 'Evening shake' : m.name, items: (m.items || []).filter(it => it.custom || FOODS[it.food]), supplements: SUPPLEMENTS[m.key] || [] }));
}
export function nutritionFromRows(rows = []) {
  const pvs = rows.filter(r => r.kind === 'plan_version' && r.body).sort((a, b) => String(a.id) < String(b.id) ? -1 : 1);
  const num = r => +(String(r.id).split(':')[1] || 0);
  pvs.sort((a, b) => num(a) - num(b));
  return { planVersion: pvs.length ? pvs[pvs.length - 1].body : null };
}

// ---------- cooking: how to make each food, and how much raw to start with ----------
// Raw → cooked yields as Nutrition Coach's grocery list uses them. Grams in the plan are what goes on the plate.
const RAW = { chicken_breast: 0.75, salmon: 0.8, lean_beef: 0.75, liver: 0.8, sweet_potato: 0.85 };
const HOW = {
  eggs: g => `Eggs: ${Math.round(g / 50)} large eggs (about ${g} g), scrambled or boiled, no added butter or oil.`,
  chicken_breast: g => `Chicken breast: ${Math.round(g / RAW.chicken_breast / 5) * 5} g raw → ${g} g cooked. Season with salt, pepper and spices, then grill or cook in a non-stick pan without oil, 6–7 min each side until cooked through.`,
  rice: g => `Rice: ${Math.round(g / 2.9)} g dry rice (cooks to about ${g} g). Rinse, then simmer covered in ${Math.round(g / 2.9 * 2)} ml water for 15 min, no oil or butter.`,
  broccoli: g => `Broccoli: ${g} g, steamed 5 min.`,
  spinach: g => `Spinach: ${g} g, wilted in the pan with the olive oil.`,
  olive_oil: g => `Olive oil: ${g} g (about ${Math.round(g / 4.5)} tsp), weighed, used for the spinach. No other oil.`,
  salmon: g => `Salmon: ${Math.round(g / RAW.salmon / 5) * 5} g raw fillet → ${g} g cooked. Salt and pepper, bake at 200 °C for 12–15 min, no oil.`,
  lean_beef: g => `Lean beef: ${Math.round(g / RAW.lean_beef / 5) * 5} g raw → ${g} g cooked. Salt and pepper, cook in a non-stick pan without oil until browned.`,
  liver: g => `Beef liver: ${Math.round(g / RAW.liver / 5) * 5} g raw → ${g} g cooked. Pan-cook 2–3 min each side, no oil.`,
  sweet_potato: g => `Sweet potato: ${Math.round(g / RAW.sweet_potato / 5) * 5} g raw with skin → ${g} g cooked. Bake at 200 °C for 40–45 min, or boil 20 min.`,
  cucumber: g => `Cucumber: ${g} g, sliced raw.`,
  red_pepper: g => `Red pepper: ${g} g, sliced raw.`
};
const NEEDS_COOKING = new Set(['eggs', 'chicken_breast', 'rice', 'broccoli', 'spinach', 'salmon', 'lean_beef', 'liver', 'sweet_potato']);
export const needsCooking = meal => (meal.items || []).some(it => !it.custom && NEEDS_COOKING.has(it.food));
export const recipeLines = meal => (meal.items || []).filter(it => !it.custom && HOW[it.food]).map(it => HOW[it.food](Math.round(it.grams)));
export const itemsText = meal => (meal.items || []).map(it => it.custom ? it.name : `${FOODS[it.food][0].toLowerCase()} ${Math.round(it.grams)} g`).join(', ');

// ---------------------------------------------------------------- Uni Planner → what he has to do
const TASK_KINDS = ['quiz', 'assignment', 'prelab', 'hw'];
const KIND_WORD = { quiz: 'Quiz', assignment: 'Assignment', prelab: 'Pre-lab', hw: 'Homework', lab: 'Graded lab', gca: 'GCA', exam: 'Exam' };
/** Exam weeks from Uni Planner's academic entries ("Midterm exams week (7–14 Nov)", "Final exams (16–24 Jan)"). */
export function examWeeks(events = []) {
  const out = [];
  for (const e of events) {
    if (e.kind !== 'academic' || !/exam/i.test(e.title || '')) continue;
    const start = localOf(e.due_at).date;
    const m = (e.title || '').match(/(\d{1,2})\s*[–-]\s*(\d{1,2})\s*([A-Za-z]{3})/);
    let end = start;
    if (m) { const mi = MON.findIndex(x => x.toLowerCase() === m[3].toLowerCase()); if (mi >= 0) { let y = +start.slice(0, 4); if (mi + 1 < +start.slice(5, 7)) y++; end = `${y}-${pad(mi + 1)}-${pad(+m[2])}`; } }
    const exams = events.filter(x => x.kind === 'exam').map(x => localOf(x.due_at).date).filter(d => d >= start && d <= addDays(end, 3));
    if (exams.length) end = exams.sort().pop();
    out.push({ title: e.title.replace(/\s*\(.*\)$/, ''), start, end });
  }
  return out;
}
/** Every piece of uni work with the day(s) it may go on. */
export function uniWork(events = [], rules = RULES) {
  const work = [];
  for (const e of events) {
    if (e.done) continue;
    const due = localOf(e.due_at), name = `${e.course} ${e.title}`;
    if (TASK_KINDS.includes(e.kind)) {
      // opens: an "… opens" entry in the same course shortly before, else 48 h before the deadline
      const opener = events.filter(x => x.course === e.course && x.kind === 'info' && /open/i.test(x.title || '') && x.due_at <= e.due_at && Date.parse(e.due_at) - Date.parse(x.due_at) < 21 * 864e5)
        .sort((a, b) => a.due_at < b.due_at ? 1 : -1)[0];
      const open = opener ? localOf(opener.due_at) : localOf(new Date(Date.parse(e.due_at) - rules.openFallbackH * 3600e3).toISOString());
      work.push({ ref: `ev:${e.id}`, kind: e.kind, title: `${name}`, what: `${KIND_WORD[e.kind]} — do it`, minutes: rules.taskMin, from: open, until: due, opensGuessed: !opener });
    } else if (e.kind === 'lab') {
      const d = addDays(due.date, -1);
      work.push({ ref: `lab:${e.id}`, kind: 'labrev', title: `Revise for ${name}`, what: 'Graded lab tomorrow', minutes: rules.labReviewMin, day: d });
    } else if (e.kind === 'gca') {
      const d = addDays(due.date, -rules.gcaDaysBefore);
      work.push({ ref: `gca:${e.id}`, kind: 'gca', title: `Study for ${name}`, what: `GCA on ${dlong(due.date)}`, minutes: rules.gcaStudyMin, day: d, split: true });
    }
  }
  return work;
}
export function examStudyFor(date, weeks, rules = RULES) {
  let mins = 0, which = null;
  for (const w of weeks) {
    const before = dayDiff(date, w.start);
    if (date > w.end || before > rules.examStartDays) continue;
    const m = before <= 7 ? rules.examFinalWeekMin : rules.examDailyMin;
    if (m > mins) { mins = m; which = w; }
  }
  return mins ? { minutes: mins, title: `Study for ${which.title.toLowerCase()}`, week: which } : null;
}
export function examsOn(date, events = [], rules = RULES) {
  return events.filter(e => e.kind === 'exam' && !e.all_day && localOf(e.due_at).date === date)
    .map(e => { const s = localOf(e.due_at).min; return { start: s, end: s + rules.examMinutes, title: `${e.course} ${e.title}`, loc: 'uni', type: 'exam' }; });
}

// =====================================================================
// THE DAY
// =====================================================================
/** The route through the day: fixed visits in order, with drives between and where he waits. */
function route(visits, startLoc, startMin, drive, ctx) {
  const items = [], problems = [];
  let loc = startLoc, t = startMin;
  const fail = p => { problems.push(p); return { items, problems, ok: false }; };
  for (const v of visits) {
    const early = v.loc === 'uni' && v.type !== 'busy' && v.type !== 'gym' && !v.ongoing ? ctx.rules.classEarly : 0;
    const arriveBy = v.start - early;
    // a long gap: go home (≥ 90 min there) or to grandma's (gap ≥ 2 h, ≥ 1 h there, a uni break) in between
    let via = null;
    for (const mid of ['home', 'grandma']) {
      if (mid === loc || mid === v.loc || !ctx.known.has(mid) || isGym(loc) && v.loc === 'uni' && false) continue;
      if (mid === 'grandma' && !(loc === 'uni' || v.loc === 'uni')) continue;
      const a = drive(loc, mid, t), b = drive(mid, v.loc, arriveBy);
      if (a == null || b == null) continue;
      const there = arriveBy - b - (t + a);
      if (mid === 'home' ? there >= 90 : there >= 60 && arriveBy - t >= 120) { via = { mid, a, b }; break; }
    }
    if (via) {
      items.push({ kind: 'drive', from: loc, to: via.mid, start: t, end: t + via.a });
      items.push({ kind: 'stay', loc: via.mid, start: t + via.a, end: arriveBy - via.b });
      items.push({ kind: 'drive', from: via.mid, to: v.loc, start: arriveBy - via.b, end: arriveBy, forVisit: v });
      if (v.start > arriveBy) items.push({ kind: 'stay', loc: v.loc, start: arriveBy, end: v.start, buffer: true });
    } else if (loc === v.loc) {
      if (v.start < t) return fail({ visit: v, late: t - v.start });
      if (v.start > t) items.push({ kind: 'stay', loc, start: t, end: v.start });
    } else {
      const d = drive(loc, v.loc, arriveBy);
      if (d == null) return fail({ visit: v, why: `no drive time from ${PLACE_NAME[loc]} to ${PLACE_NAME[v.loc]}` });
      if (isGym(loc)) {                                       // after the gym: go straight on and wait there
        if (t + d > arriveBy) return fail({ visit: v, late: t + d - arriveBy });
        items.push({ kind: 'drive', from: loc, to: v.loc, start: t, end: t + d, forVisit: v });
        if (v.start > t + d) items.push({ kind: 'stay', loc: v.loc, start: t + d, end: v.start, buffer: v.start - (t + d) <= early });
      } else {                                                // wait here, leave just in time
        const leave = arriveBy - d;
        if (leave < t) return fail({ visit: v, late: t - leave });
        if (leave > t) items.push({ kind: 'stay', loc, start: t, end: leave });
        items.push({ kind: 'drive', from: loc, to: v.loc, start: leave, end: arriveBy, forVisit: v });
        if (v.start > arriveBy) items.push({ kind: 'stay', loc: v.loc, start: arriveBy, end: v.start, buffer: true });
      }
    }
    items.push({ kind: 'visit', ...v });
    loc = v.loc; t = v.end;
  }
  if (loc !== 'home') {                                       // home for the night
    const d = drive(loc, 'home', t);
    if (d == null) return fail({ why: `no drive time from ${PLACE_NAME[loc]} home` });
    items.push({ kind: 'drive', from: loc, to: 'home', start: t, end: t + d });
    t += d;
  }
  return { items, problems, ok: true, homeAt: t };
}

const lexLess = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
/** Where the day's gym session goes. Tries every start time and branch, keeps the best by: sleep ≥ 8 h, then crowd, then drive. */
function chooseGym(base, ctx) {
  const { drive, rules } = ctx;
  const W = ctx.workout.minutes;
  const hardBed = ctx.wakeNextAbs != null ? ctx.wakeNextAbs - rules.sleepMin : Math.min(base.startMin + 1440, 1440 + 300);
  let best = null;
  const want = ctx.change.gymAt != null ? toMin(ctx.change.gymAt) : null;
  const gyms = ctx.change.gymPlace && GYMS.includes(ctx.change.gymPlace) ? [ctx.change.gymPlace] : GYMS.filter(g => ctx.known.has(g));
  for (let s = Math.ceil((base.startMin + 10) / 15) * 15; s < hardBed - W; s += 15) {
    if (want != null && Math.abs(mod(s) - want) > 20 && Math.abs(mod(s) - want) < 1420) continue;
    // where he is right before and where he goes right after
    const prev = [...ctx.visits].reverse().find(v => v.end <= s), next = ctx.visits.find(v => v.start >= s);
    if (ctx.visits.some(v => overlaps(v.start, v.end, s, s + W))) continue;
    const prevLoc = prev ? prev.loc : ctx.startLoc, nextLoc = next ? next.loc : 'home';
    const shower = nextLoc === 'uni' ? rules.showerMin : 0;
    for (const g of gyms) {
      if (g === 'gym_sabah' && !sabahOk(s, s + W)) continue;
      const a = drive(prevLoc, g, s), b = drive(g, nextLoc, s + W);
      if (a == null || b == null) continue;
      const gv = { loc: g, start: s, end: s + W + shower, type: 'gym', shower: !!shower };
      const visits = [...ctx.visits, gv].sort((x, y) => x.start - y.start);
      const r = route(visits, ctx.startLoc, ctx.startMin, drive, ctx);
      if (!r.ok) continue;
      const firstLeave = ctx.morning ? (r.items.find(i => i.kind === 'drive' && i.from === ctx.startLoc) || {}).start : null;
      const wake = ctx.morning && firstLeave != null ? Math.min(ctx.latestWake, ctx.wakeBefore(firstLeave)) : ctx.latestWake;
      // only the sleep the gym itself takes away counts
      const sleepBefore = ctx.morning && ctx.prevBedAbs != null && wake < ctx.latestWake ? wake - ctx.prevBedAbs : 999;
      const bedNeed = r.homeAt + rules.eatMin;
      const sleepAfter = ctx.wakeNextAbs != null && bedNeed > ctx.baseBedNeed ? ctx.wakeNextAbs - Math.max(bedNeed, ctx.bedPrefAbs) : 999;
      const sleep = Math.min(sleepBefore, sleepAfter);
      if (sleep < rules.sleepMin) continue;
      const tier = Math.max(crowdTier(s), crowdTier(s + W - 1));
      // branch: shortest trip from where he really comes from to where he really goes next (Rigae wins ties)
      const gin = r.items.find(i => i.kind === 'drive' && i.forVisit === gv), gout = r.items.find(i => i.kind === 'drive' && i.from === g && i.start >= gv.end);
      const trip = (gin ? drive(gin.from, g, 720) : a) + (gout ? drive(g, gout.to, 720) : b) - (g === 'gym_rigae' ? 3 : 0);
      // free time left for everything else must still cover uni work + meals
      const free = r.items.filter(i => i.kind === 'stay' && !i.buffer && !isGym(i.loc)).reduce((n, i) => n + i.end - i.start, 0) + Math.max(0, hardBed - r.homeAt);
      if (free < ctx.needFree) continue;
      const score = [sleep >= rules.sleepPrefer ? 0 : 1, tier, trip, s];
      if (!best || lexLess(score, best.score))
        best = { score, visit: gv, route: r, tier, gym: g, prevLoc: gin ? gin.from : prevLoc, nextLoc: gout ? gout.to : nextLoc, sleep };
    }
  }
  return best;
}

/**
 * Plan one day.
 * input: { date, today, classes, events, ppl, nutrition, places (known keys), drive, rules, change, start?: {min, loc},
 *          prevBedAbs? (last night's bed, minutes from this day's midnight, e.g. -60 = 11pm), wakeNextAbs?, carry: [work not done yet], doneRefs: Set }
 */
export function planDay(input) {
  const rules = { ...RULES, ...(input.rules || {}) };
  const { date, drive } = input;
  const change = input.change || {};
  const known = new Set(input.known || PLACES);
  const notes = [], warnings = [];
  const dow = dowOf(date);

  // ---- fixed visits: classes (unless cancelled), exams, things he told Jarvis about
  const cancelled = change.cancelClasses === true ? null : new Set(change.cancelClasses || []);
  const classes = (input.classes || []).filter(c => +c.weekday === dow && !(cancelled === null || cancelled.has(c.course)))
    .map(c => ({ start: toMin(c.start_time), end: toMin(c.end_time), loc: 'uni', type: 'class', title: `${c.course} ${c.kind || ''}`.trim(), room: c.room || null, course: c.course }));
  let visits = [...classes, ...examsOn(date, input.events, rules),
    ...(change.busy || []).map(b => ({ start: toMin(b.from), end: toMin(b.to), loc: known.has(b.place) ? b.place : 'other', type: 'busy', title: b.title || 'Busy' }))]
    .filter(v => v.start != null && v.end != null).sort((a, b) => a.start - b.start);

  const start = input.start || null;                       // re-planning part-way through the day
  if (start) {
    visits = visits.filter(v => v.end > start.min);
    // already in it (e.g. sitting in class): it carries on from now
    visits = visits.map(v => v.start < start.min && v.loc === start.loc ? { ...v, start: start.min, ongoing: true } : v);
  }
  const startLoc = start ? start.loc : 'home';

  // ---- wake: 8 h after last night, but no later than the first drive allows
  const morningRoutine = rules.readyMin + rules.eatMin;
  // before 7:30 the maid isn't there to make breakfast, so he cooks it himself first
  const wakeFor = leave => { const w = leave - morningRoutine; return w < rules.maidFrom + 30 ? w - rules.cookSelfMin : w; };
  let latestWake;
  if (change.wakeAt) latestWake = toMin(change.wakeAt);
  else {
    const v = visits[0], d = v ? (v.loc === 'home' ? 0 : drive('home', v.loc, v.start) ?? 30) : 0;
    const byClass = v && !start ? wakeFor(v.start - (v.loc === 'uni' && v.type !== 'busy' ? rules.classEarly : 0) - d) : Infinity;
    const rested = input.prevBedAbs != null ? input.prevBedAbs + rules.sleepPrefer : 480;
    latestWake = Math.min(byClass, rested);
  }
  const startMin = start ? start.min : latestWake;

  // ---- bed: 8 h before tomorrow's wake, not after midnight unless the day runs late; never under 6 h
  const wakeNextAbs = input.wakeNextAbs ?? null;
  const bedPrefAbs = change.bedBy ? (toMin(change.bedBy) < 720 ? toMin(change.bedBy) + 1440 : toMin(change.bedBy))
    : Math.min(wakeNextAbs != null ? wakeNextAbs - rules.sleepPrefer : Infinity, 1440);

  // ---- uni work for today
  const doneRefs = input.doneRefs || new Set();
  const work = [];
  for (const w of input.work || []) {
    if (doneRefs.has(w.ref)) continue;
    if (w.day) { if (w.day === date) work.push({ ...w }); continue; }
    if (w.from && w.from.date <= date && w.until.date >= date) work.push({ ...w, earliest: w.from.date === date ? w.from.min : 0, latest: w.until.date === date ? w.until.min : 1440 + 300 });
  }
  const exam = examStudyFor(date, input.examWeeks || [], rules);
  for (const x of change.tasks || []) work.push({ ref: `told:${date}:${x.title}`, kind: 'told', title: x.title, minutes: +x.minutes || 30, at: x.at ? toMin(x.at) : null, place: x.place || null });
  const needFree = work.reduce((n, w) => n + w.minutes, 0) + (exam ? exam.minutes : 0) + 4 * rules.eatMin;

  // ---- gym
  const pw = workoutFor(date, input.today, input.ppl);
  const noGym = change.noGym || pw.done || doneRefs.has(`gym:${date}`);
  const ctx = { rules, drive, known, change, visits, startLoc, startMin, morning: !start, latestWake, morningRoutine, prevBedAbs: input.prevBedAbs ?? null,
    wakeNextAbs, bedPrefAbs, needFree, workout: { day: pw.workout, minutes: workoutMinutes(pw.workout) } };
  ctx.wakeBefore = wakeFor;
  { const base = route(visits, startLoc, startMin, drive, ctx); ctx.baseBedNeed = base.ok ? base.homeAt + rules.eatMin : 0; }
  let gym = null;
  if (!noGym) {
    gym = chooseGym({ startMin }, ctx);
    if (!gym) warnings.push(`The gym doesn’t fit today without going under ${rules.sleepMin / 60} h of sleep or missing uni work.`);
    else visits = [...visits, gym.visit].sort((a, b) => a.start - b.start);
  } else if (pw.done) notes.push(`${WORKOUT_NAME[pw.workout] || 'Workout'} already logged in PPL Coach today.`);
  else notes.push('No gym today — you said so.');

  let r = route(visits, startLoc, startMin, drive, ctx);
  if (!r.ok) {
    // something can't be reached in time — keep what can be, and say so
    for (const p of r.problems) warnings.push(p.late != null ? `You can’t make ${p.visit.title} at ${t12(p.visit.start)} on time — about ${p.late} min short.` : `Can’t plan: ${p.why}.`);
    const reachable = [];
    for (const v of visits) { const t = route([...reachable, v], startLoc, startMin, drive, ctx); if (t.ok) reachable.push(v); }
    visits = reachable; r = route(visits, startLoc, startMin, drive, ctx);
  }

  // ---- wake (when starting fresh): the first drive minus getting ready and breakfast
  const firstDrive = r.items.find(i => i.kind === 'drive');
  let wake = start ? null : Math.min(latestWake, firstDrive && firstDrive.from === 'home' ? wakeFor(firstDrive.start) : latestWake);
  const dayStart = start ? start.min : wake;
  if (!start && r.items.length && r.items[0].kind === 'stay' && r.items[0].start > wake) r.items[0].start = wake;
  if (!start && (!r.items.length || r.items[0].start > wake)) r.items.unshift({ kind: 'stay', loc: 'home', start: wake, end: r.items.length ? r.items[0].start : wake });

  // evening at home until bed (preferred), may stretch to the 6 h limit
  const hardBedAbs = wakeNextAbs != null ? wakeNextAbs - rules.sleepMin : Math.max(bedPrefAbs, r.homeAt) + 120;
  let bedAbs = Math.max(bedPrefAbs, r.homeAt + rules.eatMin);
  if (!start && wake < r.homeAt && bedAbs - wake > 1260) bedAbs = Math.max(r.homeAt + rules.eatMin, wake + 1260);
  const evening = { kind: 'stay', loc: 'home', start: r.homeAt, end: bedAbs };
  const stays = [...r.items.filter(i => i.kind === 'stay' && !i.buffer), evening].filter(s => s.end > s.start);

  // ---- booking free time
  const booked = [];   // {start,end,loc}
  /** Free gaps inside stay `s` between a and b (everything already booked there taken out). */
  const free = (s, a, b) => {
    if (b <= a) return [];
    let x = a; const gaps = [];
    for (const k of booked.filter(k => k.stay === s && k.end > a && k.start < b).sort((p, q) => p.start - q.start)) { if (k.start > x) gaps.push([x, k.start]); x = Math.max(x, k.end); }
    if (b > x) gaps.push([x, b]);
    return gaps;
  };
  const blocks = [];
  const book = (stay, start, minutes, block) => { const b = { ...block, start, end: start + minutes, loc: stay.loc }; booked.push({ stay, start, end: b.end }); blocks.push(b); return b; };
  /** First free slot: preferred places first, then the time closest to `target` (or earliest). */
  function place(minutes, { earliest = -Infinity, latest = Infinity, prefer = ['home', 'grandma', 'uni'], target = null, anywhere = false } = {}, block) {
    const cands = [];
    for (const s of stays) {
      if (isGym(s.loc) && !anywhere) continue;
      const rank = prefer.indexOf(s.loc) < 0 ? (anywhere ? 9 : -1) : prefer.indexOf(s.loc);
      if (rank < 0) continue;
      for (const [a, b] of free(s, Math.max(s.start, earliest), Math.min(s.end, latest))) {
        if (b - a < minutes) continue;
        const st = target == null ? a : Math.min(Math.max(target, a), b - minutes);
        cands.push({ s, st, rank, dist: target == null ? st : Math.abs(st - target) });
      }
    }
    if (!cands.length) return null;
    cands.sort((x, y) => target != null ? x.dist - y.dist || x.rank - y.rank : x.rank - y.rank || x.st - y.st);
    const c = cands[0];
    return book(c.s, c.st, minutes, block);
  }
  const stretchEvening = () => { if (evening.end < hardBedAbs) { evening.end = hardBedAbs; if (!stays.includes(evening)) stays.push(evening); return true; } return false; };

  // getting ready in the morning (not a task, just held)
  if (!start && stays[0] && stays[0].loc === 'home' && firstDrive) booked.push({ stay: stays[0], start: firstDrive.start - rules.readyMin, end: firstDrive.start });

  // 0. meals setup, and breakfast first thing (before anything else takes the morning)
  const meals = mealsFor(date, input.nutrition && input.nutrition.planVersion);
  const gymV = visits.find(v => v.type === 'gym');
  const gymDrive = gymV && r.items.find(i => i.kind === 'drive' && i.forVisit === gymV);
  const mealBlocks = {}, selfCooked = new Set();
  const eat = (m, o) => {
    const blk = { type: 'meal', meal: m.key, title: m.name, detail: itemsText(m), supplements: m.supplements, check: true, ref: `meal:${date}:${m.key}` };
    const away = rules.eatMin + (needsCooking(m) ? 10 : 0);       // away from home, cooked food needs the microwave (gas station / gym)
    const at = t => place(rules.eatMin, { ...t, prefer: ['home'] }, blk) || place(away, { ...t, prefer: ['grandma', 'uni'] }, blk) || place(away, { ...t, prefer: ['grandma', 'uni'], anywhere: true }, blk);
    const keep = b => { b.meal_obj = m; mealBlocks[m.key] = b; return b; };
    let b = at(o);
    if (b) return keep(b);
    // no free time at the right time: eat it during a study block (at the desk, or from the cooler)
    const lo = o.earliest ?? -Infinity, hi = o.latest ?? Infinity;
    const sb = blocks.filter(x => x.type === 'study' && x.end - x.start >= rules.eatMin && x.end > lo && x.start < hi).sort((x, y) => Math.abs(x.start - (o.target ?? x.start)) - Math.abs(y.start - (o.target ?? y.start)))[0];
    if (sb) { const st = Math.max(sb.start, Math.min(lo, sb.end - rules.eatMin)); const x = { ...blk, title: `${m.name} (while studying)`, start: st, end: st + rules.eatMin, loc: sb.loc, overlap: true }; blocks.push(x); return keep(x); }
    b = at({ ...o, latest: Infinity });
    if (b) return keep(b);
    return null;
  };
  const M = Object.fromEntries(meals.map(m => [m.key, m]));
  const skip = k => !M[k] || doneRefs.has(`meal:${date}:${k}`) || (change.skipMeals || []).includes(k) || (start && k === 'breakfast' && startMin > 660);
  let last = start ? startMin - 150 : null;
  if (!skip('breakfast')) {
    const m = M.breakfast;
    const self = !start && needsCooking(m) && dayStart < rules.maidFrom + 30 && stays[0] && stays[0].loc === 'home';
    if (self) { book(stays[0], dayStart, rules.cookSelfMin, { type: 'cook', title: 'Cook breakfast', detail: recipeLines(m).join(' '), check: true, ref: `cook:${date}:breakfast` }); selfCooked.add('breakfast'); }
    const e = start ? startMin : dayStart + (self ? rules.cookSelfMin : 0);
    const b = eat(m, { earliest: e, target: e, latest: e + 150 });
    if (b) last = b.end; else warnings.push('Breakfast didn’t fit this morning.');
  }
  // 1. uni work — fixed-day items first, then the rest, each where he prefers it (home first)
  const sortedWork = work.sort((a, b) => (a.day ? 0 : 1) - (b.day ? 0 : 1) || (a.latest ?? 9999) - (b.latest ?? 9999));
  const carry = [];
  for (const w of sortedWork) {
    const blk = { type: 'study', title: w.title, detail: w.what, ref: w.ref, check: true, kind: w.kind };
    let got = place(w.minutes, { earliest: w.earliest ?? -Infinity, latest: w.latest ?? Infinity, target: w.at ?? null }, blk);
    if (!got && w.split) { const h = Math.ceil(w.minutes / 2); const a = place(h, {}, { ...blk, title: `${w.title} (1 of 2)` }); const b = a && place(w.minutes - h, { earliest: a.end }, { ...blk, title: `${w.title} (2 of 2)` }); got = a && b; }
    const dueLater = w.until && w.until.date > date;      // can wait a day rather than cost sleep
    if (!got && !dueLater && stretchEvening()) got = place(w.minutes, { earliest: w.earliest ?? -Infinity, latest: w.latest ?? Infinity }, blk);
    if (!got) { if (w.until && w.until.date > date) carry.push(w.ref); else warnings.push(`No time today for ${w.title}${w.until ? ` (due ${t12(w.until.min)})` : ''}.`); }
  }
  if (exam) {
    let left = exam.minutes, n = 0;
    while (left > 0) {
      const m = Math.min(rules.studyChunkMax, left);
      const b = place(m, {}, { type: 'study', title: exam.title, detail: `${exam.minutes / 60} h today`, ref: `exam:${date}:${n}`, check: true, kind: 'exam' });
      if (!b) { if (!stretchEvening()) break; continue; }
      left -= m; n++;
    }
    if (left > 0) warnings.push(`Only ${(exam.minutes - left) / 60} of ${exam.minutes / 60} h of exam study fit today.`);
  }

  // 2. the rest of the meals
  if (gymV && gymDrive && !skip('preworkout')) {
    const leave = gymDrive.start;
    const b = place(rules.eatMin, { earliest: leave - 120, latest: leave, target: leave - rules.eatMin, prefer: ['home', 'grandma', 'uni'] }, { type: 'meal', meal: 'preworkout', title: M.preworkout.name, detail: itemsText(M.preworkout), supplements: M.preworkout.supplements, check: true, ref: `meal:${date}:preworkout` })
      || (() => { const x = { type: 'meal', meal: 'preworkout', title: M.preworkout.name, detail: itemsText(M.preworkout), supplements: M.preworkout.supplements, check: true, ref: `meal:${date}:preworkout`, start: gymDrive.start, end: gymDrive.end, loc: 'car' }; blocks.push(x); return x; })();
    b.meal_obj = M.preworkout; mealBlocks.preworkout = b;
  }
  if (!skip('lunch')) {
    const e = Math.max(rules.lunchAt - 120, last != null ? last + 150 : -Infinity);
    const b = eat(M.lunch, { earliest: e, target: Math.max(rules.lunchAt, last != null ? last + 180 : 0), latest: Math.max(e, rules.lunchAt + 300) });
    if (b) last = b.end; else warnings.push('Lunch didn’t fit today.');
  }
  if (!skip('dinner')) {
    const e = Math.max(rules.dinnerAt - 150, last != null ? last + 150 : -Infinity);
    let b = eat(M.dinner, { earliest: e, target: Math.max(rules.dinnerAt, last != null ? last + 210 : 0), latest: Math.max(e, evening.end - rules.eatMin) });
    if (!b && stretchEvening()) b = eat(M.dinner, { earliest: e, target: e });
    if (b) last = b.end; else warnings.push('Dinner didn’t fit today.');
  }
  if (!skip('evening')) {
    let b = eat(M.evening, { earliest: Math.max(evening.start, last != null ? last + 60 : -Infinity), target: evening.end - rules.eatMin, latest: evening.end });
    if (!b && stretchEvening()) b = eat(M.evening, { earliest: evening.start, target: evening.end - rules.eatMin });
    if (!b) warnings.push('The evening shake didn’t fit today.');
  }

  // 3. groceries (Saturday) — from home, to the co-op and back
  if (dow === rules.groceryDow && !change.noGroceries && !doneRefs.has(`groceries:${date}`)) {
    const total = rules.groceryDrive * 2 + rules.groceryMin;
    const g = place(total, { earliest: 540, latest: 1320, prefer: ['home'] }, { type: 'errand', title: 'Weekly grocery shopping', detail: `Co-op near home · ${rules.groceryDrive} min each way · Nutrition Coach’s Grocery tab has the list`, check: true, ref: `groceries:${date}`, away: true });
    if (!g) warnings.push('Grocery shopping didn’t fit today.');
  }

  // 4. walking pad — 1.5 h at home, during desk things first, then in free time at home
  let walk = input.walkDone || 0;
  for (const b of blocks.filter(b => b.loc === 'home' && ['study', 'meal'].includes(b.type)).sort((a, c) => a.start - c.start)) {
    if (walk >= rules.walkMin) break;
    const m = Math.min(b.end - b.start, rules.walkMin - walk); b.walk = m; walk += m;
  }
  while (walk < rules.walkMin) {
    const m = Math.min(30, rules.walkMin - walk);
    const b = place(m, { prefer: ['home'], earliest: dayStart }, { type: 'walk', title: 'Walking pad', detail: 'At your desk — relax, watch something, read', check: true, ref: `walk:${date}:${walk}` });
    if (!b) break;
    b.walk = m; walk += m;
  }
  if (walk < rules.walkMin) warnings.push(`Only ${walk} of ${rules.walkMin} min on the walking pad fit — not enough time at home today.`);

  // 5. cooking and the maid — what has to be cooked, by whom, ready by when
  const leaveHome = when => { const d = r.items.filter(i => i.kind === 'drive' && i.from === 'home' && i.start <= when).pop(); const back = d && r.items.find(i => i.kind === 'drive' && i.to === 'home' && i.end > d.start && i.end <= when); return back ? null : d; };
  const maidJobs = [], selfCook = [], cooler = [];
  for (const [key, b] of Object.entries(mealBlocks)) {
    const m = b.meal_obj, away = b.loc !== 'home';
    const out = away ? leaveHome(b.start) : null;
    if (away) cooler.push({ meal: m.name, heat: needsCooking(m), at: b.loc, leg: out });
    if (!needsCooking(m)) continue;
    const readyBy = away ? (out ? out.start : b.start) : b.start;
    if (selfCooked.has(key)) continue;
    if (key === 'breakfast' && readyBy < rules.maidFrom + 30) { selfCook.push(b); continue; }
    if (readyBy >= rules.maidFrom + 30) maidJobs.push({ meal: m, readyBy: Math.min(readyBy, rules.maidTo), cookDay: date, late: readyBy > rules.maidTo });
    else maidJobs.push({ meal: m, readyBy: rules.maidTo, cookDay: addDays(date, -1), dayBefore: true });
  }
  for (const b of selfCook) {
    const c = place(rules.cookSelfMin, { latest: b.start, target: b.start - rules.cookSelfMin, prefer: ['home'] }, { type: 'cook', title: `Cook ${b.title.toLowerCase()}`, detail: recipeLines(b.meal_obj).join(' '), check: true, ref: `cook:${date}:${b.meal}` });
    if (!c) b.detail += ' · cook it yourself first (before the maid starts at 7am)';
  }
  for (const b of Object.values(mealBlocks)) {
    if (b.loc === 'uni' && needsCooking(b.meal_obj)) b.detail += ' · from the cooler, heat it at the gas station microwave near uni';
    else if (isGym(b.loc) && needsCooking(b.meal_obj)) b.detail += ' · from the cooler, heat it in the gym microwave';
    else if (b.loc === 'grandma') b.detail += ' · from the cooler';
    else if (b.loc === 'car') b.detail += ' · eat it on the drive (from the cooler)';
    delete b.meal_obj;
  }

  // ---- drives become blocks, with leave times and what to bring
  const gymIn = gymV && r.items.find(i => i.kind === 'drive' && i.forVisit === gymV), gymOut = gymV && r.items.find(i => i.kind === 'drive' && i.from === gymV.loc && i.start >= gymV.end);
  const usesBag = !!(gymOut && gymOut.to === 'uni'), usesPhones = !!(gymIn && gymIn.from === 'uni');
  let firstOut = true;
  for (const i of r.items.filter(i => i.kind === 'drive')) {
    if (start && i.end <= start.min) continue;
    const bring = [];
    if (i.from === 'home' && firstOut) {
      if (usesBag) bring.push('Gym bag with towel, toiletries and clean clothes — you shower at the gym before uni');
      if (usesPhones) bring.push('Headphones — you go straight from uni to the gym');
      const packed = cooler.filter(c => c.leg === i || (!c.leg && i === r.items.find(x => x.kind === 'drive')));
      if (packed.length) bring.push(`Cooler with ${packed.map(c => c.meal.toLowerCase()).join(', ')}`);
      firstOut = false;
    }
    if (i.from === 'uni' && isGym(i.to)) bring.push('Headphones');
    if (isGym(i.from) && i.to === 'uni') bring.push('Shower at the gym first (gym bag)');
    const v = i.forVisit;
    const why = v && v.type === 'class' ? `${v.title} at ${t12(v.start)}${v.room ? `, ${v.room}` : ''} — there by ${t12(v.start - rules.classEarly)}` : v && v.type === 'gym' ? `${WORKOUT_NAME[pw.workout]} at ${PLACE_NAME[v.loc]}` : v ? v.title : '';
    blocks.push({ type: 'drive', start: i.start, end: i.end, from: i.from, to: i.to, title: i.to === 'other' && v ? `Leave for ${v.title.toLowerCase()}` : `Leave for ${PLACE_NAME[i.to]}`, detail: [`${i.end - i.start} min drive`, why].filter(Boolean).join(' · '), bring, check: true, ref: `drive:${date}:${i.from}>${i.to}@${hhmm(i.start)}` });
  }
  for (const v of visits) {
    if (start && v.end <= start.min) continue;
    if (v.type === 'class' || v.type === 'exam') blocks.push({ type: v.type, start: v.ongoing ? (classes.find(c => c.title === v.title && c.end === v.end) || v).start : v.start, end: v.end, loc: 'uni', title: v.title, detail: v.room || '', check: false });
    else if (v.type === 'gym') blocks.push({ type: 'gym', start: v.start, end: v.end, loc: v.loc, title: `${WORKOUT_NAME[pw.workout]} · ${PLACE_NAME[v.loc]}`, detail: `~${workoutMinutes(pw.workout)} min (PPL Coach)${v.shower ? ` + ${rules.showerMin} min shower` : ''} · ${CROWD_WORD[gym.tier]} then`, check: true, ref: `gym:${date}` });
    else blocks.push({ type: 'busy', start: v.start, end: v.end, loc: v.loc, title: v.title, detail: '', check: true, ref: `busy:${date}:${hhmm(v.start)}` });
  }
  // being at grandma's on a break
  for (const s of stays.filter(s => s.loc === 'grandma')) blocks.push({ type: 'place', start: s.start, end: s.end, loc: 'grandma', title: 'Break at your grandmother’s', detail: '', check: true, ref: `grandma:${date}:${hhmm(s.start)}`, background: true });

  // ---- sleep
  const lastHome = Math.max(evening.start, ...blocks.filter(b => b.loc === 'home').map(b => b.end));
  bedAbs = Math.max(lastHome, Math.min(bedPrefAbs, evening.end));
  const nextWake = wakeNextAbs != null ? Math.min(wakeNextAbs, bedAbs + rules.sleepPrefer) : bedAbs + rules.sleepPrefer;
  const sleepAfter = nextWake != null ? nextWake - bedAbs : null;
  if (sleepAfter != null && sleepAfter < rules.sleepPrefer) warnings.push(`Only ${Math.floor(sleepAfter / 60)} h ${sleepAfter % 60 ? `${sleepAfter % 60} min ` : ''}of sleep tonight.`);
  if (!start) {
    const sleepBefore = input.prevBedAbs != null ? wake - input.prevBedAbs : null;
    blocks.push({ type: 'wake', start: wake, end: wake, loc: 'home', title: 'Wake up', detail: sleepBefore != null ? `${Math.floor(sleepBefore / 60)} h ${sleepBefore % 60 ? (sleepBefore % 60) + ' min ' : ''}of sleep` : '', check: false });
  }
  blocks.push({ type: 'sleep', start: bedAbs, end: bedAbs, loc: 'home', title: 'Sleep', detail: sleepAfter != null ? `${Math.floor(sleepAfter / 60)} h${sleepAfter % 60 ? ' ' + (sleepAfter % 60) + ' min' : ''} until ${t12(nextWake)}` : '', check: false });

  const ORDER = { wake: 0, cook: 1, maid: 2 };
  blocks.sort((a, b) => a.start - b.start || (ORDER[a.type] ?? 5) - (ORDER[b.type] ?? 5) || (a.type === 'drive' ? -1 : 1));
  for (const b of blocks) { b.from_ = b.start; b.startT = hhmm(b.start); b.endT = hhmm(b.end); }

  return {
    date, version: 2, wake: start ? null : wake, bed: bedAbs, workout: noGym ? null : pw.workout,
    gym: gym ? { at: gym.gym, start: gym.visit.start, tier: gym.tier, crowd: CROWD_WORD[gym.tier] } : null,
    blocks, maidJobs, carry, notes, warnings, walk
  };
}

/** The maid's message for everything she cooks on `cookDay` (exact amounts and method). */
export function maidMessage(jobs, cookDay, sentDayBefore = false) {
  const mine = jobs.filter(j => j.cookDay === cookDay);
  if (!mine.length) return null;
  const parts = mine.sort((a, b) => a.readyBy - b.readyBy).map(j => {
    const whenText = j.dayBefore ? 'by 9pm, for the next morning (I’ll pack it)' : `ready by ${t12(j.readyBy)}${j.late ? ' (I’ll reheat it later)' : ''}`;
    return `${j.meal.name} ${whenText}:\n${recipeLines(j.meal).map(l => '• ' + l).join('\n')}`;
  });
  return `Hi, please cook ${sentDayBefore ? 'tomorrow' : 'today'}:\n\n${parts.join('\n\n')}\n\nPlease weigh everything and don’t add oil, butter or sauces beyond what’s listed. Thank you!`;
}

/**
 * Plan several days in a row (each day's wake/bed feeds the next). Returns { days: [plan…] }.
 * input: same as planDay plus from (first date), n (days), changes: {date: change}, firstStart?, prevBedAbs?
 */
export function planDays(input) {
  const rules = { ...RULES, ...(input.rules || {}) };
  const weeks = examWeeks(input.events || []);
  const work = uniWork(input.events || [], rules);
  const out = [];
  let prevBedAbs = input.prevBedAbs ?? null;
  const done = new Set(input.doneRefs || []);
  // the first committed wake of a day (latest wake for its first visit), for the night before
  const driveOf = date => input.driveFor ? input.driveFor(date) : input.drive;
  const firstNeed = date => {
    const ch = (input.changes || {})[date] || {};
    if (ch.wakeAt) return toMin(ch.wakeAt);
    const cancelled = ch.cancelClasses === true ? null : new Set(ch.cancelClasses || []);
    const vs = [...(input.classes || []).filter(c => +c.weekday === dowOf(date) && !(cancelled === null || cancelled.has(c.course))).map(c => ({ start: toMin(c.start_time), loc: 'uni', cls: true })),
      ...examsOn(date, input.events, rules).map(e => ({ start: e.start, loc: 'uni', cls: true })),
      ...(ch.busy || []).map(b => ({ start: toMin(b.from), loc: b.place || 'other' }))].filter(v => v.start != null).sort((a, b) => a.start - b.start);
    if (!vs.length) return null;
    const v = vs[0], d = v.loc === 'home' ? 0 : driveOf(date)('home', v.loc, v.start) ?? 30;
    let w = v.start - (v.cls ? rules.classEarly : 0) - d - rules.readyMin - rules.eatMin;
    if (w < rules.maidFrom) w -= rules.cookSelfMin;
    return w;
  };
  for (let i = 0; i < (input.n || 1); i++) {
    const date = addDays(input.from, i);
    const wn = firstNeed(addDays(date, 1));
    const plan = planDay({ ...input, rules, date, work, drive: driveOf(date), examWeeks: weeks, doneRefs: done, change: (input.changes || {})[date] || {},
      start: i === 0 ? input.firstStart : null, walkDone: i === 0 ? input.firstWalkDone || 0 : 0, prevBedAbs, wakeNextAbs: wn != null ? wn + 1440 : null });
    for (const b of plan.blocks) if (b.ref && b.type === 'study') done.add(b.ref);
    out.push(plan);
    prevBedAbs = plan.bed - 1440;
  }
  // the maid: a reminder the evening before (8pm) to text her, with the full message
  for (let i = 0; i < out.length; i++) {
    const jobs = out.flatMap(p => p.maidJobs);
    const msgFor = (d, early) => maidMessage(jobs, d, early);
    const p = out[i];
    const tomorrow = addDays(p.date, 1), msg = msgFor(tomorrow, true);
    if (msg) {
      const at = Math.min(Math.max(1200, (p.blocks.find(b => b.type === 'wake') || { start: 0 }).start), p.bed - 5);
      p.blocks.push({ type: 'maid', start: at, end: at, startT: hhmm(at), endT: hhmm(at), title: 'Text the maid for tomorrow', detail: 'Tap to copy the message', message: msg, check: true, ref: `maid:${tomorrow}`, instant: true });
    }
    if (i === 0) {
      const today = msgFor(p.date);
      if (today && !input.firstStart) {
        const at = Math.max(rules.maidFrom - 30, p.wake ?? 0);
        p.blocks.push({ type: 'maid', start: at, end: at, startT: hhmm(at), endT: hhmm(at), title: 'Text the maid for today', detail: 'Tap to copy the message', message: today, check: true, ref: `maid:${p.date}`, instant: true });
      }
    }
    p.blocks.sort((a, b) => a.start - b.start || (a.type === 'wake' ? -1 : b.type === 'wake' ? 1 : 0));
  }
  return { days: out };
}
