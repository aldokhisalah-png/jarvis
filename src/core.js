// =====================================================================
// JARVIS CORE — what Jarvis does: plan a day, talk, remember, analyse each app, write the weekly report.
// The same code runs in the backend (Supabase + the Claude API) and in the preview (sample data + Claude in the page);
// only the adapters differ:
//   db     — reads his apps (never writes to them) and stores Jarvis's own things (plans, memory, messages, reviews, reports)
//   ai     — ai.json({ system, turns, schema, task }) → the parsed answer
//   places — places.drive({ settings, date, coords }) → { drive: makeDrive(...), startLoc }
//   clock  — clock.today() → 'YYYY-MM-DD', clock.nowMin() → minutes after local midnight
// =====================================================================
import * as E from './engine.js';
import * as B from './brain.js';

const RECENT_PLAN_DAYS = 21;

/** Raw rows from the three apps → the shapes the engine wants. Shared so backend and preview agree. */
function shapeApps({ pplRows = [], nutritionRows = [] }) {
  const kv = k => { const r = pplRows.find(r => r.kind === 'kv' && r.key === k); return r && r.body ? r.body.v : null; };
  const sessions = pplRows.filter(r => r.kind === 'session' && r.body && r.body.date).map(r => r.body).sort((a, b) => a.date < b.date ? -1 : 1);
  const N = k => nutritionRows.filter(r => r.kind === k && !r.deleted && r.body).map(r => r.body);
  return {
    ppl: { sessions, incs: kv('incs') || {}, lastCompleted: (kv('meta') || {}).lastCompleted || null, restDaysLogged: kv('restDays') || [],
      bodyweight: pplRows.filter(r => r.kind === 'bw' && r.body && !r.body.deleted).map(r => r.body) },
    nutrition: { profile: N('profile')[0] || null, planVersions: N('plan_version'), measurements: N('measurement'), foodLogs: N('food_log'), reviews: N('weekly_review'), phaseHistory: N('phase_history'), grocery: N('grocery_check') }
  };
}

function createJarvis({ db, ai, places, clock, planBudgetMs = Infinity }) {
  const today = () => clock.today();
  const weekday = d => E.DAYS[E.dowOf(d)];

  async function load() {
    const d = await db.load();
    const t = today();
    const lastSession = d.ppl.sessions[d.ppl.sessions.length - 1];
    const real = {};
    for (const day of ['push', 'pull', 'legs']) {
      const mins = d.ppl.sessions.filter(s => s.day === day && s._at).slice(-6).map(s => (Number(s._at) - Date.parse(s.date)) / 60000).filter(m => m >= 30 && m <= 180);
      if (mins.length) real[day] = mins.reduce((a, b) => a + b, 0) / mins.length;
    }
    const restDays = ((d.settings.prefs || {}).restDays) || [];
    const pv = d.nutrition.planVersions.slice().sort((a, b) => (a.version || 0) - (b.version || 0)).pop() || null;
    return { ...d, marks: d.marks || [], today: t, sessionMinutes: real, restDays, planVersion: pv,
      gymState: { lastCompleted: d.ppl.lastCompleted, lastSessionDate: lastSession ? E.dayNow(lastSession.date, 180).date : null, lastSessionDay: lastSession ? lastSession.day : null, restDays } };
  }

  /** Minutes of study for each deadline in days before `date`: on days already over, only what he marked done;
   *  on today and days still ahead, what's planned (and not skipped). A block he never marked didn't happen as far as Jarvis knows. */
  function priorWork(plans, date) {
    const out = {}, now = clock.today();
    for (const p of plans.filter(p => p.date < date)) for (const b of (p.plan && p.plan.blocks) || []) {
      if (!b.ref || b.skipped || !['study', 'homework'].includes(b.type)) continue;
      if (p.date < now && !b.done && E.tookOf(b) == null) continue;
      out[b.ref] = (out[b.ref] || 0) + Math.max(0, (E.planMin(b.end) || 0) - (E.planMin(b.start) || 0));
    }
    return out;
  }

  /** Where today's saved plan says he is at `now` (used when the phone can't tell us). */
  function placeFromPlan(saved, now) {
    if (!saved || now == null) return null;
    const bl = E.readPlan(saved).blocks.filter(b => b.s <= now);
    const cur = bl.filter(b => b.e > now && b.type !== 'travel' && E.PLACES.includes(b.loc)).pop();
    if (cur) return cur.loc;
    const lastDrive = bl.filter(b => b.type === 'travel' && E.PLACES.includes(b.to)).pop();
    const lastPlaced = bl.filter(b => b.type !== 'travel' && E.PLACES.includes(b.type === 'class' || b.type === 'exam' ? 'uni' : b.loc)).pop();
    if (lastDrive && (!lastPlaced || lastDrive.s >= lastPlaced.s)) return lastDrive.to;
    return lastPlaced ? (lastPlaced.type === 'class' || lastPlaced.type === 'exam' ? 'uni' : lastPlaced.loc) : null;
  }
  const dayInput = (d, date) => ({ date, today: d.today, classes: d.classes, events: d.events, plannerSettings: d.plannerSettings, gym: d.gymState, sessionMinutes: d.sessionMinutes,
    nutrition: { profile: d.nutrition.profile, planVersion: d.planVersion }, memory: d.memory, priorWork: priorWork(d.plans, date) });
  const hhmm = iso => E.fmt(E.localOf(iso, 180).min);
  const tapStatus = (b, eaten = []) => b.done ? (E.tookOf(b) ? `done, took ${E.tookOf(b)} min` : 'done') : b.skipped ? 'skipped'
    : b.type === 'meal' && eaten.includes(E.mealOf(b)) ? 'eaten (logged in Nutrition Coach)'
    : b.startedAt ? `he started it at ${hhmm(b.startedAt)}, never marked done` : 'not marked — unknown whether it happened';
  /** Meals he logged as eaten in Nutrition Coach on `date`. */
  const mealsLogged = (d, date) => { const l = ((d && d.nutrition && d.nutrition.foodLogs) || []).find(x => x && x.date === date); return l ? Object.entries(l.meals || {}).filter(([, m]) => m && Array.isArray(m.actual) && m.actual.length).map(([k]) => k) : []; };
  /** What already happened today (from today's saved plan and his taps), when planning from now. */
  function earlierToday(saved, now, date, eaten = []) {
    if (!saved || now == null) return null;
    const start = Math.ceil(now / 5) * 5, bl = E.readPlan(saved).blocks;
    const past = bl.filter(b => b.e <= start && b.type !== 'free');
    const did = b => b.done || E.tookOf(b) != null;
    return {
      blocks: past.map(b => `${b.start}–${b.end} ${b.type}: ${b.title}${b.type === 'cook' && E.makesOf(b, date).length ? ` (makes ${E.cookLabel(E.makesOf(b, date))})` : ''} — ${['travel', 'class', 'exam', 'wake', 'sleep'].includes(b.type) ? 'as planned, as far as Jarvis knows' : tapStatus(b, eaten)}`),
      // cooked today only if he marked the cooking done, or he's already logged that meal as eaten
      madeToday: [...new Set([...past.filter(b => b.type === 'cook' && did(b)).flatMap(b => E.makesOf(b, date).filter(m => m.date === date).map(m => m.meal)), ...eaten])],
      eatenToday: eaten,
      inProgress: bl.filter(b => b.s < start && b.e > start && !['free', 'wake', 'sleep'].includes(b.type)).map(b => ({ what: `${b.type}: ${b.title}`, planned: `${b.start}–${b.end}`, he: tapStatus(b) }))
    };
  }
  /** A quick look at a coming day: when classes run, the gym, dinner, what's due. */
  function sketch(d, date) {
    const day = E.buildDay(dayInput(d, date));
    return { date, weekday: day.dayName, classes: day.fixed.length ? `${E.fmt(day.fixed[0].start)}–${E.fmt(day.fixed[day.fixed.length - 1].end)}` : 'no classes',
      gym: day.gym.done ? 'done' : day.gym.chosenRest ? 'rest (his choice)' : E.DAY_NAMES[day.gym.workout], dinner: E.DINNER_NAME[E.DINNER_WEEK[day.dow]],
      ...(day.dueToday.length ? { due: day.dueToday.map(u => `${u.title}${u.weight ? ` (${u.weight})` : ''} at ${E.fmt(u.dueMin)}`) } : {}) };
  }
  /** His weekly grocery day: the day he picked, else the first day of the week without classes. */
  function groceryFor(d, date) {
    const pick = (d.settings.prefs || {}).groceryDay || null;
    const noClass = x => E.buildDay(dayInput(d, x)).fixed.length === 0;
    const gd = E.groceryDayOf(date, pick, noClass), next = gd >= date ? gd : E.groceryDayOf(E.addDays(date, 7), pick, noClass);
    const why = pick ? `his grocery day is ${pick}` : `he hasn't picked a grocery day, so it's the first day without classes each week (he can set one in the questionnaire)`;
    return gd === date ? { today: true, why, list: E.weeklyGroceries(E.addDays(date, 1), d.planVersion), coversUntil: E.addDays(date, 7) } : { today: false, next: `${E.DAYS[E.dowOf(next)]} ${next}`, why };
  }
  const pantryOf = (d, date) => E.pantryFacts({ pantry: (d.settings.prefs || {}).pantry || [], grocery: d.nutrition.grocery || [], plans: d.plans, date, today: d.today });
  async function dayFor(d, date, { nowMin = null, coords = null, saved = null, context = true, liveDrive = null } = {}) {
    const isToday = date === d.today;
    const where = await places.drive({ settings: d.settings, date, coords: isToday ? coords : null });
    const now = isToday && nowMin != null ? (nowMin < 180 ? nowMin + 1440 : nowMin) : null;
    const startLoc = isToday ? (where.startLoc || placeFromPlan(saved, now)) : 'home';
    const extra = context ? {
      kitchen: { cookTimes: E.cookTimes(d.plans, d.today), alreadyCooked: E.cookedAhead(date, d.plans, d.today), pantry: pantryOf(d, date) },
      swaps: (saved && saved.swaps) || [], earlier: earlierToday(saved, now, date, isToday ? mealsLogged(d, date) : []),
      nextDays: [1, 2, 3].map(i => sketch(d, E.addDays(date, i))), history: E.howItWent(d.plans, d.today), goals: goalsOf(d),
      grocery: groceryFor(d, date)
    } : {};
    const pr = d.settings.prefs || {};
    const travel = { arrivalBuffer: pr.arrivalBuffer ?? 5, learned: E.routeOverruns(d.plans), priorities: pr.priorities || ['university', 'gym', 'nutrition', 'sleep'], maidHours: pr.maidHours || null };
    const placesSet = Object.entries(d.settings.places || {}).filter(([k, p]) => E.PLACES.includes(k) && p && isFinite(+p.lat)).map(([k]) => k);
    return E.buildDay({ ...dayInput(d, date), nowMin: isToday ? nowMin : null, startLoc, drive: where.drive, liveDrive, travel, placesSet, crowds: E.gymCrowds(d.plans), ...extra });
  }
  /** After the checker: meal blocks carry the real macros of any change to the meal, and how to log it. */
  function finishBlock(b, day) {
    const meal = b.type === 'meal' ? E.mealOf(b) : null, planned = meal && day.food && day.food.meals.find(m => m.key === meal);
    if (!planned) return b;
    const mine = day.swaps.find(x => x.meal === meal);
    if (b.instead && !b.instead.fromHisChoice) {
      const info = E.swapMacros({ foods: b.instead.foods, buy: b.instead.buy }, planned);
      return { ...b, meal, instead: { ...b.instead, summary: info.foods, kcal: info.kcal, protein: info.protein, carbs: info.carbs, fat: info.fat, vsPlan: info.vsPlan, log: info.log, estimated: info.estimated } };
    }
    if (mine) return { ...b, meal, instead: { fromHisChoice: true, title: mine.title, summary: mine.foods, kcal: mine.kcal, protein: mine.protein, carbs: mine.carbs, fat: mine.fat, vsPlan: mine.vsPlan, log: mine.log, estimated: mine.estimated } };
    return { ...b, meal };
  }

  // ------------------------------------------------------------------ plan one day
  async function plan({ date, nowMin = null, coords = null, request = null, d = null, liveDrive = null }) {
    d = d || await load();
    date = date || d.today;
    const isToday = date === d.today;
    const saved = await db.getPlan(date);
    const day = await dayFor(d, date, { nowMin: isToday ? (nowMin ?? clock.nowMin()) : null, coords, saved, liveDrive });
    const facts = E.dayFacts(day);
    const keepPast = saved && day.start != null ? E.readPlan(saved).blocks.filter(b => b.e <= day.start) : [];
    const upcomingSaved = saved ? E.readPlan(saved).blocks.filter(b => day.start == null || b.e > day.start) : [];
    const current = request && upcomingSaved.length ? { summary: saved.summary, blocks: upcomingSaved.map(({ i, s, e, ...b }) => b) } : null;
    const p = B.PROMPTS.plan({ facts, current, request, today: d.today, weekday: weekday(d.today) });
    const turns = [{ role: 'user', content: p.user }];
    let v = null, plan = null, attempts = 0;
    const began = Date.now();
    const inProgress = upcomingSaved.filter(x => x.startedAt && !x.done && day.start != null && x.s < day.start);
    for (attempts = 1; attempts <= 3; attempts++) {
      if (attempts > 1 && Date.now() - began > planBudgetMs) break;          // out of time: report what's wrong instead
      plan = B.cleanPlan(await ai.json({ system: p.system, turns, schema: B.SCHEMA.plan, task: 'plan' }));
      // his taps survive a re-plan: done/skipped, and the timer on anything he's in the middle of
      for (const b of plan.blocks) {
        const o = upcomingSaved.find(x => x.start === b.start && x.title === b.title) || inProgress.find(x => x.type === b.type && x.title === b.title);
        if (o) for (const k of ['done', 'skipped', 'startedAt', 'doneAt', 'took']) if (o[k] != null && o[k] !== false) b[k] = o[k];
      }
      v = E.validatePlan(day, plan);
      if (v.ok) break;
      turns.push({ role: 'assistant', content: JSON.stringify(plan) }, { role: 'user', content: B.FIX_PROMPT(v.errors) });
    }
    if (!v.ok) { const err = new Error(`Jarvis couldn't make a plan that works: ${v.errors.slice(0, 2).join(' ')}`); err.errors = v.errors; throw err; }
    const blocks = [...keepPast.map(({ i, s, e, ...b }) => b), ...v.plan.blocks.map(({ i, s, e, ...b }) => finishBlock(b, day))];
    const out = { ...plan, blocks, swaps: (saved && saved.swaps) || [], problems: (saved && saved.problems) || [], changes: (saved && saved.changes) || [], madeAt: new Date().toISOString(), from: day.start == null ? 'wake' : E.fmt(day.start), startLoc: day.startLoc,
      traffic: day.drive.hasTraffic ? 'google' : day.drive.known ? 'map' : 'unknown', warnings: v.warnings, attempts, ...(request ? { request: request.slice(0, 300) } : {}) };
    await db.savePlan(date, out);
    return { date, plan: out, facts };
  }

  // ------------------------------------------------------------------ the week ahead (no AI: facts + saved plans)
  async function ahead({ d = null } = {}) {
    d = d || await load();
    const out = [];
    for (let i = 0; i < 7; i++) {
      const date = E.addDays(d.today, i);
      const day = await dayFor(d, date, { context: false });
      const saved = await db.getPlan(date);
      const bl = saved ? E.readPlan(saved).blocks : [];
      const at = t => { const b = bl.find(x => x.type === t); return b ? b.start : null; };
      const leave = bl.find(b => b.type === 'travel' && b.to === 'uni');
      out.push({ date, weekday: day.dayName, classes: day.fixed.length, first: day.fixed[0] ? E.fmt(day.fixed[0].start) : null, last: day.fixed.length ? E.fmt(day.fixed[day.fixed.length - 1].end) : null,
        gym: day.gym.done ? `${E.DAY_NAMES[day.gym.workout]} done` : day.gym.chosenRest ? 'Rest (your choice)' : E.DAY_NAMES[day.gym.workout], chosenRest: !!day.gym.chosenRest,
        due: day.dueToday.map(u => ({ title: u.title, weight: u.weight, at: E.fmt(u.dueMin) })), changes: day.memory.today.map(m => m.text),
        planned: !!saved, wake: at('wake'), leave: leave ? leave.start : null, gymAt: at('gym'), bed: at('sleep'), summary: saved ? saved.summary : null });
    }
    return out;
  }

  // ------------------------------------------------------------------ app stats (facts for the analysis)
  function stats(d) {
    const t = d.today;
    return {
      ppl: E.gymStats({ today: t, sessions: d.ppl.sessions, incs: d.ppl.incs, bodyweight: d.ppl.bodyweight, restDays: [...d.restDays, ...d.ppl.restDaysLogged], lastCompleted: d.ppl.lastCompleted, plans: d.plans }),
      nutrition: E.nutritionStats({ today: t, ...d.nutrition }),
      uni: E.uniStats({ today: t, classes: d.classes, events: d.events, plannerSettings: d.plannerSettings, plans: d.plans }),
      days: E.scheduleStats(d.plans, t)
    };
  }
  /** His big goals → the habits that serve them → his approximate rules, each with how it's really going. Computed once per load. */
  function goalsOf(d) {
    if (d._goals) return d._goals;
    const st = d._stats || (d._stats = stats(d));
    return (d._goals = E.goalTree({ memory: d.memory, today: d.today, gym: st.ppl, nutrition: st.nutrition, uni: st.uni, sessions: d.ppl.sessions,
      restDays: [...d.restDays, ...d.ppl.restDaysLogged], plans: d.plans, events: d.events, marks: d.marks }));
  }
  /** Memory for Claude when it may change it: the tree with ids, plus one-day changes. */
  const memoryView = d => ({ ...goalsOf(d), oneDayChanges: d.memory.filter(m => m.kind === 'day').map(m => ({ id: m.id, date: m.date, text: m.text, ...(m.overrides && Object.keys(m.overrides).length ? { mustKeep: m.overrides } : {}) })) });
  const goalsAndRules = d => E.compactTree(goalsOf(d));

  // ------------------------------------------------------------------ analyse one app
  async function review({ app, d = null, st = null }) {
    d = d || await load(); st = st || stats(d);
    const last = (await db.latestReviews())[app] || null;
    const context = app === 'ppl' ? { nutrition: { phase: st.nutrition.phase, calories: st.nutrition.calories, weighIns: st.nutrition.weighIns.last }, plannedGym: st.ppl.jarvisPlannedGym, timetable: st.uni.timetable }
      : app === 'nutrition' ? { training: { sessionsLast7: st.ppl.sessions.last7Days, list: st.ppl.sessions.list.slice(-5) }, timetable: st.uni.timetable, plannedMeals: st.days.byType.meal || null }
      : { training: { sessionsLast7: st.ppl.sessions.last7Days }, studyInJarvisPlans: { study: st.days.byType.study || null, homework: st.days.byType.homework || null } };
    const p = B.PROMPTS.review({ app, stats: st[app], memory: goalsAndRules(d), context, last, today: d.today, weekday: weekday(d.today) });
    const r = B.cleanReview(await ai.json({ system: p.system, turns: [{ role: 'user', content: p.user }], schema: B.SCHEMA.review, task: 'review' }));
    const row = { app, date: d.today, ...r, madeAt: new Date().toISOString() };
    await db.saveReview(app, row, st[app]);
    return row;
  }
  async function reviewAll() {
    const d = await load(), st = stats(d);
    const out = await Promise.allSettled(['ppl', 'nutrition', 'uni'].map(app => review({ app, d, st })));
    return Object.fromEntries(['ppl', 'nutrition', 'uni'].map((a, i) => [a, out[i].status === 'fulfilled' ? out[i].value : { error: String(out[i].reason && out[i].reason.message || out[i].reason) }]));
  }

  // ------------------------------------------------------------------ weekly report
  async function report() {
    const d = await load(), st = stats(d);
    const last = await db.latestReport();
    const p = B.PROMPTS.report({ stats: st, memory: goalsAndRules(d), last, today: d.today, weekday: weekday(d.today) });
    const r = B.cleanReport(await ai.json({ system: p.system, turns: [{ role: 'user', content: p.user }], schema: B.SCHEMA.report, task: 'report' }));
    await db.saveReport({ period_start: E.addDays(d.today, -6), period_end: d.today, report: r, stats: st });
    await db.saveMessage({ role: 'jarvis', kind: 'report', title: 'Your week', body: r.headline, data: r });
    return r;
  }

  // ------------------------------------------------------------------ live traffic
  /** A live check says the drive at raw index `i` takes `need` minutes (parking included). Small delays come out of
   *  flexible time before the drive; bigger ones (or he'd be late for something fixed) re-plan the rest of the day.
   *  Returns { action: 'ok' | 'shift' | 'replan' | 'alert', delay, title, message, plan }. */
  async function traffic({ date, i, need, nowMin = null, coords = null, source = 'check' }) {
    const d = await load();
    date = date || d.today;
    const now = nowMin ?? clock.nowMin();
    const saved = await db.getPlan(date), P = saved && E.readPlan(saved), b = P && P.blocks.find(x => x.i === +i);
    if (!b || b.type !== 'travel' || !isFinite(+need)) return { action: 'none' };
    need = Math.ceil(+need);
    const latest = b.e - need, delay = b.s - latest, where = E.PLACE_NAME[b.to] || b.to;
    const note = delay >= 3 ? `Traffic is heavier than planned: ${need} min now${b.to === 'uni' ? ' with parking' : ''}, ${delay} more than planned.` : delay <= -5 ? `Roads are clear: ${need} min now, ${-delay} less than planned — leave as planned and you're early.` : `Traffic as expected: ${need} min.`;
    const mark = async (p, extra = {}) => { p.blocks[+i] = { ...p.blocks[+i], liveMinutes: need, trafficNote: note, checkedAt: new Date().toISOString(), ...extra }; await db.savePlan(date, p); return p; };
    if (delay < 3) { await mark(saved); return { action: 'ok', delay, message: note }; }
    const snapshot = { id: `c${Date.now().toString(36)}`, at: new Date().toISOString(), why: `Traffic to ${where}: ${need} min (planned ${b.e - b.s})`, prevBlocks: saved.blocks };
    const sh = E.shiftForTraffic(saved, +i, latest, now);
    if (sh && delay <= (b.to === 'uni' ? 20 : 15)) {
      const ni = sh.blocks.findIndex(x => x.type === 'travel' && x.to === b.to && x.end === b.end);
      const msg = `Traffic +${delay} min: leave for ${where} at ${E.t12(latest)} instead of ${E.t12(b.s)}.${sh.changes.length ? ' ' + sh.changes.join('; ') + '.' : ' It comes out of free time.'}`;
      const p = { ...saved, blocks: sh.blocks, changes: [...(saved.changes || []).slice(-4), { ...snapshot, summary: msg }] };
      if (ni >= 0) p.blocks[ni] = { ...p.blocks[ni], liveMinutes: need, trafficNote: note, checkedAt: new Date().toISOString() };
      await db.savePlan(date, p);
      return { action: 'shift', delay, title: `Leave at ${E.t12(latest)} → ${where}`, message: msg, plan: p };
    }
    // too big to absorb, or he'd be late for something fixed: Claude re-plans the rest of the day around it
    const next = P.blocks.find(x => x.s >= b.e && ['class', 'exam', 'gym'].includes(x.type));
    const arrive = latest >= now ? b.e : now + need, late = next && arrive > next.s ? arrive - next.s : 0;
    const request = `Live traffic (${source}): the drive to ${where} now takes ${need} min (planned ${b.e - b.s}).${latest < now ? ` Leaving now he arrives at ${E.t12(now + need)}${late ? `, ${late} min after ${next.title} starts` : ''}.` : ` He has to leave by ${E.t12(latest)}.`} Re-plan the rest of the day around this. When time is short, protect in his order: ${((d.settings.prefs || {}).priorities || ['university', 'gym', 'nutrition', 'sleep']).join(' → ')} — take time from the last ones first.`;
    try {
      const r = await plan({ date, nowMin: now, coords, request, liveDrive: { to: b.to, minutes: need }, d });
      const lines = E.planDiff({ blocks: saved.blocks }, r.plan, now);
      const msg = `Traffic +${delay} min${late ? ` — you'd be ${late} min late for ${next.title}` : ''}. I re-planned the rest of today: ${lines.slice(0, 4).join('; ') || 'only the drive moved'}.`;
      r.plan.changes = [...(r.plan.changes || []).slice(-4), { ...snapshot, summary: msg }];
      await db.savePlan(date, r.plan);
      await db.saveMessage({ role: 'jarvis', body: msg, data: { replanned: date } });
      return { action: 'replan', delay, late, title: late ? `Leave now — you'll be ${late} min late for ${next.title}` : `Traffic +${delay} min — leave by ${E.t12(Math.max(now, latest))}, plan changed`, message: msg, plan: r.plan };
    } catch (e) {
      const msg = `Traffic +${delay} min to ${where}: ${latest >= now ? `leave by ${E.t12(latest)}` : `leave now — you'll arrive about ${E.t12(now + need)}`}. I couldn't re-plan the rest of the day just now.`;
      await mark(saved);
      return { action: 'alert', delay, title: `Leave ${latest >= now ? 'by ' + E.t12(latest) : 'now'} → ${where}`, message: msg };
    }
  }

  // ------------------------------------------------------------------ goals and marks
  async function goals() {
    const d = await load(), marked = new Set(d.marks.map(m => String(m.event_id)));
    return { ...goalsOf(d), marks: d.marks.map(m => ({ id: m.id, course: m.course, title: m.title, score: +m.score, outOf: +m.out_of, weight: m.weight })),
      markable: d.events.filter(e => E.GRADED.includes(e.kind) && (e.done || E.localOf(e.due_at, 180).date <= d.today) && !marked.has(String(e.id)))
        .map(e => ({ ref: e.id, label: `${e.course} ${e.title}${e.weight ? ` (${e.weight})` : ''}` })) };
  }
  async function addMark({ d = null, ref = null, course, title, weight = null, score, outOf }) {
    d = d || await load();
    const ev = ref ? d.events.find(e => String(e.id) === String(ref)) : null;
    const sc = +score, oo = +outOf;
    if (!isFinite(sc) || !isFinite(oo) || oo <= 0 || sc < 0 || sc > oo * 1.5) throw new Error('A mark needs a score and what it was out of.');
    course = String(ev ? ev.course : course || '').trim().slice(0, 40); title = String(ev ? ev.title : title || '').trim().slice(0, 200);
    if (!course || !title) throw new Error('Which item was it for?');
    const w = ev ? (E.pctOf(ev.weight) || null) : (isFinite(+weight) && +weight > 0 ? +weight : null);
    return db.insertMark({ event_id: ev ? String(ev.id) : null, course, title, weight: w, score: sc, out_of: oo });
  }

  // ------------------------------------------------------------------ the kitchen
  /** What he says about food at home. Plans for the next 3 days were made with the old kitchen, so they're rebuilt. */
  async function setPantry({ changes = [], d = null }) {
    d = d || await load();
    const prefs = { ...(d.settings.prefs || {}) };
    let list = (prefs.pantry || []).filter(x => x && E.FOODS[x.food]);
    const done = [];
    for (const c of changes.filter(c => c && E.FOODS[c.food])) {
      list = list.filter(x => x.food !== c.food);
      if (c.status === 'out' || c.status === 'low') list.push({ food: c.food, status: c.status, since: d.today, ...(c.note ? { note: String(c.note).slice(0, 120) } : {}) });
      done.push({ food: c.food, name: E.FOODS[c.food][0], status: c.status === 'out' || c.status === 'low' ? c.status : 'have' });
    }
    if (!done.length) return { pantry: list, changed: [], staleToday: false };
    prefs.pantry = list; await db.saveSettings({ prefs }); d.settings.prefs = prefs;
    await db.deletePlans([1, 2, 3].map(i => E.addDays(d.today, i)));
    // today needs a re-plan only if a meal still to come uses something he's now out of
    const t = await db.getPlan(d.today), out = new Set(list.filter(x => x.status === 'out').map(x => x.food)), n = clock.nowMin();
    const meals = t ? E.readPlan(t).blocks.filter(b => b.type === 'meal' && b.s > n && E.mealOf(b)) : [];
    const dayFood = E.mealsForDay(d.today, d.planVersion).meals;
    const staleToday = meals.some(b => { const m = dayFood.find(x => x.key === E.mealOf(b)); return m && m.items.some(it => out.has(it.food)); });
    if (staleToday) await db.savePlan(d.today, { ...t, stale: true });
    return { pantry: list, changed: done, staleToday };
  }
  async function kitchen() {
    const d = await load(), pf = pantryOf(d, d.today);
    return { cookTimes: E.cookTimes(d.plans, d.today), outOf: pf.outOf, groceryList: pf.groceryList, lastWeek: E.howItWent(d.plans, d.today) };
  }

  // ------------------------------------------------------------------ something got in the way: options, then his choice
  async function solve({ date, i = null, about = null, problem = '', missing = [], nowMin = null, coords = null, d = null }) {
    d = d || await load();
    date = date || d.today;
    const isToday = date === d.today;
    problem = String(problem || '').trim().slice(0, 600);
    missing = (missing || []).filter(f => E.FOODS[f]);
    if (!problem && !missing.length) throw new Error('Say what got in the way.');
    if (missing.length) await setPantry({ changes: missing.map(food => ({ food, status: 'out' })), d });     // he just told us
    const saved = await db.getPlan(date);
    if (!saved) throw new Error('Jarvis needs a plan for that day first.');
    let k = i != null && saved.blocks[i] ? +i : about ? saved.blocks.findIndex(b => b.start === about) : -1;
    const target = k >= 0 ? saved.blocks[k] : null;
    const day = await dayFor(d, date, { nowMin: isToday ? (nowMin ?? clock.nowMin()) : null, coords, saved });
    const facts = E.dayFacts(day);
    const meal = target ? (target.type === 'cook' ? (E.makesOf(target, date)[0] || {}).meal || null : E.mealOf(target)) : null;
    const planned = meal && day.food ? day.food.meals.find(m => m.key === meal) : null;
    const said = problem || `He's out of ${missing.map(f => E.FOODS[f][0]).join(', ')}.`;
    const p = B.PROMPTS.solve({ today: d.today, weekday: weekday(d.today), memory: goalsAndRules(d),
      problem: { said, ...(missing.length ? { heIsOutOf: missing.map(f => E.FOODS[f][0]) } : {}),
        block: target ? `${target.start}–${target.end} ${target.type}: ${target.title}${target.detail ? ` (${target.detail})` : ''}` : null,
        mealAffected: planned ? { key: planned.key, meal: planned.name, foods: planned.foods, kcal: planned.kcal, protein: planned.protein, carbs: planned.carbs, fat: planned.fat, needsCooking: planned.needsCooking.join(', ') || 'nothing' } : null },
      facts, current: E.readPlan(saved).blocks.filter(b => day.start == null || b.e > day.start).map(b => `${b.start}–${b.end} ${b.type}: ${b.title}${b.detail ? ` — ${b.detail}` : ''}${b.done ? ' (done)' : ''}`) });
    const r = B.cleanSolve(await ai.json({ system: p.system, turns: [{ role: 'user', content: p.user }], schema: B.SCHEMA.solve, task: 'solve' }));
    for (const o of r.options) {                                 // honest numbers for anything that changes what he eats
      const m = o.meal || ((o.foods.length || o.buy || ['faster', 'cooked', 'move', 'swap', 'buy'].includes(o.kind)) ? meal : null);
      const pm = m && day.food && day.food.meals.find(x => x.key === m);
      if (pm) { o.meal = m; o.food = E.swapMacros(o, pm); }
    }
    const entry = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), date,
      block: target ? { i: k, start: target.start, title: target.title } : null, problem: said, missing, ...r };
    const fresh = await db.getPlan(date) || saved;
    await db.savePlan(date, { ...fresh, problems: [...(fresh.problems || []).slice(-9), entry] });
    return entry;
  }
  async function choose({ date, id, option, nowMin = null, coords = null }) {
    const d = await load();
    date = date || d.today;
    const saved = await db.getPlan(date), pr = saved && (saved.problems || []).find(x => x.id === id), o = pr && pr.options[+option];
    if (!o) throw new Error('Those options are gone — ask again.');
    const changesFood = o.food && !o.food.sameFoodAsPlanned;
    const swaps = changesFood ? [...(saved.swaps || []).filter(x => x.meal !== o.meal), { meal: o.meal, title: o.title, kind: o.kind, how: o.how, items: o.food.items, buy: o.food.estimated ? o.buy : null,
      foods: o.food.foods, kcal: o.food.kcal, protein: o.food.protein, carbs: o.food.carbs, fat: o.food.fat, estimated: o.food.estimated, vsPlan: o.food.vsPlan, log: o.food.log,
      needsCooking: o.kind === 'cooked' || o.food.estimated ? 'nothing — ready to eat' : (E.cookedFoodsOf(o.food.items).join(', ') || 'nothing'), at: new Date().toISOString() }] : (saved.swaps || []);
    await db.savePlan(date, { ...saved, swaps, problems: saved.problems.map(x => x.id === id ? { ...x, chosen: +option } : x) });
    const request = `${pr.problem} He chose: "${o.title}" — ${o.how}${o.today ? ` What changes: ${o.today}` : ''}${changesFood ? ` (his ${E.MEAL_NAME[o.meal]} is now this — see heChoseInstead)` : ''}`;
    const r = await plan({ date, nowMin: date === d.today ? (nowMin ?? clock.nowMin()) : null, coords, request });
    const say = `Going with “${o.title}”.${o.food && changesFood ? ` ${o.food.log}` : ''}`;
    await db.saveMessage({ role: 'jarvis', body: say, data: { chose: { problem: pr.problem, option: o.title } } });
    return { ...r, chosen: o, say };
  }

  // ------------------------------------------------------------------ talk
  async function ask({ date, message, nowMin = null, coords = null }) {
    message = String(message || '').trim().slice(0, 1500);
    if (!message) throw new Error('Say something first.');
    const d = await load();
    date = date || d.today;
    await db.saveMessage({ role: 'user', body: message });
    const saved = await db.getPlan(date);
    const day = await dayFor(d, date, { nowMin: date === d.today ? (nowMin ?? clock.nowMin()) : null, coords, saved });
    const st = stats(d), reviews = await db.latestReviews();
    const context = {
      lookingAt: { date, weekday: day.dayName, facts: E.dayFacts(day),
        plan: saved ? { summary: saved.summary, notes: saved.notes, blocks: E.readPlan(saved).blocks.map(b => `${b.start}–${b.end} ${b.type}: ${b.title}${b.done ? ' (done)' : ''}${b.skipped ? ' (skipped)' : ''}`) } : 'not planned yet' },
      weekAhead: await ahead({ d }),
      apps: { ppl: { rotation: st.ppl.rotation, sessions: st.ppl.sessions, exercises: st.ppl.exercises.filter(x => x.logged) }, nutrition: st.nutrition, uni: { next35Days: st.uni.next35Days.slice(0, 15), pastDueNotTicked: st.uni.pastDueNotTicked, unclear: st.uni.unclear } },
      yourLatestAnalysis: Object.fromEntries(Object.entries(reviews).map(([k, r]) => [k, r ? { date: r.date, status: r.status, headline: r.headline, changes: r.changes } : null]))
    };
    const history = (await db.recentMessages(12)).slice(0, -1).map(m => `${m.role === 'user' ? 'Salah' : 'Jarvis'}: ${String(m.body || '').slice(0, 600)}`);
    const p = B.PROMPTS.ask({ context, memory: memoryView(d), history, message, today: d.today, weekday: weekday(d.today) });
    const a = B.cleanAsk(await ai.json({ system: p.system, turns: [{ role: 'user', content: p.user }], schema: B.SCHEMA.ask, task: 'ask' }));

    // ---- act on it (Jarvis's own tables only) ----
    const changes = [], stale = new Set();
    for (const id of a.forget) {
      const gone = await db.deleteMemory(id);
      if (gone) { changes.push({ op: 'forgot', kind: gone.kind, text: gone.text, date: gone.date || null }); if (gone.kind === 'day') stale.add(gone.date); else if (gone.kind !== 'goal') stale.add('*'); }
    }
    const goalIds = new Set(d.memory.filter(m => m.kind === 'goal').map(m => String(m.id))), proposals = [];
    for (const m of a.remember) {
      const row = { kind: m.kind, text: m.text, source: 'chat' };
      if (m.kind === 'rule' || m.kind === 'habit') { row.strength = m.strength; row.serves = m.serves.filter(id => goalIds.has(id)); }
      if (m.kind === 'rule') { row.category = m.category || 'other'; if (m.course) row.course = m.course; }
      if (m.kind === 'habit' && E.HABIT_TRACKS.includes(m.track)) row.track = m.track;
      if (m.kind === 'goal') { if (E.GOAL_TRACKS.includes(m.track)) row.track = m.track; if (m.target) row.target = m.target; }
      if (m.kind !== 'day') {                                                     // lasting: he decides — Add to Personal, or not
        const old = m.replaces && d.memory.find(x => String(x.id) === m.replaces && x.kind !== 'day');
        proposals.push({ pid: `s${Date.now().toString(36)}${proposals.length}`, row, ...(old ? { replaces: old.id, replacesText: old.text } : {}) });
        continue;
      }
      row.date = m.date || date; if (row.date < d.today) continue; row.overrides = E.cleanOverrides(m.mustKeep); stale.add(row.date);
      const saved = await db.insertMemory(row);
      changes.push({ op: 'saved', kind: saved.kind, strength: saved.strength || null, text: saved.text, date: saved.date || null, overrides: saved.overrides || {} });
    }
    for (const k of a.marks) {                                                // marks he tells Jarvis (Uni Planner has no scores)
      const ev = k.ref ? d.events.find(e => String(e.id) === String(k.ref)) : null;
      const row = await addMark({ d, ref: ev ? ev.id : null, course: ev ? ev.course : k.course, title: ev ? ev.title : k.title, weight: ev ? E.pctOf(ev.weight) || null : k.weight, score: k.score, outOf: k.outOf });
      if (row) changes.push({ op: 'mark', text: `${row.course} ${row.title}: ${row.score}/${row.out_of}` });
    }
    let pantry = null;
    if (a.pantry.length) {
      pantry = await setPantry({ changes: a.pantry, d });
      for (const c of pantry.changed) changes.push({ op: 'pantry', text: c.status === 'have' ? `${c.name}: back in stock` : `${c.name}: ${c.status === 'low' ? 'running low' : 'out'}` });
    }
    if (a.restDay) {
      const prefs = { ...(d.settings.prefs || {}) }, set = new Set(prefs.restDays || []);
      a.restDay.rest ? set.add(a.restDay.date) : set.delete(a.restDay.date);
      prefs.restDays = [...set].filter(x => x >= E.addDays(d.today, -60)).sort();
      await db.saveSettings({ prefs });
      changes.push({ op: a.restDay.rest ? 'rest' : 'train', date: a.restDay.date });
      for (let i = 0; i < 7; i++) stale.add(E.addDays(a.restDay.date, i));            // the rotation shifts from that day on
    }
    // plans that no longer match what he said are dropped and rebuilt when he next opens them
    const future = [...Array(14)].map((_, i) => E.addDays(d.today, i));
    const drop = stale.has('*') ? future : future.filter(x => stale.has(x));
    const replan = a.replan && a.replan >= d.today ? a.replan : null;
    const toDrop = drop.filter(x => x !== replan && x !== d.today);              // today keeps what already happened
    if (toDrop.length) await db.deletePlans(toDrop);
    const staleToday = drop.includes(d.today) && replan !== d.today;
    if (staleToday) { const sp = await db.getPlan(d.today); if (sp) await db.savePlan(d.today, { ...sp, stale: true }); }

    let reply = a.reply, newPlan = null, solutions = null;
    if (a.problem && await db.getPlan(date)) {                 // options first; the day is re-planned when he picks one
      try { solutions = await solve({ date, about: a.problemAbout, problem: a.problem, nowMin, coords }); }
      catch (e) { reply += `\n\n(I couldn't work out options just now — ${e.message})`; }
    } else if (replan) {
      try { newPlan = (await plan({ date: replan, nowMin: replan === d.today ? (nowMin ?? clock.nowMin()) : null, coords, request: message })).plan; }
      catch (e) { reply += `\n\n(I couldn't rebuild ${replan === d.today ? 'today' : 'that day'} just now — ${e.message.replace(/^Jarvis couldn't make a plan that works: /, '')} Your saved plan is unchanged; try again in a moment.)`; }
    }
    await db.saveMessage({ role: 'jarvis', body: reply, data: changes.length || replan || solutions || proposals.length ? { memory: changes, replanned: newPlan ? replan : null, ...(solutions ? { solutions } : {}), ...(proposals.length ? { proposals } : {}) } : null });
    return { reply, memory: changes, proposals, replanned: newPlan ? replan : null, plan: newPlan && replan === date ? newPlan : null, dropped: toDrop,
      staleToday: !solutions && (staleToday || !!(pantry && pantry.staleToday)), solutions };
  }

  return { load, plan, ahead, review, reviewAll, report, ask, stats, dayFor, solve, choose, setPantry, kitchen, goals, addMark, traffic };
}

export { createJarvis, shapeApps };
