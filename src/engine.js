// =====================================================================
// JARVIS ENGINE — facts and physics. No opinions.
//
// Jarvis (Claude) decides how each day goes and what to think about each app. This file only:
//   • reads what his three apps say — PPL Coach's rotation and program, Nutrition Coach's meal plan and targets,
//     Uni Planner's timetable and deadlines — using the same rules those apps use (copied from their code);
//   • works out how long each drive takes;
//   • checks that a plan Jarvis wrote is physically possible and keeps what Salah told it for that day;
//   • summarises each app's data so Jarvis can analyse it.
// Nothing here decides when to study, eat, sleep or train — that's Jarvis, from Salah's own rules.
// Times inside are minutes after local midnight; anything before 03:00 belongs to the night before bed.
// =====================================================================

// ---------- time ----------
const toMin = s => { if (s == null || s === '') return null; if (typeof s === 'number') return s; const m = String(s).match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const fmt = m => { m = Math.round(m); const d = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`; };
const t12 = m => { if (m == null) return ''; m = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const dowOf = iso => new Date(iso + 'T00:00:00Z').getUTCDay();             // 0 = Sunday, same as Uni Planner
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dlong = d => `${DAYS[dowOf(d)].slice(0, 3)} ${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;
/** A timestamptz → { date, min } in local time (Kuwait is UTC+3, no daylight saving). */
function localOf(ts, tz = 180) { const d = new Date(Date.parse(ts) + tz * 60000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
const AFTER_MIDNIGHT = 180;                  // a plan time before 03:00 is after midnight (e.g. lights out at 00:30)
const planMin = s => { const m = toMin(s); return m == null ? null : m < AFTER_MIDNIGHT ? m + 1440 : m; };
/** His day, not the calendar's: until 03:00 he's still in yesterday (it's 00:35 of last night, not the start of today),
 *  so the date is yesterday's and the time runs past 24:00. Today's plan starts fresh from 03:00. */
function dayNow(ts, tz = 180) { const l = localOf(ts, tz); return l.min < AFTER_MIDNIGHT ? { date: addDays(l.date, -1), min: l.min + 1440 } : l; }
const round1 = x => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// =====================================================================
// PPL COACH — copied from ppl-logic.js so Jarvis reasons with the app's exact rules.
// =====================================================================
const ROTATION = ['push', 'pull', 'legs', 'rest'];
const DAY_NAMES = { push: 'Push', pull: 'Pull', legs: 'Legs', rest: 'Rest' };
const CATS = { compound: { between: 180, after: 210 }, moderate: { between: 120, after: 150 }, isolation: { between: 90, after: 90 } };
const BACKOFF = { 3: [1, 0.85, 0.75], 4: [1, 0.92, 0.85, 0.80] };
const WARMUP_PCT = 0.5, DEFAULT_INC = 2.5;
const ex = (id, name, cat, sets, lo, hi) => ({ id, name, cat, sets, lo, hi });
const PROGRAM = {
  push: [ex('incline-db-press', 'Incline Dumbbell Press', 'compound', 4, 6, 10), ex('flat-machine-press', 'Flat Machine Chest Press', 'moderate', 3, 8, 12), ex('cable-chest-fly', 'Cable Chest Fly', 'moderate', 3, 12, 15), ex('machine-shoulder-press', 'Machine Shoulder Press', 'moderate', 3, 8, 12), ex('cable-lateral-raise', 'Cable Lateral Raise', 'isolation', 4, 15, 20), ex('oh-cable-tri-ext', 'Overhead Cable Triceps Extension', 'isolation', 3, 10, 15), ex('seated-cable-pushdown', 'Seated Cable Triceps Pushdown', 'isolation', 3, 12, 15)],
  pull: [ex('lat-pulldown', 'Lat Pulldown', 'compound', 4, 6, 10), ex('chest-supported-row', 'Chest-Supported Row', 'compound', 4, 8, 12), ex('sa-cable-pulldown', 'Single-Arm Cable Pulldown', 'isolation', 3, 12, 15), ex('sa-rear-delt-fly', 'Single-Arm Cable Rear-Delt Fly', 'isolation', 4, 15, 20), ex('btb-cable-curl', 'Behind-the-Back Cable Curl', 'isolation', 3, 10, 12), ex('cable-hammer-curl', 'Cable Hammer Curl', 'isolation', 3, 12, 15)],
  legs: [ex('hack-squat', 'Hack Squat', 'compound', 4, 8, 12), ex('rdl', 'Romanian Deadlift', 'compound', 4, 8, 12), ex('leg-press', 'Leg Press', 'compound', 3, 8, 12), ex('leg-extension', 'Leg Extension', 'isolation', 3, 12, 15), ex('seated-leg-curl', 'Seated Leg Curl', 'isolation', 4, 10, 15), ex('standing-calf-raise', 'Standing Calf Raise', 'isolation', 4, 10, 15), ex('abs', 'Abs', 'isolation', 3, 10, 15)]
};
const EX_BY_ID = Object.fromEntries(Object.values(PROGRAM).flat().map(e => [e.id, e]));
const nextDay = last => !last ? 'push' : ROTATION[(ROTATION.indexOf(last) + 1) % ROTATION.length];
const roundTo = (x, inc) => +(Math.round(x / inc + 1e-9) * inc).toFixed(3);
const epley = (w, r) => w * (1 + r / 30);
/** PPL Coach's Set 1 rule (planSet1 in ppl-logic.js). */
function planSet1(prev, e, inc, prevPrev) {
  if (!prev) return { kind: 'first', weight: null };
  if (prev.r >= e.hi) return { kind: 'increase', weight: +(prev.w + inc).toFixed(3) };
  if (prev.r < e.lo && prevPrev && prev.w > prevPrev.w) return { kind: 'rollback', weight: prevPrev.w };
  return { kind: 'same', weight: prev.w };
}
/** How long a workout takes by PPL Coach's own rest rules: 45 s a set, its rest times, one warm-up set per exercise, 5 min to warm up. */
/** About how long one exercise takes with PPL Coach's rest times (setup + warm-up + sets + rests). */
function exerciseMinutes(e) { const c = CATS[e.cat]; return Math.round((45 + 60 + e.sets * 45 + (e.sets - 1) * c.between + c.after) / 60); }
function pplEstimateMinutes(day) {
  const list = PROGRAM[day]; if (!list) return 0;
  let s = 5 * 60;
  for (const e of list) { const c = CATS[e.cat]; s += 45 + 60 + e.sets * 45 + (e.sets - 1) * c.between + c.after; }
  return Math.round(s / 60);
}

/** Which workout he trains on `date`. He trains every day: when PPL Coach's rotation reaches its Rest step he picks Push in
 *  the app's day picker and carries on. The only days off are rest days HE picks — rare and random — and they pause the rotation. */
const trainThrough = w => w === 'rest' ? 'push' : w;
function gymFor(date, today, g = {}) {
  const rest = new Set(g.restDays || []);
  if (g.lastSessionDate === date && g.lastSessionDay) return { workout: g.lastSessionDay, done: true };
  if (rest.has(date)) return { workout: 'rest', chosenRest: true };
  let last = g.lastCompleted;
  const from = g.lastSessionDate === today ? addDays(today, 1) : today;
  for (let d = from, i = 0; d < date && i < 60; d = addDays(d, 1), i++) if (!rest.has(d)) last = trainThrough(nextDay(last));
  const shows = last ? nextDay(last) : 'push';
  return { workout: trainThrough(shows), appSaysRest: shows === 'rest', projected: date > today };
}

// =====================================================================
// NUTRITION COACH — the locked plan and the app's rules (from plan.js, engine.js, foods.js).
// =====================================================================
const FOODS = {   // USDA values per 100 g, as in Nutrition Coach's foods.js: [name, kcal, protein, carbs, fat]
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
  { key: 'evening', name: 'Evening', items: [['milk', 254], ['whey', 25], ['strawberries', 150], ['walnuts', 15]] }
];
const DINNER_WEEK = { 0: 'salmon', 1: 'salmon', 2: 'beef', 3: 'salmon', 4: 'beef', 5: 'salmon', 6: 'beef_liver' };
const DAY_TYPE_LABEL = { salmon: 'Salmon day', beef: 'Beef day', beef_liver: 'Beef day + liver' };
const SUPPLEMENTS = [
  { key: 'creatine', name: 'Creatine 5 g', when: 'breakfast' }, { key: 'vitD3', name: 'Vitamin D3 25 µg', when: 'breakfast' },
  { key: 'omega3', name: 'Omega-3 1000 mg', when: 'breakfast' }, { key: 'preworkout', name: 'Pre-workout (200 mg caffeine)', when: 'preworkout' },
  { key: 'magnesium', name: 'Magnesium 200 mg', when: 'evening' }, { key: 'ashwagandha', name: 'Ashwagandha 300 mg', when: 'evening' }
];
const NUTRITION_RULES = { trendDays: 7, trendMinReadings: 4, adherenceCal: 0.10, adherenceProtein: 0.90, adherenceDays: 5, greenCal: 0.05, greenProtein: 0.95 };
function baseDay(type) {
  return BASE_MEALS.map(m => ({ key: m.key, name: m.name, items: m.items.flatMap(([k, g]) => k !== 'DINNER' ? [{ food: k, grams: g }]
    : type === 'salmon' ? [{ food: 'salmon', grams: g }] : type === 'beef' ? [{ food: 'lean_beef', grams: g }] : [{ food: 'lean_beef', grams: g - 25 }, { food: 'liver', grams: 25 }]) }));
}
/** Macros of a list of items ({food, grams} or Nutrition Coach custom {custom, name, kcal, protein, carbs, fat} per 100 g serving). */
function macrosOf(items) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const it of items || []) {
    if (it.custom) { t.kcal += +it.kcal || 0; t.protein += +it.protein || 0; t.carbs += +it.carbs || 0; t.fat += +it.fat || 0; continue; }
    const f = FOODS[it.food]; if (!f) continue; const k = (+it.grams || 0) / 100;
    t.protein += f[2] * k; t.carbs += f[3] * k; t.fat += f[4] * k;
    t.kcal += (f[2] * 4 + f[3] * 4 + f[4] * 9) * k;                     // Nutrition Coach counts 4/4/9
  }
  return { kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}
const cookedFoodsOf = items => (items || []).filter(it => !it.custom && ['eggs', 'chicken_breast', 'rice', 'broccoli', 'salmon', 'lean_beef', 'liver', 'sweet_potato'].includes(it.food)).map(it => FOODS[it.food][0]);
const itemText = it => it.custom ? `${it.name} (custom, ${Math.round(it.kcal)} kcal)` : `${FOODS[it.food] ? FOODS[it.food][0] : it.food} ${Math.round(it.grams)} g`;
/** The day's meals as Nutrition Coach plans them (its newest plan version, else the starting quantities). */
function mealsForDay(date, planVersion) {
  const type = DINNER_WEEK[dowOf(date)];
  const day = planVersion && planVersion.days && planVersion.days[type] && planVersion.days[type].day || baseDay(type);
  return { type, label: DAY_TYPE_LABEL[type], meals: day.map(m => ({ key: m.key, name: m.name, items: m.items, foods: m.items.map(itemText).join(', '), needsCooking: cookedFoodsOf(m.items),
    supplements: SUPPLEMENTS.filter(s => s.when === m.key).map(s => s.name), ...macrosOf(m.items) })) };
}
const targetsOf = (pv, profile) => pv ? { calories: pv.calories ?? (profile && profile.calories), protein: pv.protein, carbs: pv.carbs, fat: pv.fat } : { calories: profile && profile.calories };

// =====================================================================
// KITCHEN — what needs cooking, what's been cooked, and how long cooking really takes him (learned from his taps).
// =====================================================================
const MEAL_KEYS = ['breakfast', 'lunch', 'preworkout', 'dinner', 'evening'];
const MEAL_NAME = { breakfast: 'Breakfast', lunch: 'Lunch', preworkout: 'Pre-workout', dinner: 'Dinner', evening: 'Evening shake' };
const NEEDS_COOKING = new Set(['eggs', 'chicken_breast', 'rice', 'broccoli', 'salmon', 'lean_beef', 'liver', 'sweet_potato']);
const KEEPS_DAYS = 3;                       // cooked food is planned at most 3 days ahead (USDA: cooked leftovers keep 3–4 days in the fridge)
const DINNER_NAME = { salmon: 'salmon', beef: 'beef', beef_liver: 'beef + liver' };
const mealFromTitle = t => /breakfast/i.test(t) ? 'breakfast' : /lunch/i.test(t) ? 'lunch' : /pre-?workout/i.test(t) ? 'preworkout' : /dinner/i.test(t) ? 'dinner' : /evening|shake/i.test(t) ? 'evening' : null;
const isoDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
/** The Nutrition Coach meal a meal block is (its `meal`, else read from the title). */
const mealOf = b => MEAL_KEYS.includes(b.meal) ? b.meal : b.type === 'meal' ? mealFromTitle(b.title || '') : null;
/** What a cook block makes: [{meal, date}] from `makes`, else read from the title (that day). */
function makesOf(b, date) {
  if (Array.isArray(b.makes) && b.makes.length) return b.makes.filter(m => m && MEAL_KEYS.includes(m.meal)).map(m => ({ meal: m.meal, date: isoDate(m.date) ? m.date : date }));
  const t = b.title || '', out = [];
  for (const k of ['breakfast', 'lunch', 'dinner']) if (new RegExp(k, 'i').test(t)) out.push({ meal: k, date });
  return out;
}
/** Minutes a block really took: what he tapped, or his start/done taps. */
function tookOf(b) {
  if (isFinite(+b.took) && +b.took > 0) return Math.round(+b.took);
  if (b.startedAt && b.doneAt) { const m = Math.round((Date.parse(b.doneAt) - Date.parse(b.startedAt)) / 60000); if (m >= 1 && m <= 240) return m; }
  return null;
}
const median = xs => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : null; };
const dishOf = (meal, date) => meal === 'dinner' ? `Dinner (${DINNER_NAME[DINNER_WEEK[dowOf(date)]]})` : MEAL_NAME[meal] || meal;
/** "Dinner (beef)", "Lunch ×3", "Breakfast + Lunch" — how a cooking session is grouped for learning. */
function cookLabel(makes) { const c = {}; for (const m of makes) { const k = dishOf(m.meal, m.date); c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort().map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(' + '); }
const shortDay = d => `${DAYS[dowOf(d)].slice(0, 3)} ${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;

/** How long cooking actually took him, by what he cooked (last 6 weeks of his taps). */
function cookTimes(plans, today, days = 42) {
  const by = {};
  for (const p of plans.filter(p => dayDiff(p.date, today) >= 0 && dayDiff(p.date, today) <= days)) for (const b of (p.plan && p.plan.blocks) || []) {
    if (b.type !== 'cook' || b.skipped || b.by === 'maid') continue;
    const took = tookOf(b), makes = makesOf(b, p.date);
    if (took == null || !makes.length) continue;
    (by[cookLabel(makes)] = by[cookLabel(makes)] || []).push({ date: p.date, took, planned: planMin(b.end) - planMin(b.start) });
  }
  return Object.entries(by).map(([cooking, xs]) => {
    xs.sort((a, b) => a.date < b.date ? -1 : 1);
    const t = xs.slice(-6).map(x => x.took);
    return { cooking, minutesEachTime: t, typical: median(t), lastPlanned: xs[xs.length - 1].planned, last: xs[xs.length - 1].date };
  }).sort((a, b) => a.last < b.last ? 1 : -1).slice(0, 12);
}
/** Food already cooked for `date` on an earlier day (a batch, or last night's cooking). */
function cookedAhead(date, plans, today) {
  const out = [];
  for (const p of plans.filter(p => p.date < date && dayDiff(p.date, date) <= KEEPS_DAYS)) for (const b of (p.plan && p.plan.blocks) || []) {
    if (b.type !== 'cook' || b.skipped) continue;
    for (const m of makesOf(b, p.date).filter(m => m.date === date))
      out.push({ meal: m.meal, cookedOn: `${shortDay(p.date)} ${b.start}`, status: b.done || tookOf(b) != null ? 'cooked (he marked it done)' : p.date < today ? 'planned, but he never marked it done — don\'t count on it: plan it as not cooked and ask him' : 'planned, not cooked yet' });
  }
  return out;
}
/** How his recent planned days actually went: what he skipped, what took longer or shorter than planned. */
function howItWent(plans, today, days = 7) {
  const ps = plans.filter(p => p.date < today && dayDiff(p.date, today) <= days).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!ps.length) return null;
  const byType = {}, skipped = [], off = [];
  for (const p of ps) for (const b of (p.plan && p.plan.blocks) || []) {
    if (['travel', 'free', 'class', 'exam', 'wake', 'sleep'].includes(b.type)) continue;
    const c = byType[b.type] = byType[b.type] || { planned: 0, done: 0, skipped: 0, notMarked: 0 };
    c.planned++; if (b.done) c.done++; else if (b.skipped) c.skipped++; else c.notMarked++;
    const tag = `${shortDay(p.date)} ${b.start} ${b.type} "${b.title}"`;
    if (b.skipped) skipped.push(tag);
    const took = tookOf(b), planned = planMin(b.end) - planMin(b.start);
    if (took != null && Math.abs(took - planned) >= 10) off.push(`${tag}: planned ${planned} min, took ${took}`);
  }
  return { daysPlanned: ps.length, byType, skipped: skipped.slice(-12), tookLongerOrShorter: off.slice(-12) };
}
/** What's at home: foods he told Jarvis he's out of (until a shop stop that buys them is marked done), shopping already
 *  planned, and Nutrition Coach's grocery list (what he ticked as bought, and when that shop runs out). */
function pantryFacts({ pantry = [], grocery = [], plans = [], date, today }) {
  const bought = {}, planned = [];
  for (const p of plans) for (const b of (p.plan && p.plan.blocks) || []) {
    if (!Array.isArray(b.shop) || !b.shop.length || b.skipped) continue;
    for (const f of b.shop.filter(f => FOODS[f])) {
      if (b.done) { if (!bought[f] || bought[f] < p.date) bought[f] = p.date; }
      else if (p.date >= today && p.date <= date) planned.push(`${FOODS[f][0]} on ${shortDay(p.date)} at ${b.start}`);
    }
  }
  const outOf = pantry.filter(x => x && FOODS[x.food] && !(bought[x.food] && bought[x.food] >= x.since))
    .map(x => ({ food: x.food, name: FOODS[x.food][0], status: x.status === 'low' ? 'running low' : 'out', since: shortDay(x.since), ...(x.note ? { note: x.note } : {}) }));
  const g = grocery.filter(x => x && isoDate(x.week) && x.week <= date).sort((a, b) => a.week < b.week ? -1 : 1).pop();
  const used = [...new Set(BASE_MEALS.flatMap(m => m.items.map(([k]) => k)).flatMap(k => k === 'DINNER' ? ['salmon', 'lean_beef', 'liver'] : [k]))];
  const ticked = g ? used.filter(k => g.checked && g.checked[k]) : [];
  const groceryList = !g ? "He hasn't ticked anything on Nutrition Coach's grocery list, so you only know what's at home from what he tells you."
    : { listMadeOn: shortDay(g.week), coversUntil: shortDay(addDays(g.week, 6)), tickedAsBought: ticked.map(k => FOODS[k][0]), notTicked: used.filter(k => !ticked.includes(k)).map(k => FOODS[k][0]),
        ...(addDays(g.week, 6) < date ? { note: `That shop only covered the plan until ${shortDay(addDays(g.week, 6))}` } : {}) };
  return { outOf, shoppingPlanned: planned, groceryList };
}
/** The foods a meal is really made of: a swap's foods if it has them, else (for a "same food, another way/time" swap) the planned foods. */
const mealOwn = sw => [...(Array.isArray(sw.items) ? sw.items : []), ...(Array.isArray(sw.foods) ? sw.foods : [])].filter(f => f && FOODS[f.food] && +f.grams > 0);
function mealItems(sw, planned) {
  const own = sw ? mealOwn(sw) : [];
  return own.length ? own : sw && sw.buy && sw.buy.what ? [] : planned.items;
}
// ---------- the weekly grocery day ----------
// Same list as Nutrition Coach's Grocery tab: the planned grams for the next 7 days, with raw amounts to buy for foods
// counted cooked (its own factors). The grocery day is his pick, or Jarvis's: the first day of the week without classes.
const RAW_BUY = { chicken_breast: 1 / 0.75, salmon: 1 / 0.8, lean_beef: 1 / 0.75, liver: 1 / 0.8, rice: 1 / 2.9, sweet_potato: 1 / 0.85 };
const RAW_WORD = { rice: 'dry', sweet_potato: 'raw, with skin' };
function weeklyGroceries(from, planVersion, days = 7) {
  const tot = {};
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i), type = DINNER_WEEK[dowOf(d)];
    const day = planVersion && planVersion.days && planVersion.days[type] && planVersion.days[type].day || baseDay(type);
    for (const m of day) for (const it of m.items || []) if (!it.custom && FOODS[it.food]) tot[it.food] = (tot[it.food] || 0) + (+it.grams || 0);
  }
  const kg = g => g >= 1000 ? `${(g / 1000).toFixed(2).replace(/0$/, '')} kg` : g < 100 ? `${Math.round(g / 5) * 5} g` : `${Math.round(g / 10) * 10} g`;
  const count = { eggs: [50, 'large eggs'], banana: [118, 'medium bananas'] };
  return Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([food, g]) => ({ food, name: FOODS[food][0],
    buy: food === 'milk' ? `${(g / 1.016 / 1000).toFixed(1)} L` : RAW_BUY[food] ? `about ${kg(g * RAW_BUY[food])} ${RAW_WORD[food] || 'raw'} (${kg(g)} cooked)` : count[food] ? `${kg(g)} (about ${Math.ceil(g / count[food][0])} ${count[food][1]})` : kg(g) }));
}
/** Which date is his grocery day in the week containing `date` (weeks start Sunday). */
function groceryDayOf(date, setting, noClassDay) {
  const sunday = addDays(date, -dowOf(date));
  if (setting && DAYS.includes(setting)) return addDays(sunday, DAYS.indexOf(setting));
  for (let i = 0; i < 7; i++) { const d = addDays(sunday, i); if (noClassDay(d)) return d; }
  return addDays(sunday, 5);
}
/** One meal swapped for an alternative: honest macros (from his food list, or his estimate for bought food) and how to log it. */
function swapMacros(opt, planned) {
  const items = (opt.foods || []).filter(f => f && FOODS[f.food] && +f.grams > 0).map(f => ({ food: f.food, grams: Math.min(1500, Math.round(+f.grams)) }));
  let macros, foods, estimated = false;
  if (items.length) { macros = macrosOf(items); foods = items.map(itemText).join(', '); }
  else if (opt.buy && opt.buy.what) {
    const n = k => Math.max(0, Math.round(+opt.buy[k] || 0));
    macros = { kcal: n('kcal'), protein: n('protein'), carbs: n('carbs'), fat: n('fat') }; foods = opt.buy.what; estimated = true;
  } else { macros = { kcal: planned.kcal, protein: planned.protein, carbs: planned.carbs, fat: planned.fat }; foods = planned.foods; }
  const diff = { kcal: macros.kcal - planned.kcal, protein: macros.protein - planned.protein };
  const same = !items.length && !(opt.buy && opt.buy.what);
  const log = same ? `Log ${planned.name} in Nutrition Coach as eaten.`
    : items.length ? `Log ${planned.name} in Nutrition Coach as edited: ${foods}.`
    : `Log ${planned.name} in Nutrition Coach as something else: ${foods}, about ${macros.kcal} kcal, ${macros.protein} g protein, ${macros.carbs} g carbs, ${macros.fat} g fat (an estimate — use the label if it has one).`;
  return { items, foods, ...macros, estimated, sameFoodAsPlanned: same, vsPlan: same ? 'same food as planned' : `${diff.kcal >= 0 ? '+' : ''}${diff.kcal} kcal, ${diff.protein >= 0 ? '+' : ''}${diff.protein} g protein vs the plan${estimated ? ' (estimated)' : ''}`, log };
}

// =====================================================================
// UNI PLANNER
// =====================================================================
const KIND_NAME = { exam: 'Exam', gca: 'GCA', quiz: 'Quiz', lab: 'Graded lab', prelab: 'Pre-lab', assignment: 'Assignment', hw: 'Homework', project: 'Project', info: 'Info' };
const GRADED = ['exam', 'gca', 'quiz', 'lab', 'prelab', 'assignment', 'hw', 'project'];
const UNSURE = /check|confirm|tbd|exact|once announced|not sure|\?/i;
const pctOf = w => parseFloat(String(w || '').replace('%', '')) || 0;

// =====================================================================
// DRIVES
// =====================================================================
// His places. 'gym' is a single gym; gym_* are the branches his membership covers (Jarvis picks one per session).
// 'grandma' is his grandmother's home: closer to uni, but none of his things are there.
const PLACES = ['home', 'grandma', 'uni', 'gym', 'gym_rigae', 'gym_mahboula', 'gym_sabah'];
const PLACE_NAME = { home: 'home', grandma: 'your grandmother’s', uni: 'uni', gym: 'the gym', gym_rigae: 'Oxygen Gym Rigae', gym_mahboula: 'Oxygen Gym Mahboula', gym_sabah: 'Oxygen Gym Sabah Al-Salem', here: 'where you are' };
const isGym = k => k === 'gym' || /^gym_/.test(k || '');
const isHome = k => k === 'home';
const interp = (pts, t) => {
  t = ((t % 1440) + 1440) % 1440;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (t - a) / (b - a); }
  return pts[pts.length - 1][1];
};
/**
 * Drive times between his places.
 *   profile: { 'home>uni': [[minuteOfDay, minutes], …] } — Google's traffic prediction for that weekday (best)
 *   freeFlow: { 'home-uni': minutes } — empty-road minimum from the map (fallback; keys sorted alphabetically)
 *   parking: minutes he needs from parking to the room (his own number)
 */
function makeDrive({ profile = null, freeFlow = {}, parking = 10 } = {}) {
  const drive = (a, b, t) => {
    if (a === b) return 0;
    const pts = profile && profile[`${a}>${b}`];
    if (pts && pts.length) return Math.ceil(interp(pts, t == null ? 720 : t));
    const r = freeFlow[[a, b].sort().join('-')];
    return r == null ? null : Math.ceil(r);
  };
  const arrive = (a, b, t) => { const d = drive(a, b, t); return d == null ? null : d + (b === 'uni' ? parking : 0); };
  const known = PLACES.some(a => PLACES.some(b => a !== b && drive(a, b, 720) != null));
  return { drive, arrive, parking, hasTraffic: !!profile, known };
}

// =====================================================================
// MEMORY — what Salah told Jarvis
//   kind 'goal' — what he's working toward;  kind 'rule' (must | prefer) — how he wants things done;
//   kind 'day'  — a change for one date, with settings the planner must obey that day.
// =====================================================================
const OVERRIDE_TIMES = ['wake', 'sleep', 'gymAt', 'lunchAt', 'dinnerAt'];
function cleanOverrides(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const k of OVERRIDE_TIMES) if (typeof o[k] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o[k])) out[k] = o[k];
  return out;
}
function memoryFor(date, rows) {
  const live = (rows || []).filter(m => m && m.active !== false);
  const changes = live.filter(m => m.kind === 'day' && m.date === date).sort((a, b) => String(a.created_at || '') < String(b.created_at || '') ? -1 : 1);
  const serves = m => Array.isArray(m.serves) ? m.serves.filter(Boolean).map(String) : [];
  return {
    goals: live.filter(m => m.kind === 'goal').map(m => ({ id: m.id, text: m.text, track: m.track || null, target: m.target || null })),
    habits: live.filter(m => m.kind === 'habit').map(m => ({ id: m.id, strength: m.strength === 'prefer' ? 'prefer' : 'must', text: m.text, serves: serves(m), track: m.track || null })),
    rules: live.filter(m => m.kind === 'rule').map(m => ({ id: m.id, strength: m.strength === 'must' ? 'must' : 'prefer', text: m.text, serves: serves(m), category: m.category || 'other', ...(m.course ? { course: m.course } : {}) })),
    today: changes.map(m => ({ id: m.id, text: m.text, overrides: cleanOverrides(m.overrides) })),
    overrides: Object.assign({}, ...changes.map(m => cleanOverrides(m.overrides)))
  };
}

// =====================================================================
// GOALS — his big goals, the habits he set to reach them, and how each is really going (facts only; Jarvis judges)
// =====================================================================
const PERSONAL_CATEGORIES = { study: 'Study', university: 'University — classes and what to bring', gym: 'Gym', food: 'Food and cooking', sleep: 'Sleep and routine', travel: 'Travel', home: 'Home and help', other: 'Other' };
const HABIT_TRACKS = ['gym_daily', 'progressive_overload', 'macros', 'classes_on_time', 'assignments_on_time', 'study_on_time'];
const GOAL_TRACKS = ['body', 'grades'];
// Nutrition Coach's own program (its engine's GOALS), so Jarvis can see whether the app is aimed at his goal
const NC_PROGRAM = { cutBodyFat: 10, bulkWeight: 83, bulkBodyFatCeiling: 17, finalBodyFat: 12, finalWeightMin: 78, finalWeightMax: 82 };
const CUT_BANDS = [[20, '0.75–1.0'], [15, '0.60–0.80'], [12, '0.40–0.60'], [0, '0.30–0.50']];

/** Body goal: where he is vs the target, the pace, and whether Nutrition Coach's program ends where he wants to. */
function bodyProgress(target = {}, n) {
  const tw = +target.weightKg || null, tb = +target.bodyFatPct || null, P = NC_PROGRAM;
  const w = n.weighIns.trend7, bf = n.bodyFat.trend7, lastW = n.weighIns.last[n.weighIns.last.length - 1], lastB = n.bodyFat.last[n.bodyFat.last.length - 1];
  const out = { target: `${tw ?? '?'} kg at ${tb ?? '?'}% body fat${target.by === 'asap' ? ', as fast as possible' : target.by ? ` by ${target.by}` : ''}`,
    now: w != null ? `${w} kg (7-day average)${bf != null ? `, ${bf}% body fat (7-day average)` : lastB ? `, body fat last read ${lastB}` : ', body fat unknown'}`
      : lastW ? `last weigh-in ${lastW} — not enough readings for a 7-day average` : 'unknown: no weigh-ins in Nutrition Coach',
    phase: n.phase ? `${n.phase.replace('_', ' ')} since ${n.phaseStarted || '?'}, ${n.calories || '?'} kcal` : 'no phase set in Nutrition Coach' };
  if (w != null && bf != null && tw && tb) {
    const lean = w * (1 - bf / 100), leanT = tw * (1 - tb / 100), fat = w * bf / 100, fatT = tw * tb / 100;
    out.math = `about ${round1(lean)} kg lean and ${round1(fat)} kg fat now; the goal is ${round1(leanT)} kg lean and ${round1(fatT)} kg fat — ${lean >= leanT ? `lean mass is already there, so it's mainly losing ${round1(fat - fatT)} kg of fat` : `he needs about ${round1(leanT - lean)} kg more lean mass and ${round1(Math.max(0, fat - fatT))} kg less fat`}`;
  }
  if (n.weighIns.trend7 != null && n.weighIns.trendWeekBefore != null) {
    const d = round1(n.weighIns.trend7 - n.weighIns.trendWeekBefore), pct = round1(d / n.weighIns.trendWeekBefore * 100);
    const band = bf != null ? CUT_BANDS.find(([lo]) => bf > lo)[1] : null;
    out.pace = `${d >= 0 ? '+' : ''}${d} kg this week (${pct >= 0 ? '+' : ''}${pct}% of body weight)${band && /cut/.test(n.phase || '') ? `; Nutrition Coach's cut band at this body fat is −${band}% a week` : ''}`;
  } else out.pace = 'unknown: Nutrition Coach needs 4+ weigh-ins in each of the last two weeks';
  out.nutritionCoachRoute = `Cut to ${P.cutBodyFat}% → lean bulk to ${P.bulkWeight} kg (ends early at ${P.bulkBodyFatCeiling}% body fat) → final cut to ${P.finalBodyFat}% at ${P.finalWeightMin}–${P.finalWeightMax} kg`;
  const off = [];
  if (tb && tb < P.finalBodyFat) off.push(`its final cut stops at ${P.finalBodyFat}% body fat, but his goal is ${tb}%`);
  if (tw && (tw < P.finalWeightMin || tw > P.finalWeightMax)) off.push(`its final weight range is ${P.finalWeightMin}–${P.finalWeightMax} kg, but his goal is ${tw} kg`);
  if (off.length) out.appVsGoal = `Nutrition Coach is not aimed exactly at his goal: ${off.join('; ')}.`;
  if (n.bodyFat.total === 0) out.missing = `No body-fat readings, so neither Jarvis nor Nutrition Coach can tell how far he is from ${tb || P.finalBodyFat}%, and the cut review never adjusts calories.`;
  return out;
}

/** Grades goal: per course, what's been marked (from what he told Jarvis), what's done, what's still to come and when. */
function gradesProgress({ events = [], marks = [], today, tz = 180 }) {
  const G = events.filter(e => GRADED.includes(e.kind)).map(e => ({ ...e, l: localOf(e.due_at, tz), w: pctOf(e.weight) }));
  const courses = [...new Set(G.map(e => e.course))].sort();
  const out = courses.map(c => {
    const items = G.filter(e => e.course === c), mk = marks.filter(m => m.course === c);
    const marked = mk.map(m => { const w = m.weight != null ? +m.weight : pctOf((items.find(e => String(e.id) === String(m.event_id)) || {}).weight); return { w, pct: m.score / m.out_of }; });
    const mw = marked.reduce((a, m) => a + m.w, 0), earned = marked.reduce((a, m) => a + m.w * m.pct, 0);
    const markedIds = new Set(mk.map(m => String(m.event_id)));
    const past = items.filter(e => e.l.date < today || e.done || markedIds.has(String(e.id))), ahead = items.filter(e => !e.done && e.l.date >= today && !markedIds.has(String(e.id)));
    const unmarked = past.filter(e => !markedIds.has(String(e.id)));
    const next = ahead.sort((a, b) => a.due_at < b.due_at ? -1 : 1)[0];
    return { course: c, gradeWeightInUniPlanner: `${round1(items.reduce((a, e) => a + e.w, 0))}%`,
      marked: marked.length ? `${marked.length} item${marked.length > 1 ? 's' : ''} worth ${round1(mw)}%: earned ${round1(earned)} of those ${round1(mw)} grade points (${Math.round(earned / mw * 100)}%)` : 'no marks recorded',
      ...(unmarked.length ? { doneButNoMark: unmarked.map(e => `${e.title}${e.weight ? ` (${e.weight})` : ''}`) } : {}),
      stillToCome: `${round1(ahead.reduce((a, e) => a + e.w, 0))}% in ${ahead.length} item${ahead.length === 1 ? '' : 's'}`,
      ...(next ? { next: `${next.title}${next.weight ? ` (${next.weight})` : ''} ${dlong(next.l.date)}` } : {}) };
  });
  const soon = G.filter(e => !e.done && dayDiff(today, e.l.date) >= 0 && dayDiff(today, e.l.date) <= 14).reduce((a, e) => a + e.w, 0);
  return { courses: out, gradeAtStakeNext14Days: `${round1(soon)}%`, marksRecorded: marks.length,
    ...(marks.length ? {} : { missing: 'Uni Planner has weights but no scores, and he hasn\'t told Jarvis any marks yet, so how well each course is going is unknown.' }) };
}

/** How a habit has really gone lately, from his apps and his taps in Jarvis. */
function habitCheck(track, x) {
  const { today } = x;
  if (track === 'gym_daily') {
    const trained = new Set(x.sessions.map(s => localOf(s.date, 180).date)), rest = new Set(x.restDays || []), days = [];
    const first = x.sessions.length ? localOf(x.sessions[0].date, 180).date : today;          // days before he started logging aren't misses
    for (let i = 7; i >= 1; i--) { const d = addDays(today, -i); days.push(d < first ? 'before PPL Coach' : trained.has(d) ? 'trained' : rest.has(d) ? 'rest (his pick)' : 'missed'); }
    const miss = days.map((v, i) => v === 'missed' ? shortDay(addDays(today, -(7 - i))) : null).filter(Boolean), counted = days.filter(v => v !== 'before PPL Coach').length;
    return { last7Days: counted ? `${days.filter(v => v === 'trained').length} trained, ${days.filter(v => v === 'rest (his pick)').length} chosen rest, ${miss.length} missed${miss.length ? ` (${miss.join(', ')})` : ''}${counted < 7 ? ` — counting from ${shortDay(first)}, when he started logging` : ''}` : 'nothing logged before today',
      today: trained.has(today) ? 'trained today' : 'not trained yet today', note: x.sessions.length < 7 ? `PPL Coach has only ${x.sessions.length} session${x.sessions.length === 1 ? '' : 's'} logged, from ${x.sessions[0] ? localOf(x.sessions[0].date, 180).date : '—'}` : undefined };
  }
  if (track === 'progressive_overload') {
    const L = x.gym.exercises.filter(e => e.logged);
    if (!L.length) return { status: 'no sessions logged in PPL Coach' };
    const top = L.filter(e => /top of range/.test(e.lastSet1Status)), below = L.filter(e => /below/.test(e.lastSet1Status)), inR = L.filter(e => /in range/.test(e.lastSet1Status));
    return { lastSet1: `${top.length} of ${L.length} logged exercises hit the top of their range (weight goes up next time), ${inR.length} in range, ${below.length} below the minimum`,
      belowMinimum: below.map(e => `${e.exercise} ${e.set1History[e.set1History.length - 1].split(' ')[1]} (range ${e.range})`),
      repeatedSessions: L.filter(e => e.logged > 1).length ? `${L.filter(e => e.logged > 1).length} exercises logged more than once` : 'no exercise logged twice yet, so no progression to judge' };
  }
  if (track === 'macros') {
    const from = x.nutrition.phaseStarted && x.nutrition.phaseStarted > addDays(today, -7) ? x.nutrition.phaseStarted : addDays(today, -7);
    const n = Math.max(0, dayDiff(from, today)), d7 = x.nutrition.foodLogs.days.filter(l => l.date >= from && l.date < today);
    const c = s => d7.filter(l => l.status === s).length;
    return { lastDays: n ? `${d7.filter(l => l.status !== 'not logged').length} of ${n} day${n === 1 ? '' : 's'} logged${n < 7 ? ` since the ${x.nutrition.phase || 'phase'} started ${shortDay(from)}` : ' this week'}: ${c('green')} on target, ${c('yellow')} close, ${c('red')} off${d7.some(l => /meals logged/.test(l.status)) ? ', some partly logged' : ''}` : 'the phase started today',
      targets: `${x.nutrition.targets.calories} kcal, ${x.nutrition.targets.protein} g protein (${x.nutrition.targets.stillStartingPlan ? "Nutrition Coach's starting plan" : 'set from his weight'})`,
      weighIns7: x.nutrition.weighIns.last7Days };
  }
  if (track === 'classes_on_time') {
    const late = (x.plans || []).filter(p => dayDiff(p.date, today) >= 0 && dayDiff(p.date, today) < 14).flatMap(p => (p.plan.problems || []).filter(pr => /late/i.test(pr.problem)).map(() => p.date));
    return { measured: "Jarvis can't see when he arrives; it plans each drive with margin and counts the times he reports running late.", lateReports14Days: late.length };
  }
  if (track === 'assignments_on_time') {
    return { pastDueNotTickedInUniPlanner: x.uni.pastDueNotTicked.length ? x.uni.pastDueNotTicked : 'none', dueNext7Days: x.uni.next35Days.filter(e => e.inDays < 7).map(e => e.item) };
  }
  if (track === 'study_on_time') {
    const work = {};
    for (const p of x.plans || []) for (const b of (p.plan && p.plan.blocks) || []) if (b.ref && ['study', 'homework'].includes(b.type)) {
      const m = Math.max(0, planMin(b.end) - planMin(b.start)), w = work[b.ref] = work[b.ref] || { done: 0, planned: 0, skipped: 0 };
      w.planned += m; if (b.done) w.done += m; if (b.skipped) w.skipped += m;
    }
    const up = x.events.filter(e => !e.done && GRADED.includes(e.kind) && dayDiff(today, localOf(e.due_at, 180).date) >= 0 && dayDiff(today, localOf(e.due_at, 180).date) <= 14);
    return { next14Days: up.map(e => { const w = work[e.id] || { done: 0, planned: 0, skipped: 0 }; return `${e.course} ${e.title}${e.weight ? ` (${e.weight})` : ''} in ${dayDiff(today, localOf(e.due_at, 180).date)} days: ${w.done} min studied and marked done, ${w.planned} planned${w.skipped ? `, ${w.skipped} skipped` : ''}`; }) };
  }
  return { status: 'Jarvis has no way to measure this one from the data — ask him how it is going.' };
}

/** The whole picture: each big goal with its progress, the habits that serve it (and how they're going), and the rules under it. */
function goalTree({ memory, today, gym, nutrition, uni, sessions = [], restDays = [], plans = [], events = [], marks = [] }) {
  const m = memoryFor(today, memory), x = { today, gym, nutrition, uni, sessions, restDays, plans, events };
  const progress = g => g.track === 'body' && nutrition ? bodyProgress(g.target || {}, nutrition) : g.track === 'grades' ? gradesProgress({ events, marks, today }) : null;
  const tree = m.goals.map(g => ({ id: g.id, goal: g.text, track: g.track, ...(progress(g) ? { progress: progress(g) } : {}),
    habits: m.habits.filter(h => h.serves.includes(String(g.id))).map(h => ({ id: h.id, habit: h.text, strength: h.strength, ...(h.track ? { lately: habitCheck(h.track, x) } : {}) })),
    rules: m.rules.filter(r => r.serves.includes(String(g.id))).map(r => ({ id: r.id, rule: r.text, strength: r.strength, category: r.category, ...(r.course ? { course: r.course } : {}) })) }));
  const ids = new Set(m.goals.map(g => String(g.id)));
  return { bigGoals: tree,
    habitsForNoGoal: m.habits.filter(h => !h.serves.some(id => ids.has(id))).map(h => ({ id: h.id, habit: h.text, strength: h.strength, ...(h.track ? { lately: habitCheck(h.track, x) } : {}) })),
    generalRules: m.rules.filter(r => !r.serves.some(id => ids.has(id))).map(r => ({ id: r.id, rule: r.text, strength: r.strength, category: r.category, ...(r.course ? { course: r.course } : {}) })) };
}

// =====================================================================
// ONE DAY — the facts Jarvis plans from
// input = { date, today, nowMin?, startLoc?, tz, classes, events, plannerSettings, gym (PPL state), nutrition: { profile, planVersion },
//           memory (rows), drive (makeDrive), sessionMinutes: {push, pull, legs} (his real averages), priorWork: { [eventId]: minutes } }
// =====================================================================
function buildDay(input) {
  const { date, tz = 180 } = input, today = input.today || date, dow = dowOf(date), ps = input.plannerSettings || {};
  const memory = memoryFor(date, input.memory);
  const ov = memory.overrides;
  const noClasses = (ps.skip_dates || []).includes(date) || (ps.term_start && date < ps.term_start) || (ps.term_end && date > ps.term_end);
  const events = (input.events || []).filter(e => !e.done);
  const dueToday = events.filter(e => localOf(e.due_at, tz).date === date && e.kind !== 'info');
  const fixed = [];
  if (!noClasses) for (const c of (input.classes || []).filter(c => Number(c.weekday) === dow)) {
    const start = toMin(c.start_time), end = toMin(c.end_time);
    const graded = dueToday.filter(e => e.course === c.course && Math.abs(localOf(e.due_at, tz).min - start) <= 30);
    fixed.push({ type: 'class', start, end, title: `${c.course} ${c.kind}`, course: c.course, room: c.room || null, instructor: c.instructor || null, graded: graded.map(e => `${e.title}${e.weight ? ` (${e.weight})` : ''}`) });
  }
  for (const e of dueToday.filter(e => e.kind === 'exam' || e.kind === 'gca')) {           // exams outside a class slot
    const m = localOf(e.due_at, tz).min;
    if (fixed.some(f => f.course === e.course && Math.abs(f.start - m) <= 30)) continue;
    fixed.push({ type: 'exam', start: m, end: m + 120, title: `${e.course} ${e.title}`, course: e.course, room: null, graded: [], lengthGuessed: true });
  }
  fixed.sort((a, b) => a.start - b.start);

  const drive = input.drive || makeDrive();
  const nowMin = input.nowMin != null && date === today ? input.nowMin : null;
  const start = nowMin != null ? Math.ceil(nowMin / 5) * 5 : null;                  // null = plan the whole day from wake-up
  let startLoc = PLACES.includes(input.startLoc) || input.startLoc === 'here' ? input.startLoc : null;
  if (!startLoc) startLoc = start != null && fixed.length && start >= fixed[0].start && start < fixed[fixed.length - 1].end ? 'uni' : 'home';
  for (const f of fixed) if (start != null && startLoc !== 'uni' && f.start < start && f.end > start) f.missed = true;

  const gym = gymFor(date, today, input.gym);
  const real = input.sessionMinutes || {};
  const sessionOf = w => ({ workout: w, minutes: real[w] ? Math.round(real[w]) : pplEstimateMinutes(w),
    minutesBasis: real[w] ? 'his average for this workout in PPL Coach' : "PPL Coach's rest times for this workout (no session logged yet)",
    exercises: PROGRAM[w].map(e => `${e.name} ${e.sets}×${e.lo}–${e.hi} (~${exerciseMinutes(e)} min)`) });
  if (PROGRAM[gym.workout]) Object.assign(gym, sessionOf(gym.workout));
  // a day ahead is a projection: it assumes each day before it goes as planned
  if (gym.projected) { const t = gymFor(today, today, input.gym); gym.assumes = t.done ? null : PROGRAM[t.workout] ? `${DAY_NAMES[t.workout]} is trained today as PPL Coach shows` : null; }

  const prior = input.priorWork || {};
  const graded = events.filter(e => GRADED.includes(e.kind)).map(e => ({ e, l: localOf(e.due_at, tz) }))
    .filter(x => dayDiff(date, x.l.date) >= 0 && dayDiff(date, x.l.date) <= 14).sort((a, b) => a.e.due_at < b.e.due_at ? -1 : 1);
  const upcoming = graded.map(({ e, l }) => ({ ref: e.id, title: `${e.course} ${e.title}`, kind: KIND_NAME[e.kind] || e.kind, weight: e.weight || null,
    due: `${l.date} ${fmt(l.min)}`, dueDay: dlong(l.date), inDays: dayDiff(date, l.date), dueMin: l.date === date ? l.min : null, note: e.note || null,
    workDoneMin: prior[e.id] || 0, timeUnsure: !!(e.all_day || UNSURE.test(e.note || '')) }));

  return {
    date, today, dow, dayName: DAYS[dow], tz, start, nowMin, startLoc, fixed, noClasses, drive, gym, upcoming,
    dueToday: upcoming.filter(u => u.inDays === 0),
    food: input.nutrition ? { ...mealsForDay(date, input.nutrition.planVersion), targets: targetsOf(input.nutrition.planVersion, input.nutrition.profile), phase: input.nutrition.profile ? input.nutrition.profile.phase : null } : null,
    memory, overrides: ov,
    // what Jarvis knows beyond the apps: the kitchen, what already happened today, the next few days, how recent days went
    kitchen: input.kitchen || { cookTimes: [], alreadyCooked: [], pantry: { outOf: [], shoppingPlanned: [], groceryList: null } },
    swaps: (input.swaps || []).filter(x => x && MEAL_KEYS.includes(x.meal)),
    earlier: input.earlier || null, nextDays: input.nextDays || [], history: input.history || null, goals: input.goals || null, liveDrive: input.liveDrive || null, grocery: input.grocery || null,
    placesSet: input.placesSet || null, crowds: input.crowds || {},
    travel: { arrivalBuffer: input.travel && isFinite(+input.travel.arrivalBuffer) ? +input.travel.arrivalBuffer : 5, learned: (input.travel && input.travel.learned) || {},
      priorities: (input.travel && input.travel.priorities) || ['university', 'gym', 'nutrition', 'sleep'], maidHours: (input.travel && input.travel.maidHours) || null }
  };
}

/** Drive minutes for Jarvis: by departure hour when there's traffic data, else one empty-road number per route. */
function driveTable(day) {
  const d = day.drive, out = {}, pairs = [];
  for (const a of PLACES) for (const b of PLACES) if (a !== b) pairs.push([a, b]);
  for (const [a, b] of pairs) {
    if (d.drive(a, b, 720) == null) continue;
    if (!d.hasTraffic) { out[`${a}→${b}`] = d.drive(a, b, 720); continue; }
    const row = {}; for (let h = 5; h <= 23; h++) row[fmt(h * 60)] = d.drive(a, b, h * 60);
    out[`${a}→${b}`] = row;
  }
  if (day.startLoc === 'here') for (const k of PLACES) { const v = d.drive('here', k, day.start); if (v != null) out[`here→${k}`] = v; }
  return out;
}

/** What each of his places is for, which ones are set, and what the gyms have been like. */
function placeNotes(day) {
  const set = day.placesSet && day.placesSet.length ? day.placesSet : null, gyms = (set || PLACES).filter(k => isGym(k) && k !== 'gym');
  return { keys: set || 'none set yet — use home, uni and the gym keys below and say in notes that he should set his places',
    home: 'home — where all his things are: kitchen, clothes, gym bag; the maid works here; every day ends here',
    grandma: 'his grandmother’s home (key "grandma") — closer to uni, but none of his things are there: good for a break between classes, a packed meal, or studying if he brought his laptop; no cooking, no change of clothes, no maid',
    gyms: `${gyms.map(k => `${PLACE_NAME[k]} (key "${k}")`).join(', ')} — his membership covers ${gyms.length > 1 ? 'all of them' : 'it'}. YOU pick the branch for every session and tell him — never ask him which one, and never use the generic key "gym". Pick by the shortest drive from where he is and to where he goes next, and the quietest at that time. He says Oxygen Gym is busiest 2–9pm and quieter before 2pm; his reports below on each branch beat that general pattern.`,
    ...(Object.keys(day.crowds || {}).length ? { howBusyHeSaidTheyWere: day.crowds } : {}) };
}
/** The goal tree for a day's plan: everything, minus ids. */
const compactTree = t => ({ bigGoals: t.bigGoals.map(({ id, track, habits, rules, ...g }) => ({ ...g, habits: habits.map(({ id, ...h }) => h), rules: rules.map(({ id, ...r }) => r) })),
  ...(t.habitsForNoGoal.length ? { otherHabits: t.habitsForNoGoal.map(({ id, ...h }) => h) } : {}), generalRules: t.generalRules.map(({ id, ...r }) => r) });
/** Everything Jarvis needs to plan one day, as plain data. */
function dayFacts(day) {
  const live = day.fixed.filter(f => !f.missed && (day.start == null || f.end > day.start));
  return {
    date: day.date, weekday: day.dayName,
    planFrom: day.start == null ? 'the whole day, from when he wakes up' : `${fmt(day.start)} (it is now ${fmt(day.nowMin)} — plan the rest of the day only)`,
    startsAt: day.startLoc,
    ...(day.start != null && day.start >= 1440 ? { lateNight: `It's ${fmt(day.start)} — past midnight, and he hasn't slept yet. Plan only the rest of tonight: if he isn't home, the drive home first; then lights out as soon as is sensible (a short wind-down at most). The sleep block runs until the time he should get up for tomorrow (classes, his usual wake time). Tomorrow gets its own plan — don't plan it here.` } : {}),
    classesAndExams: live.map(f => ({ start: fmt(f.start), end: fmt(f.end), title: f.title, room: f.room, ...(f.graded.length ? { gradedInClass: f.graded } : {}), ...(f.lengthGuessed ? { note: 'length not in Uni Planner — 2 h assumed' } : {}) })),
    missedClasses: day.fixed.filter(f => f.missed).map(f => `${f.title} ${fmt(f.start)}–${fmt(f.end)} — already started and he isn't at uni`),
    noClassesToday: live.length === 0 && !day.fixed.some(f => f.missed),
    termNote: day.noClasses ? 'Uni Planner marks this as a day without classes (outside term or a skip date).' : null,
    gym: day.gym.done ? { today: `${DAY_NAMES[day.gym.workout]} already done today` }
      : day.gym.chosenRest ? { today: 'a rest day he chose' }
      : { workout: DAY_NAMES[day.gym.workout], ppl: day.gym.appSaysRest ? `PPL Coach's rotation reaches Rest here, but he trains every day and only rests on days he picks — plan ${DAY_NAMES[day.gym.workout]} (he taps ${DAY_NAMES[day.gym.workout]} in PPL Coach's day picker)` : `PPL Coach shows ${DAY_NAMES[day.gym.workout]} next`,
          sessionMinutes: day.gym.minutes || null, sessionMinutesFrom: day.gym.minutesBasis, exercises: day.gym.exercises, ...(day.gym.assumes ? { assumes: day.gym.assumes } : {}) },
    food: day.food ? { nutritionCoach: `${day.food.label}, ${day.food.phase || 'no'} phase`, dailyTargets: day.food.targets,
      meals: day.food.meals.map(m => {
        const sw = day.swaps.find(x => x.meal === m.key), out = day.kitchen.pantry.outOf.filter(o => m.items.some(it => it.food === o.food)).map(o => `${o.name} (${o.status})`);
        return { key: m.key, meal: m.name, foods: m.foods, kcal: m.kcal, protein: m.protein, needsCooking: m.needsCooking.length ? m.needsCooking.join(', ') : 'nothing — just put together',
          ...(m.supplements.length ? { supplements: m.supplements } : {}), ...(out.length ? { heIsOutOf: out } : {}),
          ...(sw ? { heChoseInstead: { what: sw.title, foods: sw.foods, kcal: sw.kcal, protein: sw.protein, needsCooking: sw.needsCooking || 'see what he chose', how: sw.how || null } } : {}) };
      }) } : null,
    kitchen: {
      hisCookTimes: day.kitchen.cookTimes.length ? day.kitchen.cookTimes : "not timed yet — estimate, keep it modest and say it's an estimate",
      alreadyCooked: day.kitchen.alreadyCooked.map(a => ({ meal: MEAL_NAME[a.meal], cookedOn: a.cookedOn, status: a.status })),
      outOf: day.kitchen.pantry.outOf.map(o => `${o.name} — ${o.status} since ${o.since}${o.note ? ` (${o.note})` : ''}`),
      shoppingAlreadyPlanned: day.kitchen.pantry.shoppingPlanned,
      groceryList: day.kitchen.pantry.groceryList
    },
    dueToday: day.dueToday.map(u => ({ ref: u.ref, title: u.title, kind: u.kind, weight: u.weight, at: fmt(u.dueMin), note: u.note })),
    upcomingDeadlines: day.upcoming.filter(u => u.inDays > 0).map(u => ({ ref: u.ref, title: u.title, kind: u.kind, weight: u.weight, due: u.dueDay + ' ' + t12(toMin(u.due.slice(11))), inDays: u.inDays, studiedSoFarMin: u.workDoneMin, ...(u.note ? { note: u.note } : {}), ...(u.timeUnsure ? { dateUnsure: true } : {}) })),
    drives: day.drive.known ? driveTable(day) : 'unknown — his places are not set yet',
    drivesNote: day.drive.known ? (day.drive.hasTraffic ? 'Minutes by departure hour from Google traffic predictions for this weekday.' : 'Empty-road minimums from the map; there is no traffic data, so leave margin you judge sensible.') : 'Assume drives and say in notes that he should set his places.',
    parkingMinutes: day.drive.parking,
    hisPlaces: placeNotes(day),
    neverLate: `Every drive to uni must also include ${day.travel.arrivalBuffer} min of margin so he's in the room early${Object.keys(day.travel.learned).length ? ', plus the extra minutes these routes have really run over' : ''} (the checker enforces it).`,
    ...(Object.keys(day.travel.learned).length ? { drivesThatRunLate: day.travel.learned } : {}),
    whenTimeIsShort: `Protect in this order: ${day.travel.priorities.join(' → ')}. Take time from the last ones first.`,
    ...(day.grocery ? { groceryDay: day.grocery.today ? { today: true, why: day.grocery.why, list: day.grocery.list.map(x => `${x.name}: ${x.buy}`), shopKeys: day.grocery.list.map(x => x.food), coversUntil: day.grocery.coversUntil }
      : { next: day.grocery.next, why: day.grocery.why } } : {}),
    ...(day.travel.maidHours ? { maidHours: `${day.travel.maidHours.from}–${day.travel.maidHours.to}` } : {}),
    ...(day.goals ? { whatHeIsWorkingToward: compactTree(day.goals) } : { hisGoals: day.memory.goals.map(g => g.text), hisHabits: day.memory.habits.map(h => ({ strength: h.strength, habit: h.text })), hisRules: day.memory.rules.map(r => ({ strength: r.strength, rule: r.text })) }),
    changesForThisDay: day.memory.today.map(m => ({ said: m.text, ...(Object.keys(m.overrides).length ? { mustKeep: m.overrides } : {}) })),
    ...(day.earlier ? { earlierToday: day.earlier.blocks, ...(day.earlier.eatenToday && day.earlier.eatenToday.length ? { mealsLoggedInNutritionCoachToday: day.earlier.eatenToday } : {}), ...(day.earlier.inProgress.length ? { inProgressNow: day.earlier.inProgress } : {}) } : {}),
    nextDays: day.nextDays,
    ...(day.history ? { howHisRecentDaysWent: day.history } : {}),
    ...(day.liveDrive ? { liveTrafficNow: `The drive to ${day.liveDrive.to} takes ${day.liveDrive.minutes} min right now${day.liveDrive.to === 'uni' ? ', parking included' : ''} — use at least that, not the forecast.` } : {})
  };
}

// =====================================================================
// PLANS — read, normalise, check
// =====================================================================
const BLOCK_TYPES = ['wake', 'class', 'exam', 'travel', 'gym', 'meal', 'cook', 'study', 'homework', 'free', 'sleep', 'other'];
/** Which app a block belongs to (for colour). */
const appOf = b => ['class', 'exam', 'study', 'homework'].includes(b.type) ? 'uni' : b.type === 'gym' ? 'gym' : ['meal', 'cook'].includes(b.type) ? 'food' : 'jarvis';
function readPlan(raw) {
  const blocks = (Array.isArray(raw && raw.blocks) ? raw.blocks : []).map((b, i) => {
    const s = planMin(b.start), e = planMin(b.end);
    return { i, ...b, type: BLOCK_TYPES.includes(b.type) ? b.type : 'other', s, e: e != null && s != null && e < s ? e + 1440 : e };
  }).sort((a, b) => a.s - b.s || a.e - b.e);
  return { ...raw, blocks };
}

/** What changed between two versions of the rest of a day, in plain lines (for the "your plan changed" message). */
function planDiff(oldRaw, newRaw, from = 0) {
  const O = readPlan(oldRaw).blocks.filter(b => b.e > from && !['free', 'wake'].includes(b.type)), N = readPlan(newRaw).blocks.filter(b => b.e > from && !['free', 'wake'].includes(b.type));
  const key = b => `${b.type}|${b.type === 'travel' ? b.to : (b.ref || mealOf(b) || b.title)}`, out = [], used = new Set();
  for (const n of N) {
    const o = O.filter(x => key(x) === key(n) && !used.has(x)).sort((a, b) => Math.abs(a.s - n.s) - Math.abs(b.s - n.s))[0];
    if (o) used.add(o);
    if (!o) { if (!['class', 'exam'].includes(n.type)) out.push(`added ${n.title} at ${t12(n.s)}`); continue; }
    if (o.s !== n.s && (n.e - n.s) !== (o.e - o.s)) out.push(`${n.title}: ${t12(o.s)} → ${t12(n.s)}, ${o.e - o.s} → ${n.e - n.s} min`);
    else if (o.s !== n.s) out.push(`${n.title}: ${t12(o.s)} → ${t12(n.s)}`);
    else if (o.e !== n.e) out.push(`${n.title}: ${o.e - o.s} → ${n.e - n.s} min`);
  }
  for (const o of O) if (!used.has(o) && !['class', 'exam'].includes(o.type)) out.push(o.s < from ? `stop ${o.title} now (it was until ${t12(o.e)})` : `dropped ${o.title} (was ${t12(o.s)})`);
  return out;
}
/** Live traffic says he has to leave `delay` minutes earlier than planned. If the time can come out of flexible blocks
 *  right before the drive (free time first, then trimming study/gym/cooking by at most 15 min and never below half),
 *  return the shifted blocks; otherwise null (Jarvis re-plans the day instead). */
function shiftForTraffic(raw, i, latest, now) {
  const P = readPlan(raw), b = P.blocks.find(x => x.i === i);
  if (!b || latest < now) return null;
  const hit = P.blocks.filter(x => x !== b && !isBackground(x) && x.e > latest && x.s < b.s && x.type !== 'wake');
  const changes = [], blocks = raw.blocks.map(x => ({ ...x }));
  for (const x of hit) {
    if (['class', 'exam', 'study', 'homework', 'travel', 'sleep', 'meal'].includes(x.type)) return null;   // university work is protected first
    if (x.s >= latest) { if (x.type !== 'free') return null; blocks[x.i] = null; continue; }
    const cut = x.e - latest;
    if (x.type !== 'free' && (cut > 15 || (x.e - x.s) - cut < (x.e - x.s) / 2)) return null;
    blocks[x.i] = { ...blocks[x.i], end: fmt(latest) };
    if (x.type !== 'free') changes.push(`${x.title} ends at ${t12(latest)} instead of ${t12(x.e)}`);
  }
  blocks[i] = { ...blocks[i], start: fmt(latest) };
  return { blocks: blocks.filter(Boolean), changes };
}
// ---------- never late: margin on the drives that matter, learned from how his drives really went ----------
const slotOf = m => m < 12 * 60 ? 'morning' : m < 17 * 60 ? 'afternoon' : 'evening';
/** How much longer than planned each route has really taken (from live checks saved on his plans): 80th percentile, minutes. */
function routeOverruns(plans) {
  const by = {};
  for (const p of plans || []) for (const b of (p.plan && p.plan.blocks) || []) {
    if (b.type !== 'travel' || !isFinite(+b.liveMinutes) || !b.to) continue;
    const s = planMin(b.start), e = planMin(b.end); if (s == null || e == null) continue;
    (by[`${b.from || 'somewhere'}→${b.to} ${slotOf(s)}`] = by[`${b.from || 'somewhere'}→${b.to} ${slotOf(s)}`] || []).push(Math.max(0, +b.liveMinutes - (e - s)));
  }
  const out = {};
  for (const [k, xs] of Object.entries(by)) if (xs.length >= 2) { const v = xs.slice(-10).sort((a, b) => a - b); out[k] = { extraMinutes: v[Math.min(v.length - 1, Math.floor(v.length * 0.8))], drives: xs.length }; }
  return out;
}
/** The margin a drive needs on top of the forecast: his buffer before class, plus what this route has really run over. */
function marginFor(day, from, to, startMin) {
  const T = day.travel || {}, parts = [];
  let min = 0;
  if (to === 'uni' && T.arrivalBuffer) { min += T.arrivalBuffer; parts.push(`${T.arrivalBuffer} min early for class`); }
  const l = (T.learned || {})[`${from}→${to} ${slotOf(startMin)}`];
  if (l && l.extraMinutes) { min += l.extraMinutes; parts.push(`this drive has run ${l.extraMinutes} min over in the ${slotOf(startMin)}`); }
  return { min, why: parts.join(', ') };
}
/** How crowded each gym branch has been at each time of day, from his one-tap reports after training. */
const CROWD_SCORE = { quiet: 0, ok: 1, packed: 2 };
function gymCrowds(plans) {
  const by = {};
  for (const p of plans || []) for (const b of (p.plan && p.plan.blocks) || []) {
    if (b.type !== 'gym' || !(b.crowd in CROWD_SCORE)) continue;
    const s = planMin(b.start); if (s == null) continue;
    const band = s < 9 * 60 ? 'before 9am' : s < 12 * 60 ? '9am–12pm' : s < 16 * 60 ? '12–4pm' : s < 19 * 60 ? '4–7pm' : s < 21 * 60 ? '7–9pm' : 'after 9pm';
    const k = `${PLACE_NAME[b.loc] || b.loc || 'gym'}, ${DAYS[dowOf(p.date)]}s ${band}`;
    (by[k] = by[k] || []).push(CROWD_SCORE[b.crowd]);
  }
  return Object.fromEntries(Object.entries(by).map(([k, xs]) => { const a = xs.reduce((x, y) => x + y, 0) / xs.length; return [k, `${a < 0.5 ? 'quiet' : a < 1.5 ? 'OK' : 'packed'} (${xs.length} report${xs.length > 1 ? 's' : ''})`]; }));
}
const PRIORITY_GROUPS = { university: ['class', 'exam', 'study', 'homework'], gym: ['gym'], nutrition: ['meal', 'cook'], sleep: ['sleep'] };

/** Physics + his own day changes. Everything else is Jarvis's call. */
/** Cooking the maid does runs in the background: it doesn't take his time or need him at home. */
const isBackground = b => b.type === 'cook' && b.by === 'maid';
function validatePlan(day, raw) {
  const errors = [], warnings = [], plan = readPlan(raw), ALL = plan.blocks, B = ALL.filter(b => !isBackground(b));
  if (!B.length) return { ok: false, errors: ['The plan has no blocks.'], warnings };
  for (const b of ALL) {
    if (b.s == null || b.e == null) errors.push(`"${b.title || b.type}" needs a start and end as HH:MM.`);
    else if (b.e < b.s || (b.e === b.s && !['wake', 'sleep'].includes(b.type))) errors.push(`"${b.title}" ends before it starts (${b.start}–${b.end}).`);
  }
  if (errors.length) return { ok: false, errors, warnings };
  const live = day.fixed.filter(f => !f.missed && (day.start == null || f.end > day.start));
  if (day.start != null) { const early = ALL.find(b => b.s < day.start - 1 && b.type !== 'class'); if (early) errors.push(`"${early.title}" at ${early.start} is before now (${fmt(day.start)}) — plan from ${fmt(day.start)} on.`); }
  else if (B[0].type !== 'wake') errors.push('Start the day with a "wake" block at the time he should get up.');
  for (const f of live) if (!B.some(b => (b.type === 'class' || b.type === 'exam') && b.s === f.start && b.e === f.end))
    errors.push(`${f.title} ${fmt(f.start)}–${fmt(f.end)} is missing or moved — classes can't move.`);
  for (let i = 1; i < B.length; i++) if (B[i].s < B[i - 1].e) errors.push(`"${B[i - 1].title}" (${B[i - 1].start}–${B[i - 1].end}) overlaps "${B[i].title}" (${B[i].start}).`);
  // he can only be in one place, and drives take as long as they take
  let here = day.startLoc;
  for (const b of B) {
    if (b.type === 'travel') {
      if (b.to === 'gym') { errors.push(`The drive at ${b.start} goes to "the gym" — pick the branch yourself (gym_rigae, gym_mahboula or gym_sabah) and tell him why.`); here = b.to; continue; }
      if (!PLACES.includes(b.to)) { errors.push(`The drive at ${b.start} needs "to": one of his places (${(day.placesSet || PLACES).join(', ')}).`); continue; }
      if (day.placesSet && day.placesSet.length && !day.placesSet.includes(b.to) && day.drive.known) errors.push(`The drive at ${b.start} goes to ${b.to}, which he hasn't set as a place — use one of ${day.placesSet.join(', ')}.`);
      if (b.from && b.from !== here && !(b.from === 'gym' && isGym(here))) errors.push(`The drive at ${b.start} leaves from ${b.from}, but he'd be at ${PLACE_NAME[here] || here}.`);
      const need = day.drive.arrive(here, b.to, b.s), extra = marginFor(day, here, b.to, b.s);
      if (need != null && b.e - b.s < need + extra.min - 2) errors.push(`${PLACE_NAME[here] || here} → ${PLACE_NAME[b.to]} leaving ${b.start} takes ${need} min${b.to === 'uni' ? ` with ${day.drive.parking} min to park and walk in` : ''}${extra.min ? `, plus ${extra.min} min of margin (${extra.why})` : ''} — the block is ${b.e - b.s} min; make it at least ${need + extra.min}.`);
      here = b.to; continue;
    }
    const where = b.type === 'class' || b.type === 'exam' ? 'uni' : b.type === 'gym' ? (isGym(b.loc) ? b.loc : isGym(here) ? here : 'gym') : b.type === 'cook' ? 'home' : b.loc;
    if (b.type === 'gym' && b.loc === 'gym') errors.push(`The gym block at ${b.start} says "the gym" — name the branch (gym_rigae, gym_mahboula or gym_sabah).`);
    if (b.type === 'gym' && b.loc && !isGym(b.loc)) errors.push(`The gym block at ${b.start} has to be at a gym.`);
    if (b.type === 'gym' && !isGym(here)) errors.push(`The gym block at ${b.start} needs a drive to one of his gyms first.`);
    if (b.type === 'cook' && b.loc && b.loc !== 'home') errors.push(`Cooking at ${b.start} has to be at home (or done by the maid: "by": "maid").`);
    if (PLACES.includes(where) && where !== here && b.type !== 'free') errors.push(`"${b.title}" at ${b.start} is at ${PLACE_NAME[where]}, but he'd still be at ${PLACE_NAME[here] || here} — add the drive.`);
  }
  // food: cook it before eating it (today, earlier today, or ahead); cooked food keeps 3 days; he can't eat what he's out of
  if (day.food) {
    const outOf = new Set(day.kitchen.pantry.outOf.filter(o => o.status === 'out').map(o => o.food));
    const cooked = new Map([...(day.earlier ? day.earlier.madeToday : []), ...day.kitchen.alreadyCooked.filter(a => !/never marked/.test(a.status)).map(a => a.meal)].map(m => [m, -1])), bought = new Set();
    for (const b of ALL) {
      if (Array.isArray(b.shop)) for (const f of b.shop) bought.add(f);
      if (b.type === 'cook') {
        const mh = day.travel && day.travel.maidHours;
        if (isBackground(b) && mh && (b.s < toMin(mh.from) || b.e > toMin(mh.to))) errors.push(`The maid works ${t12(toMin(mh.from))}–${t12(toMin(mh.to))}; her cooking at ${b.start}–${b.end} is outside that — move it, or have it cooked the day before.`);
        if (isBackground(b) && !(b.message && String(b.message).trim())) errors.push(`The maid's cooking at ${b.start} needs "message": the exact text he sends her (what to cook, how much, ready by when).`);
        for (const m of makesOf(b, day.date)) {
          if (m.date < day.date || dayDiff(day.date, m.date) > KEEPS_DAYS) errors.push(`"${b.title}" at ${b.start} cooks ${MEAL_NAME[m.meal]} for ${m.date} — plan cooked food at most ${KEEPS_DAYS} days ahead (it keeps 3–4 days in the fridge).`);
          else if (m.date === day.date && !cooked.has(m.meal)) cooked.set(m.meal, b.e);
        }
        continue;
      }
      const meal = b.type === 'meal' ? mealOf(b) : null, planned = meal && day.food.meals.find(m => m.key === meal);
      if (!planned) continue;
      const sw = b.instead || day.swaps.find(x => x.meal === meal), items = mealItems(sw, planned);
      const ready = !!(sw && ((sw.buy && sw.buy.what && !mealOwn(sw).length) || sw.alreadyCooked || sw.kind === 'cooked'));
      const needs = ready ? [] : cookedFoodsOf(items);
      if (needs.length && cooked.has(meal) && cooked.get(meal) > b.s) errors.push(`${planned.name} at ${b.start} is eaten before its cooking finishes (${fmt(cooked.get(meal))}).`);
      if (needs.length && !cooked.has(meal)) errors.push(`${planned.name} at ${b.start} needs cooking (${needs.join(', ')}) but nothing before it cooks it — add a cook block before it with "makes": [{"meal": "${meal}"}], use food already cooked, or change the meal with "instead".`);
      const missing = items.filter(it => outOf.has(it.food) && !bought.has(it.food)).map(it => FOODS[it.food][0]);
      if (missing.length) errors.push(`${planned.name} at ${b.start} uses ${missing.join(', ')}, which he's out of — buy it first on a drive ("shop") or change the meal with "instead".`);
    }
  }
  if (day.grocery && day.grocery.today && day.start == null && !ALL.some(b => Array.isArray(b.shop) && b.shop.length >= 3))
    errors.push(`Today is his grocery day — plan the weekly shop: a drive with a supermarket stop (or a grocery run from home) with "shop" listing what to buy from groceryDay.list.`);
  if (day.liveDrive) {                                    // live traffic beats the forecast for the drive in question
    const t = B.find(b => b.type === 'travel' && b.to === day.liveDrive.to);
    if (t && t.e - t.s < day.liveDrive.minutes - 2) errors.push(`Live traffic: the drive to ${PLACE_NAME[t.to]} takes ${day.liveDrive.minutes} min right now${t.to === 'uni' ? ' with parking' : ''}, but the block is ${t.e - t.s} min.`);
  }
  const last = B.filter(b => b.type !== 'free').pop();
  if (!last || last.type !== 'sleep') errors.push('End the day with a "sleep" block at lights out.');
  if (here !== 'home') errors.push(`The day ends at ${PLACE_NAME[here] || here} — add the drive home.`);
  for (const u of day.dueToday) for (const b of B.filter(b => b.ref === u.ref && u.dueMin != null && b.e > u.dueMin)) errors.push(`Work for ${u.title} at ${b.start} ends after it's due (${fmt(u.dueMin)}).`);
  // what he said for this day is not optional
  const ov = day.overrides, sleep = B.find(b => b.type === 'sleep'), wake = B.find(b => b.type === 'wake'), gym = B.find(b => b.type === 'gym');
  if (ov.gymAt && !day.gym.done && (day.start == null || toMin(ov.gymAt) >= day.start)) {
    if (!gym) errors.push(`He said gym at ${ov.gymAt} today — there's no gym block.`);
    else if (Math.abs(gym.s - toMin(ov.gymAt)) > 20) errors.push(`He said gym at ${ov.gymAt} today, but the gym block starts at ${gym.start}.`);
  }
  if (ov.sleep && sleep && Math.abs(sleep.s - planMin(ov.sleep)) > 15) errors.push(`He said lights out at ${ov.sleep} today, but sleep is at ${sleep.start}.`);
  if (ov.wake && day.start == null && wake && Math.abs(wake.s - toMin(ov.wake)) > 10) errors.push(`He said he's up at ${ov.wake} that day, but wake is at ${wake.start}.`);
  // the gym is every day; only a rest day he picks is a day off
  const saysWhy = [...((raw && raw.rulesNotMet) || [])].some(r => /gym|train/i.test(String(r)));
  if (!gym && !day.gym.done && !day.gym.chosenRest && !saysWhy && !(day.start != null && day.start >= 1440)) errors.push(`There's no gym session. He trains every day (${DAY_NAMES[day.gym.workout]} is next) and only rests on days he picks himself — fit it in, shorter if it must be. If it truly can't fit, say why in rulesNotMet and give him options in choices (a shorter session, another time, a different branch, or making today a rest day).`);
  // worth a look, not wrong
  if (gym && day.gym.minutes && gym.e - gym.s < day.gym.minutes * 0.75) warnings.push(`The gym block is ${gym.e - gym.s} min; ${DAY_NAMES[day.gym.workout]} usually takes about ${day.gym.minutes}.`);
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, plan };
}

// =====================================================================
// STATS — each app's data, summarised for Jarvis's analysis (facts only; Jarvis judges)
// =====================================================================
const localDate = (ts, tz = 180) => localOf(typeof ts === 'number' ? new Date(ts).toISOString() : ts, tz).date;

/** PPL Coach: sessions, Set 1 history and what the app will do next, back-off and warm-up vs the app's rules. */
function gymStats({ today, tz = 180, sessions = [], incs = {}, bodyweight = [], restDays = [], lastCompleted = null, plans = [] }) {
  const S = sessions.filter(s => s && s.date && s.entries).map(s => ({ ...s, local: localDate(s.date, tz), minutes: s._at ? Math.round((Number(s._at) - Date.parse(s.date)) / 60000) : null }))
    .sort((a, b) => a.date < b.date ? -1 : 1);
  const exercises = [];
  for (const [day, list] of Object.entries(PROGRAM)) for (const e of list) {
    const hist = S.filter(s => s.entries[e.id] && s.entries[e.id].sets && s.entries[e.id].sets[0] && s.entries[e.id].sets[0].w != null)
      .map(s => ({ date: s.local, sets: s.entries[e.id].sets.filter(Boolean).map(x => ({ w: +x.w, r: +x.r })), warm: s.entries[e.id].warm || null }));
    if (!hist.length) { exercises.push({ exercise: e.name, workout: day, range: `${e.lo}–${e.hi}`, sets: e.sets, logged: 0 }); continue; }
    const inc = incs[e.id] != null ? +incs[e.id] : DEFAULT_INC;
    const last = hist[hist.length - 1], prev = hist[hist.length - 2];
    const s1 = last.sets[0], next = planSet1(s1, e, inc, prev && prev.sets[0]);
    const pct = BACKOFF[e.sets] || [];
    const backoff = last.sets.slice(1).map((x, i) => { const want = roundTo(s1.w * pct[i + 1], inc); return { set: i + 2, did: `${x.w}×${x.r}`, appSays: want, off: round1(x.w - want) }; }).filter(x => Math.abs(x.off) >= inc);
    exercises.push({ exercise: e.name, workout: day, category: e.cat, range: `${e.lo}–${e.hi}`, sets: e.sets, increment: inc, incrementIsDefault: incs[e.id] == null, logged: hist.length,
      set1History: hist.slice(-6).map(h => `${h.date} ${h.sets[0].w}×${h.sets[0].r}`),
      lastSet1Status: s1.r >= e.hi ? 'top of range — weight goes up next time' : s1.r < e.lo ? 'below the rep minimum' : 'in range',
      nextSet1ByPPLCoach: next.weight != null ? `${next.weight} kg (${next.kind})` : null,
      e1rmTrend: hist.length > 1 ? `${round1(epley(hist[0].sets[0].w, hist[0].sets[0].r))} → ${round1(epley(s1.w, s1.r))} kg` : null,
      ...(backoff.length ? { backoffNotAsAppSays: backoff } : {}),
      ...(last.warm && Math.abs(last.warm.w - roundTo(s1.w * WARMUP_PCT, inc)) >= inc ? { warmup: `did ${last.warm.w} kg; the app's rule is 50% of Set 1 = ${roundTo(s1.w * WARMUP_PCT, inc)} kg` } : {}),
      ...(last.sets.length < e.sets ? { setsLoggedLastTime: `${last.sets.length} of ${e.sets}` } : {}) });
  }
  const lastOf = d => S.filter(s => s.day === d).map(s => s.local).pop() || null;
  const recent = S.filter(s => dayDiff(s.local, today) < 28);
  const gymBlocks = plans.flatMap(p => ((p.plan && p.plan.blocks) || []).filter(b => b.type === 'gym').map(b => ({ date: p.date, done: !!b.done, skipped: !!b.skipped })));
  return {
    rotation: { lastCompleted, nextByPPLCoach: DAY_NAMES[nextDay(lastCompleted)], appRotation: 'Push → Pull → Legs → Rest', restDaysChosenInJarvis: restDays.filter(d => dayDiff(d, today) <= 28 && dayDiff(d, today) >= -7) },
    sessions: { total: S.length, last28Days: recent.length, last7Days: S.filter(s => dayDiff(s.local, today) < 7).length,
      list: S.slice(-14).map(s => `${s.local} ${DAY_NAMES[s.day] || s.day}${s.minutes ? ` ${s.minutes} min` : ''}, ${Object.keys(s.entries).length}/${(PROGRAM[s.day] || []).length} exercises`),
      daysSince: Object.fromEntries(['push', 'pull', 'legs'].map(d => [DAY_NAMES[d], lastOf(d) ? dayDiff(lastOf(d), today) : 'never'])) },
    exercises,
    bodyweight: bodyweight.filter(b => !b.deleted).sort((a, b) => a.date < b.date ? -1 : 1).slice(-10).map(b => `${b.date} ${b.weightKg} kg`),
    jarvisPlannedGym: gymBlocks.length ? { planned: gymBlocks.length, done: gymBlocks.filter(b => b.done).length, skipped: gymBlocks.filter(b => b.skipped).length } : null
  };
}

/** Nutrition Coach: phase, targets, weigh-ins and trends by its own rules, food logs vs targets, reviews. */
function nutritionStats({ today, profile = null, planVersions = [], measurements = [], foodLogs = [], reviews = [], phaseHistory = [] }) {
  const pv = planVersions.slice().sort((a, b) => (a.version || 0) - (b.version || 0)).pop() || null;
  const tgt = targetsOf(pv, profile);
  const M = measurements.filter(m => m && m.date && !m.demo).sort((a, b) => a.date < b.date ? -1 : 1);
  const series = f => M.filter(m => m[f] != null).map(m => ({ date: m.date, v: +m[f] }));
  const W = series('weightKg'), BF = series('bodyFatPct');
  const trend = (pts, end) => { const st = addDays(end, -6), xs = pts.filter(p => p.date >= st && p.date <= end); return xs.length >= NUTRITION_RULES.trendMinReadings ? round1(xs.reduce((a, p) => a + p.v, 0) / xs.length * 10) / 10 : null; };
  const logs = foodLogs.filter(l => l && l.date && dayDiff(l.date, today) < 14 && dayDiff(l.date, today) >= 0).sort((a, b) => a.date < b.date ? -1 : 1).map(l => {
    const meals = Object.values(l.meals || {}), eaten = meals.filter(m => m.actual);
    const mac = macrosOf(eaten.flatMap(m => m.actual));
    const custom = eaten.flatMap(m => m.actual).filter(x => x.custom).map(x => x.name);
    const status = !eaten.length ? 'not logged' : eaten.length < meals.length ? `${eaten.length}/${meals.length} meals logged`
      : tgt.calories && tgt.protein ? (Math.abs(mac.kcal - tgt.calories) <= tgt.calories * NUTRITION_RULES.greenCal && mac.protein >= tgt.protein * NUTRITION_RULES.greenProtein ? 'green'
        : Math.abs(mac.kcal - tgt.calories) <= tgt.calories * NUTRITION_RULES.adherenceCal && mac.protein >= tgt.protein * NUTRITION_RULES.adherenceProtein ? 'yellow' : 'red') : 'complete';
    const supps = Object.entries(l.supps || {}).filter(([, v]) => v).map(([k]) => k);
    return { date: l.date, status, kcal: mac.kcal, protein: mac.protein, ...(custom.length ? { offPlan: custom } : {}), supplementsTaken: supps.length };
  });
  return {
    phase: profile ? profile.phase : null, phaseStarted: profile ? profile.phaseStartDate : null, startBodyFat: profile ? profile.startBodyFat : null, flag: profile ? profile.flag : null,
    calories: profile ? profile.calories : null, caloriesReason: profile ? profile.caloriesReason : null,
    targets: { ...tgt, fromPlanVersion: pv ? pv.version : null, stillStartingPlan: !!(pv && pv.base), why: pv && pv.why ? pv.why : null },
    weighIns: { total: W.length, last7Days: W.filter(p => dayDiff(p.date, today) < 7).length, last: W.slice(-8).map(p => `${p.date} ${p.v} kg`),
      trend7: trend(W, today), trendWeekBefore: trend(W, addDays(today, -7)) },
    bodyFat: { total: BF.length, last7Days: BF.filter(p => dayDiff(p.date, today) < 7).length, last: BF.slice(-5).map(p => `${p.date} ${p.v}%`), trend7: trend(BF, today) },
    foodLogs: { daysLogged14: logs.filter(l => l.status !== 'not logged').length, days: logs },
    weeklyReviews: reviews.slice().sort((a, b) => a.reviewDate < b.reviewDate ? -1 : 1).slice(-4).map(r => ({ date: r.reviewDate, status: r.status, change: r.change, reason: r.reason })),
    phaseHistory: phaseHistory.slice(-3).map(h => ({ date: h.date, from: h.from, to: h.to, reason: h.reason }))
  };
}

/** Uni Planner: what's coming, what's open, what's unclear, how reminders are set, and study done in Jarvis's plans. */
function uniStats({ today, tz = 180, classes = [], events = [], plannerSettings = {}, plans = [] }) {
  const E = events.map(e => ({ ...e, l: localOf(e.due_at, tz) }));
  const label = e => `${e.course} ${e.title}${e.weight ? ` (${e.weight})` : ''}`;
  const studied = {};
  for (const p of plans) for (const b of (p.plan && p.plan.blocks) || []) if (b.ref && (b.type === 'study' || b.type === 'homework')) {
    const m = Math.max(0, (planMin(b.end) || 0) - (planMin(b.start) || 0)); const s = studied[b.ref] = studied[b.ref] || { planned: 0, done: 0, skipped: 0 };
    s.planned += m; if (b.done) s.done += m; if (b.skipped) s.skipped += m;
  }
  const ahead = E.filter(e => !e.done && GRADED.includes(e.kind) && dayDiff(today, e.l.date) >= 0 && dayDiff(today, e.l.date) <= 35).sort((a, b) => a.due_at < b.due_at ? -1 : 1);
  const weeks = [0, 1, 2, 3, 4].map(i => { const xs = ahead.filter(e => Math.floor(dayDiff(today, e.l.date) / 7) === i); return { from: addDays(today, 7 * i), items: xs.length, weightPct: xs.reduce((n, e) => n + pctOf(e.weight), 0) }; });
  const byDay = [0, 1, 2, 3, 4, 5, 6].map(d => { const cs = classes.filter(c => +c.weekday === d).sort((a, b) => a.start_time < b.start_time ? -1 : 1); return cs.length ? `${DAYS[d].slice(0, 3)} ${cs.length} classes ${String(cs[0].start_time).slice(0, 5)}–${String(cs[cs.length - 1].end_time).slice(0, 5)}` : null; }).filter(Boolean);
  return {
    term: { start: plannerSettings.term_start || null, end: plannerSettings.term_end || null, skipDates: plannerSettings.skip_dates || [] },
    timetable: byDay, courses: [...new Set(classes.map(c => c.course))],
    reminders: { beforeClass: plannerSettings.class_leads || null, dayBeforeAt: plannerSettings.day_before_time ? String(plannerSettings.day_before_time).slice(0, 5) : null, kinds: plannerSettings.event_kinds || null },
    next35Days: ahead.map(e => ({ item: label(e), kind: KIND_NAME[e.kind] || e.kind, due: `${dlong(e.l.date)} ${e.all_day ? '(no time)' : t12(e.l.min)}`, inDays: dayDiff(today, e.l.date),
      ...(e.note ? { note: e.note } : {}), ...(e.remind === false ? { reminderOff: true } : {}), ...(studied[e.id] ? { studyInJarvisPlans: studied[e.id] } : {}) })),
    weeks,
    pastDueNotTicked: E.filter(e => !e.done && GRADED.includes(e.kind) && e.l.date < today && dayDiff(e.l.date, today) <= 30).map(label),
    unclear: E.filter(e => !e.done && e.l.date >= today && (e.all_day && GRADED.includes(e.kind) || UNSURE.test(e.note || ''))).map(e => `${label(e)} ${dlong(e.l.date)} — ${e.note || 'no time set'}`),
    missingWeight: ahead.filter(e => !e.weight && ['exam', 'gca', 'quiz', 'lab', 'assignment', 'project'].includes(e.kind)).map(label),
    info: E.filter(e => (e.kind === 'info' || e.kind === 'academic') && dayDiff(today, e.l.date) >= -3 && dayDiff(today, e.l.date) <= 60).map(e => `${e.course} ${e.title} ${dlong(e.l.date)}${e.note ? ' — ' + e.note : ''}`)
  };
}

/** How his planned days actually went (done/skipped marks in Jarvis). */
function scheduleStats(plans, today) {
  const byType = {};
  for (const p of plans.filter(p => dayDiff(p.date, today) >= 0 && dayDiff(p.date, today) < 14)) for (const b of (p.plan && p.plan.blocks) || []) {
    if (['travel', 'free', 'class', 'exam'].includes(b.type)) continue;
    const t = byType[b.type] = byType[b.type] || { planned: 0, done: 0, skipped: 0 };
    t.planned++; if (b.done) t.done++; if (b.skipped) t.skipped++;
  }
  return { daysPlanned: plans.filter(p => dayDiff(p.date, today) >= 0 && dayDiff(p.date, today) < 14).length, byType,
    hisCookTimes: cookTimes(plans, today), lastWeek: howItWent(plans, today) };
}

export {
  toMin, fmt, t12, addDays, dayDiff, dowOf, DAYS, MON, dlong, localOf, planMin, clamp,
  ROTATION, DAY_NAMES, PROGRAM, EX_BY_ID, CATS, BACKOFF, nextDay, planSet1, pplEstimateMinutes, gymFor,
  FOODS, BASE_MEALS, SUPPLEMENTS, DINNER_WEEK, DAY_TYPE_LABEL, baseDay, macrosOf, mealsForDay, targetsOf, NUTRITION_RULES,
  dayNow, KIND_NAME, GRADED, PLACES, PLACE_NAME, isGym, isHome, makeDrive, interp, gymCrowds,
  OVERRIDE_TIMES, cleanOverrides, memoryFor, buildDay, dayFacts, driveTable,
  BLOCK_TYPES, appOf, readPlan, validatePlan, isBackground, planDiff, shiftForTraffic, routeOverruns, marginFor, PRIORITY_GROUPS,
  gymStats, nutritionStats, uniStats, scheduleStats,
  MEAL_KEYS, MEAL_NAME, NEEDS_COOKING, KEEPS_DAYS, DINNER_NAME, exerciseMinutes, cookedFoodsOf, mealOf, makesOf, tookOf, median, cookLabel, shortDay,
  cookTimes, cookedAhead, howItWent, pantryFacts, mealItems, swapMacros, weeklyGroceries, groceryDayOf,
  PERSONAL_CATEGORIES, HABIT_TRACKS, GOAL_TRACKS, NC_PROGRAM, bodyProgress, gradesProgress, habitCheck, goalTree, compactTree, pctOf
};
