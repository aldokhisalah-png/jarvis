// =====================================================================
// JARVIS — the app. Opens on today's schedule; Ahead, Apps and Ask are one tap away.
// Everything Jarvis decides comes from Claude through the backend adapter (live: Supabase + the jarvis function;
// preview: the same core running in the page). This file only shows it and sends what Salah does.
// =====================================================================
import { buildQuestions, answersToChanges, SECTIONS, answered } from './questionnaire.js';
import { dayNow, toMin, planMin, t12, addDays, dayDiff, dowOf, DAYS, MON, appOf, localOf, FOODS, baseDay, DINNER_WEEK, mealOf, makesOf, tookOf, PLACES, PLACE_NAME, isGym } from './engine.js';

let B = null;                     // the backend adapter
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const here = () => dayNow(new Date().toISOString(), 180);               // Kuwait time, whatever the device says; until 3am it's still last night
const today = () => here().date;
const nowM = () => here().min;
const longDate = d => `${DAYS[dowOf(d)]} ${+d.slice(8)} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+d.slice(5, 7) - 1]}`;
const relDay = d => { const n = dayDiff(today(), d); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : DAYS[dowOf(d)]; };
const T = hhmm => hhmm ? t12(toMin(hhmm)) : '';
const dur = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
const until = m => m <= 0 ? 'now' : m < 60 ? `in ${m} min` : `in ${dur(m)}`;
const PLACE = PLACE_NAME;
const PLACE_LABEL = { home: 'Home', grandma: 'Grandmother’s home', uni: 'University', gym: 'Gym', gym_rigae: 'Oxygen Gym — Rigae', gym_mahboula: 'Oxygen Gym — Mahboula', gym_sabah: 'Oxygen Gym — Sabah Al-Salem' };
const PLACE_QUERY = { uni: 'American University of the Middle East', gym_rigae: 'Oxygen Gym Rigae', gym_mahboula: 'Oxygen Gym Mahboula', gym_sabah: 'Oxygen Gym Sabah Al Salem' };
const APP_NAME = { ppl: 'PPL Coach', nutrition: 'Nutrition Coach', uni: 'Uni Planner' };
const ICON = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'
};
let toastT;
function toast(msg, ms = 3400) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

const st = {
  user: null, tab: 'today', date: today(), plan: null, planState: 'idle', planError: null, planStarted: 0,
  ahead: null, reviews: null, reviewing: false, thread: null, memory: [], settings: { places: {}, prefs: {} },
  open: new Set(), showEarlier: false, sending: false, reply: null, progress: '', coords: null, eta: null, find: {}, paste: null, err: '',
  push: { supported: false, subscribed: false, perm: 'default' },
  packed: new Set(), took: null, problem: null, solving: null, kitchen: null, pantryPick: '', goals: null, editing: null, qn: null, crowdAsk: null
};

// ------------------------------------------------------------------ data
async function loadPlan(date) {
  st.plan = null; st.planError = null; st.planState = 'loading'; st.open.clear(); st.showEarlier = false; render();
  try { st.plan = await B.getPlan(date); } catch (e) { st.planError = e.message; }
  st.planState = 'idle';
  if (date === today() && !st.planError && (!st.plan || st.plan.stale)) return makePlan(date);   // today always has an up-to-date plan
  render(); updateEta();
}
async function makePlan(date, fromNow = true, request = null) {
  if (st.planState === 'planning') return;
  st.planState = 'planning'; st.planError = null; st.progress = ''; st.planStarted = Date.now(); render();
  if (!st.ahead) loadAhead(true);
  try {
    const isToday = date === today();
    const r = await B.call('plan', { date, nowMin: isToday && fromNow ? here().min : undefined, coords: isToday ? st.coords : undefined, ...(request ? { request } : {}) });
    if (date === st.date) st.plan = r.plan;
    loadAhead(true);
  } catch (e) { st.planError = e.message; }
  st.planState = 'idle'; render(); updateEta();
}
async function loadAhead(quiet) { try { st.ahead = (await B.call('ahead', {})).days; } catch (e) { if (!quiet) toast(e.message); } if (!quiet || st.tab === 'ahead') render(); }
async function loadReviews(auto) {
  try { st.reviews = await B.latestReviews(); } catch (e) { st.reviews = { ppl: null, nutrition: null, uni: null }; }
  render();
  if (auto && Object.values(st.reviews).every(r => !r)) analyse();
}
async function analyse(app) {
  if (st.reviewing) return;
  st.reviewing = app || 'all'; render();
  try { const r = await B.call('review', app ? { app } : {}); for (const [k, v] of Object.entries(r)) if (v && !v.error) st.reviews[k] = v; const bad = Object.values(r).find(v => v && v.error); if (bad) toast(bad.error, 6000); }
  catch (e) { toast(e.message, 6000); }
  st.reviewing = false; render();
}
async function loadThread() { try { st.thread = await B.listMessages(80); } catch { st.thread = []; } render(); scrollThread(); }
async function loadMemory() { try { st.memory = await B.listMemory(); } catch { } }
async function ask(message) {
  message = String(message || '').trim(); if (!message || st.sending) return;
  const inp = $('#ask-in'); if (inp) inp.value = '';
  if (!st.thread) st.thread = [];
  st.thread.push({ role: 'user', body: message, created_at: new Date().toISOString() });
  st.sending = true; if (st.tab === 'today') st.reply = { q: message, a: null, mem: [] };
  render(); scrollThread();
  try {
    const isToday = st.date === today();
    const r = await B.call('ask', { date: st.date, message, nowMin: isToday ? here().min : undefined, coords: isToday ? st.coords : undefined });
    const props = r.proposals || [];
    st.thread.push({ role: 'jarvis', body: r.reply, data: { memory: r.memory, replanned: r.replanned, solutions: r.solutions || null, proposals: props }, created_at: new Date().toISOString() });
    if (st.reply) Object.assign(st.reply, { a: r.reply, mem: r.memory || [], solutions: r.solutions || null, proposals: props });
    if (r.solutions && r.solutions.date === st.date && st.plan) st.plan.problems = [...(st.plan.problems || []), r.solutions];
    if (r.plan) st.plan = r.plan;
    else if (r.staleToday && st.date === today()) makePlan(st.date);
    else if ((r.dropped || []).includes(st.date)) st.plan = null;
    if ((r.memory || []).length) await loadMemory();
    loadAhead(true);
  } catch (e) {
    const say = `I couldn't answer just now (${e.message}). Nothing changed.`;
    st.thread.push({ role: 'jarvis', body: say, created_at: new Date().toISOString() });
    if (st.reply) st.reply.a = say;
  }
  st.sending = false; render(); scrollThread(); updateEta();
}
async function weeklyReport() {
  if (st.sending) return;
  st.thread = st.thread || []; st.thread.push({ role: 'user', body: 'Write my weekly report', created_at: new Date().toISOString() });
  st.sending = true; render(); scrollThread();
  try { const r = await B.call('report', {}); st.thread.push({ role: 'jarvis', kind: 'report', title: 'Your week', body: r.report.headline, data: r.report, created_at: new Date().toISOString() }); }
  catch (e) { st.thread.push({ role: 'jarvis', body: `I couldn't write it just now (${e.message}).`, created_at: new Date().toISOString() }); }
  st.sending = false; render(); scrollThread();
}
const scrollThread = () => { if (st.tab === 'ask') setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 40); };

// ------------------------------------------------------------------ location
// Only his phone reports where he is — it's the device that travels with him. A laptop's position is often
// a guess from Wi-Fi, or it's sitting at home while he's out, so on a laptop Jarvis goes by where the plan has him.
const ON_PHONE = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
function locate() {
  if (!ON_PHONE || !('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(p => { st.coords = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }; updateEta(); }, () => { }, { maximumAge: 120000, timeout: 15000 });
}
async function updateEta() {
  if (!st.coords || !st.plan || st.date !== today() || B.mode === 'preview') return;
  const n = nowM(), tr = blocks(st.plan).find(b => b.type === 'travel' && b.s >= n - 5 && b.s - n <= 120);
  if (!tr) { st.eta = null; return; }
  const key = `${tr.to}@${tr.start}`;
  if (st.eta && st.eta.key === key && Date.now() - st.eta.at < 180000) return;
  try {
    const r = await B.call('eta', { coords: st.coords, to: tr.to });
    if (r.minutes == null) return;
    st.eta = { key, minutes: r.minutes, live: r.live, at: Date.now(), arriveBy: tr.e }; render();
    // the drive no longer fits: Jarvis shifts the leave time or re-plans, and says what changed
    const latest = tr.e - r.minutes; st.trafficAt = st.trafficAt || {};
    if (latest < tr.s - 3 && (!st.trafficAt[key] || Date.now() - st.trafficAt[key] > 5 * 60000) && st.planState === 'idle') {
      st.trafficAt[key] = Date.now();
      const t = await B.call('traffic', { date: st.date, i: tr.i, to: tr.to, coords: st.coords, nowMin: here().min });
      if (t.plan) st.plan = t.plan;
      if (t.message && t.action !== 'ok') toast(t.message, 9000);
      render();
    }
  } catch { }
}

// ------------------------------------------------------------------ render
const blocks = p => (p && p.blocks || []).map((b, i) => { const s = planMin(b.start), e0 = planMin(b.end); return { ...b, i, s, e: e0 < s ? e0 + 1440 : e0 }; }).sort((a, b) => a.s - b.s || a.e - b.e);
const tt = m => m == null ? '—' : esc(t12(m)).replace(/(am|pm)$/, '<small>$1</small>');
const DOTS = '<span class="dots"><i></i><i></i><i></i></span>';
const LIVE_DOTS = '<span class="dots live"><i></i><i></i><i></i></span>';
const NAV = [['today', 'Today'], ['ahead', 'Week'], ['ask', 'Conversation'], ['physique', 'Physique'], ['uni', 'Uni'], ['personal', 'What I know']];
const GLYPH = {
  today: '<span class="g g-clock"></span>', ahead: '<span class="g g-week"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>', ask: DOTS,
  physique: '<span class="g g-dots"><i style="background:var(--gym)"></i><i style="background:var(--food)"></i></span>', uni: '<span class="g g-dots"><i style="background:var(--uni)"></i></span>',
  personal: '<span class="g g-me">S</span>', goals: '<span class="g g-target"></span>', settings: '<span class="g g-sq"></span>'
};
const head = (eb, title, sub) => `<header class="head"><div class="eb">${eb}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
const nextDrive = () => st.plan && st.date === today() ? blocks(st.plan).find(b => b.type === 'travel' && b.s >= nowM() - 5) : null;
function statusText() {
  if (st.planState === 'planning') return 'Planning your day…';
  const mem = k => st.memory.filter(m => m.kind === k).length;
  if (st.tab === 'today') { const tr = nextDrive(); return tr ? `Watching your ${t12(tr.s)} drive` : st.plan ? 'Your day is planned' : 'Ready to plan'; }
  if (st.tab === 'ahead') return 'I plan each day the evening before';
  if (st.tab === 'ask') return `Knows ${st.memory.filter(m => m.kind !== 'day').length} things about you`;
  if (st.tab === 'physique') return 'Reading PPL Coach and Nutrition Coach';
  if (st.tab === 'uni') return 'Reading Uni Planner';
  return `${mem('rule')} rules · ${mem('habit')} habits · ${mem('goal')} goals`;
}
function render() {
  const app = $('#app');
  if (!st.user) { document.body.classList.remove('in'); app.innerHTML = viewLogin(); return; }
  document.body.classList.add('in');
  if (!$('#main')) app.innerHTML = `${side()}<div class="stage">${B.banner ? `<div class="banner">${esc(B.banner)}</div>` : ''}<div class="topbar"><img src="icons/maskable-512.png" alt=""><span class="status"><span class="pulse"></span><span id="status"></span></span><button class="ibtn" data-act="you" aria-label="Places and settings">${ICON.gear}</button></div><div class="wrap" id="main"></div></div>${dock()}${tabbar()}`;
  // keep anything he's typing when the page re-draws (data arriving in the background)
  const kept = [...document.querySelectorAll('#main input[id], #main textarea[id], #main select[id]')].filter(el => el.type !== 'checkbox').map(el => [el.id, el.value, document.activeElement === el]);
  $('#main').innerHTML = ({ today: viewToday, ahead: viewAhead, physique: viewPhysique, uni: viewUni, ask: viewAsk, personal: viewPersonal })[st.tab]();
  for (const [id, v, focus] of kept) { const el = document.getElementById(id); if (el && v && el.value !== v && !el.dataset.fresh) { el.value = v; if (focus) el.focus(); } }
  document.querySelectorAll('[data-tab]:not(body)').forEach(b => b.classList.toggle('on', b.dataset.goals ? ['physique', 'uni'].includes(st.tab) : b.dataset.tab === st.tab));
  $('#status').textContent = statusText();
  const ss = $('#side-status'); if (ss) ss.innerHTML = sideWatch();
  $('#quick').innerHTML = quick();
  const inp = $('#ask-in'); if (inp) { inp.placeholder = st.tab === 'ask' ? 'Message Jarvis' : 'Tell Jarvis what changed'; $('#ask-go').disabled = st.sending; }
  document.body.dataset.tab = st.tab;
  $('.dock').style.display = ['today', 'ask'].includes(st.tab) ? '' : 'none';
}
const navBtn = ([k, l]) => `<button class="nav" data-tab="${k}">${GLYPH[k]}<span>${l}</span></button>`;
function side() {
  return `<aside class="side"><div class="brand"><img src="icons/maskable-512.png" alt=""><div><b>Jarvis</b><small>Chief of staff</small></div></div>
    <button class="askbar" data-act="focus-ask">${DOTS}<span>Tell Jarvis what changed</span><kbd>⌘K</kbd></button>
    <nav class="snav">${NAV.slice(0, 3).map(navBtn).join('')}<h6>Goals</h6>${NAV.slice(3, 5).map(navBtn).join('')}<h6>You</h6>${navBtn(NAV[5])}<button class="nav" data-act="you">${GLYPH.settings}<span>Places and settings</span></button></nav>
    <div class="side-foot" id="side-status"></div></aside>`;
}
function sideWatch() {
  const tr = nextDrive();
  const w = st.planState === 'planning' ? ['Planning', 'Your day', 'About a minute'] : tr ? ['Watching', `Your ${t12(tr.s)} drive to ${PLACE[tr.to] || tr.to}`, 'Re-checked against live traffic'] : ['Ready', st.plan ? 'Your day is planned' : 'Nothing planned yet', 'Tell me if anything changes'];
  return `<div class="watch"><span class="eb"><span class="pulse"></span>${w[0]}</span><b>${esc(w[1])}</b><small>${esc(w[2])}</small></div>
    <ul class="apps"><li><i style="background:var(--gym)"></i>PPL Coach</li><li><i style="background:var(--food)"></i>Nutrition Coach</li><li><i style="background:var(--uni)"></i>Uni Planner</li></ul>`;
}
function dock() {
  return `<div class="dock"><div class="in"><div class="quick" id="quick"></div>
    <form class="ask" id="ask-form" autocomplete="off">${DOTS}<input id="ask-in" enterkeyhint="send" maxlength="1500" aria-label="Message Jarvis"><button id="ask-go" aria-label="Send">${ICON.send}</button></form></div></div>`;
}
function tabbar() {
  return `<nav class="tabbar"><button data-tab="today">${GLYPH.today}<span>Today</span></button><button data-tab="ahead">${GLYPH.ahead}<span>Week</span></button>
    <button data-tab="ask" class="me" aria-label="Ask Jarvis"><img src="icons/maskable-512.png" alt=""></button>
    <button data-tab="physique" data-goals="1">${GLYPH.goals}<span>Goals</span></button><button data-tab="personal">${GLYPH.personal}<span>You</span></button></nav>`;
}
function quick() {
  if (st.tab === 'ask') return `<button data-act="report">Write my weekly report</button>` + ['What should I focus on this week?', 'How is my cut going?', 'Anything I’m missing?', 'What do you remember about me?'].map(q => `<button data-quick="${esc(q)}">${esc(q)}</button>`).join('');
  if (st.tab !== 'today') return '';
  const list = st.date === today() ? ['I’m running 20 min late', 'Too tired for the gym today', 'Move the gym later tonight', 'What do I need to bring?'] : ['Make this a rest day', 'I have plans in the evening', 'Start this day later'];
  return list.map(q => `<button data-quick="${esc(q)}">${esc(q)}</button>`).join('');
}
const top = extra => extra ? `<div class="pagebar">${extra}</div>` : '';

function viewLogin() {
  return `<form class="login" id="login"><div class="login-hero"><img src="icons/maskable-512.png" alt="Jarvis"><h1>Jarvis</h1><p>Your chief of staff.</p>
    <div class="appchips"><span><i style="background:var(--gym)"></i>PPL Coach</span><span><i style="background:var(--food)"></i>Nutrition Coach</span><span><i style="background:var(--uni)"></i>Uni Planner</span></div>
    <small>I read all three every time I plan. I never write to them.</small></div>
    <div class="login-form"><div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="email" required></div>
    <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <button class="btn pri big">Sign in</button>${st.err ? `<p class="err">${esc(st.err)}</p>` : ''}<small>Same account as PPL Coach, Nutrition Coach and Uni Planner</small></div></form>`;
}

// ----- today -----
function viewToday() {
  const isToday = st.date === today(), p = st.plan;
  const nav = `<div class="daynav"><button class="ibtn" data-act="day" data-d="-1" aria-label="Previous day">${ICON.prev}</button><button class="chip ${isToday ? 'on' : ''}" data-act="goto-today">Today</button><button class="ibtn" data-act="day" data-d="1" aria-label="Next day">${ICON.next}</button></div>`;
  const made = p && p.madeAt ? localOf(p.madeAt, 180) : null, c = p ? checksOf(p) : null;
  const line = p ? `<span class="okdot ${c.bad.length ? 'warn' : ''}"></span>Planned ${made ? `${relDay(made.date).toLowerCase()} at ${t12(made.min)}` : ''}${p.traffic === 'google' ? ' with live traffic' : p.traffic === 'map' ? ' with map drive times' : ''} · ${c.bad.length ? `${c.bad.length} rule${c.bad.length > 1 ? 's' : ''} I couldn’t keep` : 'every check holds'}` : '';
  const title = p && p.summary ? p.summary : isToday ? 'Today' : relDay(st.date);
  let h = `<header class="head today-head"><div class="ht"><div class="eb">${esc(longDate(st.date))}${isToday ? '' : ` · ${esc(relDay(st.date))}`}</div><h1 class="${title.length > 60 ? 'long' : ''}">${esc(title)}</h1>${line ? `<p class="line">${line}</p>` : ''}</div><div class="hb">${nav}${p && st.planState === 'idle' ? `<button class="btn sm pri" data-act="replan">${isToday ? 'Re-plan from now' : 'Re-plan this day'}</button>` : ''}</div></header>`;
  if (st.reply) h += replyCard();
  if (st.planState === 'loading') return h + `<p class="empty">Reading your plan…</p>`;
  if (st.planState === 'planning') return h + thinking();
  if (!p) {
    return h + `${st.planError ? `<section class="card note alert"><span class="eb">Couldn’t plan</span><p>${esc(st.planError)}</p></section>` : ''}
      <section class="card blank"><p>${isToday ? 'I haven’t planned today yet.' : `I haven’t planned ${esc(relDay(st.date) === 'Tomorrow' ? 'tomorrow' : DAYS[dowOf(st.date)])} yet. I plan tomorrow for you every evening.`}</p>
      <button class="btn pri" data-act="make">${isToday ? 'Plan my day' : 'Plan this day now'}</button></section>`;
  }
  const n = isToday ? nowM() : null;
  return h + `<div class="today-grid"><div class="col-hero">${hero(p, n)}</div><div class="col-side">${notes(p)}${foresight(p)}${checks(p)}</div>
    <div class="col-plan">${timeline(p, n)}<div class="made">Planned by Jarvis${made ? ` ${relDay(made.date).toLowerCase()} at ${t12(made.min)}` : ''} · <button class="link" data-act="replan">${isToday ? 'Re-plan from now' : 'Re-plan this day'}</button></div></div></div>`;
}
function thinking() {
  const a = (st.ahead || []).find(d => d.date === st.date);
  const facts = a ? [a.classes ? `${a.classes} class${a.classes > 1 ? 'es' : ''}, ${T(a.first)} to ${T(a.last)}` : 'No classes', a.gym === 'Rest' ? 'PPL Coach shows a rest day' : `${a.gym} in PPL Coach`, ...a.due.map(d => `${d.title}${d.weight ? ` (${d.weight})` : ''} due ${T(d.at)}`), ...a.changes.map(c => `You said: “${c}”`)] : ['Your timetable and deadlines', 'PPL Coach’s next workout', 'Nutrition Coach’s meals for the day'];
  const secs = Math.round((Date.now() - st.planStarted) / 1000);
  return `<section class="card thinking"><span class="eb">${LIVE_DOTS}Planning</span><h2>I’m planning ${st.date === today() ? 'your day' : 'this day'}.</h2>
    <ul>${facts.map(f => `<li>${esc(f)}</li>`).join('')}<li>Your rules and goals</li><li>Drive times between home, uni and the gym</li></ul>
    <p class="live"><span id="prog">${esc(st.progress || (secs < 8 ? 'Reading your apps…' : 'Thinking it through — this takes about a minute.'))}</span></p></section>`;
}
function replyCard() {
  const r = st.reply;
  return `<section class="card reply"><div class="you">${esc(r.q)}</div><div class="jv"><span class="who">${DOTS}Jarvis</span>
    ${r.a ? `<p>${esc(r.a)}</p>` : `<p class="typing">${LIVE_DOTS}On it…</p>`}
    ${(r.mem || []).length ? `<ul class="mem">${r.mem.map(c => `<li>${memLine(c)}</li>`).join('')}</ul>` : ''}
    ${r.solutions ? optionsCard(r.solutions) : ''}${(r.proposals || []).length ? proposalsCard(r.proposals) : ''}
    ${r.a ? '<div class="acts"><button class="link quiet" data-act="close-reply">Close</button></div>' : ''}</div></section>`;
}
const RING_C = { uni: 'var(--uni)', gym: 'var(--gym)', food: 'var(--food)', jarvis: '#5d6672' };
function ringSvg(bl, n, at) {
  const C = 160, R = 124, ang = m => m / 4 - 180;
  const P = (a, r) => { const t = a * Math.PI / 180; return [+(C + r * Math.sin(t)).toFixed(1), +(C - r * Math.cos(t)).toFixed(1)]; };
  const pt = (a, r) => P(a, r).join(' ');
  const arc = (m0, m1) => { let a0 = ang(m0) + .9, a1 = ang(m1) - .9; if (a1 - a0 < .6) { const m = (ang(m0) + ang(m1)) / 2; a0 = m - .3; a1 = m + .3; } return `M${pt(a0, R)}A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1, R)}`; };
  let s = `<circle cx="160" cy="160" r="124" class="track"/>`;
  const wake = bl.find(b => b.type === 'wake'), sleep = bl.find(b => b.type === 'sleep');
  if (wake && sleep && wake.s + 1440 > sleep.s) s += `<path d="${arc(sleep.s, wake.s + 1440)}" class="arc night"/>`;
  for (let h = 0; h < 24; h++) s += `<path d="M${pt(h * 15 - 180, h % 6 ? 139 : 135)}L${pt(h * 15 - 180, 145)}" class="tk${h % 6 ? '' : ' big'}"/>`;
  for (const b of bl) {
    if (['wake', 'sleep', 'free'].includes(b.type) || b.by === 'maid' || b.e <= b.s) continue;
    const past = n != null && b.e <= n, drive = b.type === 'travel';
    s += `<path d="${arc(b.s, b.e)}" class="arc${drive ? ' drive' : ''}${past ? ' past' : ''}" style="stroke:${drive ? 'var(--jarvis)' : RING_C[appOf(b)] || '#5d6672'}"/>`;
  }
  if (at != null) s += `<path d="M${pt(ang(at), 133)}L${pt(ang(at), 147)}" class="nexttick"/>`;
  if (n != null) { const [x, y] = P(ang(n), R); s += `<circle cx="${x}" cy="${y}" r="11" class="halo"/><circle cx="${x}" cy="${y}" r="5" class="nowdot"/>`; }
  s += `<text x="160" y="8">12</text><text x="312" y="160">18</text><text x="160" y="313">00</text><text x="8" y="160">06</text>`;
  return `<svg viewBox="0 0 320 320" aria-hidden="true">${s}</svg>`;
}
function hero(p, n) {
  const bl = blocks(p), real = bl.filter(b => b.type !== 'free');
  const wake = bl.find(b => b.type === 'wake'), sleep = bl.find(b => b.type === 'sleep');
  let label = '', at = null, cd = '', late = false, sub = '', math = '', side = '';
  if (n == null) {
    const first = real.find(b => !['wake', 'sleep', 'travel'].includes(b.type)), lv = real.find(b => b.type === 'travel'), gym = real.find(b => b.type === 'gym');
    label = 'Up at'; at = wake ? wake.s : first ? first.s : null; cd = relDay(st.date);
    sub = first ? `${first.title} at ${t12(first.s)}` : '';
    const facts = [lv && ['Leave', lv.s], gym && [gym.title, gym.s], sleep && ['Lights out', sleep.s]].filter(Boolean);
    side = facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div><span class="eb">${esc(k)}</span><b>${tt(v)}</b></div>`).join('')}</div>` : '';
  } else if (sleep && n >= sleep.s) {
    label = 'Lights out'; at = sleep.s; cd = 'Sleep well'; sub = 'Tomorrow is ready when you wake up.';
  } else {
    const cur = bl.find(b => b.s <= n && n < b.e && b.type !== 'sleep');
    const nextThing = real.find(b => b.s > n && b.type !== 'travel');
    const drive = real.find(b => b.type === 'travel' && b.s >= n - 5 && (!nextThing || b.s <= nextThing.s));
    const target = drive || nextThing;
    if (target) {
      at = target.s;
      let mins = drive ? drive.e - drive.s : 0, live = false;
      if (drive && st.eta && st.eta.key === `${drive.to}@${drive.start}`) { mins = st.eta.minutes; at = Math.min(drive.s, st.eta.arriveBy - mins); live = true; }
      late = at < n;
      label = drive ? `Leave for ${PLACE[drive.to] || drive.to}` : target.title;
      cd = late ? `${n - at} min behind` : until(at - n);
      const after = drive ? real.find(b => b.s >= drive.e && b.type !== 'travel') : null;
      sub = drive ? (after ? `${after.title} at ${t12(after.s)}` : `${mins} min drive`) : (target.detail || '');
      if (drive && after) {
        const prefs = st.settings.prefs || {}, park = drive.to === 'uni' ? (prefs.parking ?? 10) : 0, early = Math.max(0, after.s - drive.e), dm = Math.max(0, mins - park);
        const terms = [[t12(after.s), ['class', 'exam'].includes(after.type) ? 'Class' : after.type === 'gym' ? 'Gym' : 'Starts'], early && [`−${early}`, 'Early'], park && [`−${park}`, 'Parking'], [`−${dm}`, live ? 'Live drive' : 'Drive']].filter(Boolean);
        math = `<div class="math"><div class="mrow"><span class="eb">Why ${esc(t12(at))}</span><span class="eb">${live || p.traffic === 'google' ? '<span class="pulse"></span>Live traffic' : 'Map drive times'}</span></div>
          <div class="terms">${terms.map(([v, k]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}<div class="eq"><b>${esc(t12(at))}</b><span>Leave</span></div></div></div>`;
      }
    } else { label = 'Nothing else today'; at = sleep ? sleep.s : null; cd = sleep ? `Lights out ${t12(sleep.s)}` : ''; }
    const over = bl.find(b => b.startedAt && !b.done && !b.skipped && n > b.e + 5);
    side = `<div class="nowline2"><span class="eb">Now</span><div><b>${esc(cur ? (cur.type === 'free' ? `Free time until ${t12(cur.e)}` : cur.title) : wake && n < wake.s ? `Asleep — up at ${t12(wake.s)}` : 'Nothing on right now')}</b>${cur && cur.type !== 'free' ? `<small>until ${t12(cur.e)}</small>` : ''}</div></div>`
      + (over ? `<div class="nowline2 warn"><span class="eb">Over</span><div><b>${esc(over.title)} is running ${n - over.e} min over</b><button class="link" data-act="replan">Re-plan the rest of today</button></div></div>` : '');
  }
  return `<section class="hero"><div class="ring">${ringSvg(bl, n, at)}<div class="ring-c"><span class="eb">${esc(label)}</span><b>${tt(at)}</b><span class="cd ${late ? 'late' : ''}">${esc(cd)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>${math || side ? `<div class="hero-r">${math}${side}</div>` : ''}</section>`;
}
function checksOf(p) {
  const bl = blocks(p), bad = p.rulesNotMet || [];
  const cls = bl.filter(b => b.type === 'class' || b.type === 'exam'), gym = bl.find(b => b.type === 'gym'), meals = bl.filter(b => b.type === 'meal'), sleep = bl.find(b => b.type === 'sleep'), wake = bl.find(b => b.type === 'wake');
  const buf = (st.settings.prefs || {}).arrivalBuffer ?? 5;
  const ok = [
    cls.length && ['uni', `On time for ${cls.length === 1 ? 'your class' : `all ${cls.length} classes`}`, `In the room ${buf} min early, plus what each route has run over`],
    gym && ['gym', `${gym.title} at ${t12(gym.s)}`, [isGym(gym.loc) && gym.loc !== 'gym' ? PLACE_LABEL[gym.loc] : '', dur(gym.e - gym.s)].filter(Boolean).join(' · ')],
    meals.length && ['food', `${meals.length} meal${meals.length > 1 ? 's' : ''}, each cooked before you eat it`, 'Nutrition Coach’s meals for the day'],
    sleep && ['jarvis', `Lights out at ${t12(sleep.s)}`, wake ? `Up at ${t12(wake.s)}` : 'Wind-down kept free']
  ].filter(Boolean);
  return { ok, bad, rules: st.memory.filter(m => m.kind === 'rule' || m.kind === 'habit').length };
}
function checks(p) {
  const c = checksOf(p); if (!c.ok.length && !c.bad.length) return '';
  return `<section class="card checks"><div class="ch"><span class="eb">What I checked</span><span class="eb ${c.bad.length ? 'warn' : 'good'}">${c.bad.length ? `${c.bad.length} not kept` : `${c.rules} rules hold`}</span></div>
    ${c.ok.map(([a, t, d]) => `<div class="chk"><i style="--c:var(--${a})">✓</i><div><b>${esc(t)}</b><small>${esc(d)}</small></div></div>`).join('')}
    ${c.bad.map(r => `<div class="chk bad"><i>!</i><div><b>A rule I couldn’t keep</b><small>${esc(r)}</small></div></div>`).join('')}</section>`;
}
function notes(p) {
  const list = [];
  for (const m of st.memory.filter(m => m.kind === 'day' && m.date === st.date)) list.push({ k: 'change', eb: 'You said', html: esc(m.text), act: `<button class="link quiet" data-act="forget" data-id="${esc(m.id)}">Undo this change</button>` });
  const ch = (p.changes || []).filter(c => c.at && localOf(c.at, 180).date === today() && st.date === today()).pop();
  if (ch) list.push({ k: 'alert', eb: `Changed at ${t12(localOf(ch.at, 180).min)}`, html: esc(ch.summary), act: `<button class="link quiet" data-act="undo-change" data-id="${esc(ch.id)}">Undo</button>` });
  for (const x of p.notes || []) list.push({ k: '', eb: 'Note', html: esc(x) });
  return list.map(x => `<section class="card note ${x.k}"><span class="eb">${x.eb}</span><p>${x.html}</p>${x.act ? `<div class="acts">${x.act}</div>` : ''}</section>`).join('');
}
function timeline(p, n) {
  const bl = blocks(p);
  const past = n == null ? [] : bl.filter(b => b.e <= n - 20);
  const show = n == null || st.showEarlier ? bl : bl.filter(b => !past.includes(b));
  let h = `<section class="plan"><div class="ch"><span class="eb">The plan</span><span class="eb dim">${bl.length} blocks${bl.length ? ` · ${t12(bl[0].s)} – ${t12(bl[bl.length - 1].e)}` : ''}</span></div>`;
  if (past.length && !st.showEarlier) h += `<button class="earlier" data-act="earlier"><i>✓</i><b>Earlier today · ${past.length}</b><span>${esc(past.filter(b => !['wake', 'free', 'travel'].includes(b.type)).slice(0, 3).map(b => b.title).join(' · '))}</span><em>Show</em></button>`;
  let nowDrawn = n == null, place = null, arrived = p.startLoc && PLACES.includes(p.startLoc) ? p.startLoc : 'home';
  h += `<ol class="day">`;
  for (const b of show) {
    if (!nowDrawn && b.s > n) { h += `<li class="nowline"><span>${t12(n)}</span></li>`; nowDrawn = true; }
    if (b.type === 'travel') { h += row(b, n); arrived = b.to; continue; }
    const loc = (['class', 'exam'].includes(b.type) ? 'uni' : PLACES.includes(b.loc) ? b.loc : null) || arrived || place;
    arrived = null;
    if (loc && loc !== place) { h += `<li class="place"><span>${esc(PLACE_LABEL[loc] || loc)}</span><i></i></li>`; place = loc; }
    h += row(b, n);
  }
  if (!nowDrawn) h += `<li class="nowline"><span>${t12(n)}</span></li>`;
  return h + `</ol></section>`;
}

const TIMED = ['cook', 'study', 'homework', 'other'];
const PROBLEMS = { cook: ['No time to cook'], meal: ['No time to eat this now'], gym: ['Short on time', 'Can’t make it today', 'Won’t fit before bed'], travel: ['Running late'],
  study: ['Not enough time', 'Too tired to focus'], homework: ['Not enough time', 'Too tired to focus'], other: ['Can’t do this now'], class: ['Can’t make this class'], exam: [] };
/** The foods in the meal a cook or meal block is for (Nutrition Coach's meals keep the same foods; only grams change). */
function mealFoods(b) {
  const meal = b.type === 'cook' ? (makesOf(b, st.date)[0] || {}).meal : mealOf(b);
  const m = meal && baseDay(DINNER_WEEK[dowOf(st.date)]).find(x => x.key === meal);
  return m ? m.items.map(it => it.food) : [];
}
function row(b, n) {
  const app = appOf(b), past = n != null && b.e <= n, on = n != null && b.s <= n && n < b.e;
  const cls = ['blk', b.type, past ? 'past' : '', on ? 'now-on' : '', b.done ? 'done' : '', b.skipped ? 'skipped' : '', st.open.has(b.i) ? 'open' : ''];
  const open = st.open.has(b.i), extra = xtra(b, n);
  if (b.type === 'travel') {
    const shop = (b.shop || []).filter(f => FOODS[f]).map(f => FOODS[f][0].toLowerCase());
    return `<li class="${cls.join(' ')} drive" data-app="jarvis"><span class="t tnum">${tt(b.s)}</span><span class="rail"></span>
      <button class="body" data-act="toggle" data-i="${b.i}"><span class="name">${esc(b.title || `Drive to ${PLACE[b.to] || b.to}`)}, ${b.e - b.s} min</span>${shop.length ? `<span class="det">Stop for ${esc(shop.join(', '))} on the way</span>` : ''}${b.reason ? `<span class="why">${esc(b.reason)}</span>` : ''}</button>
      ${open || extra ? `<div class="xtra">${open ? `<span class="acts on"><button class="link" data-act="mark" data-f="done" data-i="${b.i}">${b.done ? 'Not done' : 'Done'}</button>${!past && !b.done ? `<button class="link quiet" data-act="problem" data-i="${b.i}">Problem?</button>` : ''}</span>` : ''}${extra}</div>` : ''}</li>`;
  }
  if (b.type === 'wake' || b.type === 'sleep') {
    return `<li class="${cls.join(' ')} edge" data-app="jarvis"><span class="t tnum">${tt(b.s)}</span><span class="rail"></span><div class="body"><span class="name">${b.type === 'wake' ? 'Wake up' : 'Lights out'}</span>${b.detail ? `<span class="det">${esc(b.detail)}</span>` : ''}</div></li>`;
  }
  const len = b.e - b.s, det = [b.type === 'gym' && isGym(b.loc) && b.loc !== 'gym' ? PLACE_LABEL[b.loc] : '', b.detail, ['gym', 'study', 'homework', 'class', 'exam'].includes(b.type) ? dur(len) : '', b.crowd ? `${b.crowd === 'ok' ? 'OK' : b.crowd[0].toUpperCase() + b.crowd.slice(1)} crowd` : ''].filter(Boolean).join(', ');
  const markable = !['class', 'exam', 'free'].includes(b.type), took = tookOf(b), maid = b.type === 'cook' && b.by === 'maid';
  const timer = b.startedAt && !b.done ? `<span class="det live">Started ${t12(localOf(b.startedAt, 180).min)} · ${Math.max(0, Math.round((Date.now() - Date.parse(b.startedAt)) / 60000))} min so far</span>` : b.done && took ? `<span class="det">Took ${dur(took)}${Math.abs(took - len) >= 5 ? ` (planned ${dur(len)})` : ''}</span>` : '';
  const ins = b.instead ? `<span class="det swap"><b>${b.instead.fromHisChoice ? 'Your pick' : 'Instead'}:</b> ${esc(b.instead.title ? b.instead.title + ' — ' : '')}${esc(b.instead.summary || '')}${b.instead.kcal != null ? ` · ${b.instead.kcal} kcal, ${b.instead.protein} g protein (${esc(b.instead.vsPlan || '')})` : ''}${b.instead.log ? `<br>${esc(b.instead.log)}` : ''}</span>` : '';
  const maidMsg = maid && b.message ? `<span class="det swap"><b>Text your maid:</b> “${esc(b.message)}” <button class="link" data-act="copy" data-i="${b.i}">Copy</button></span>` : '';
  const acts = markable ? `<span class="acts">${TIMED.includes(b.type) && !maid && !b.done && !b.skipped && !b.startedAt ? `<button class="link" data-act="start" data-i="${b.i}">Start</button>` : ''}<button class="link" data-act="mark" data-f="done" data-i="${b.i}">${b.done ? 'Not done' : 'Done'}</button><button class="link quiet" data-act="mark" data-f="skipped" data-i="${b.i}">${b.skipped ? 'Bring back' : 'Skip'}</button>${!past && !b.done && !b.skipped ? `<button class="link quiet" data-act="problem" data-i="${b.i}">Problem?</button>` : ''}</span>`
    : (PROBLEMS[b.type] || []).length && !past ? `<span class="acts"><button class="link quiet" data-act="problem" data-i="${b.i}">Problem?</button></span>` : '';
  return `<li class="${cls.join(' ')}" data-app="${app}"><span class="t tnum">${tt(b.s)}</span><span class="rail"></span>
    <div class="body" role="button" tabindex="0" data-act="toggle" data-i="${b.i}"><span class="name">${esc(b.type === 'free' ? (b.title || 'Free time') : b.title)}${maid ? ' <span class="tag">Maid · ready by ' + t12(b.e) + '</span>' : ''}</span>${det ? `<span class="det">${esc(det)}</span>` : ''}${maidMsg}${ins}${timer}
      ${b.reason ? `<span class="why">${esc(b.reason)}</span>` : ''}${acts}</div>${extra ? `<div class="xtra">${extra}</div>` : ''}</li>`;
}
/** Under a block: how long it took (one tap), what went wrong, and Jarvis's options. */
function xtra(b, n) {
  let h = '';
  if (st.crowdAsk === b.i) h += `<div class="prob"><p>How busy was ${esc(PLACE_NAME[b.loc] || 'the gym')}?</p><div class="chips">${[['quiet', 'Quiet'], ['ok', 'OK'], ['packed', 'Packed']].map(([v, l]) => `<button class="chip" data-act="crowd" data-i="${b.i}" data-v="${v}">${l}</button>`).join('')}</div><p class="det">Jarvis learns which branch is quiet when, and plans around it.</p></div>`;
  if (st.took === b.i) h += `<div class="prob"><p>How long did it take?</p><div class="chips">${[10, 15, 20, 30, 45, 60, 90].map(m => `<button class="chip" data-act="took" data-i="${b.i}" data-m="${m}">${m} min</button>`).join('')}<button class="chip" data-act="took" data-i="${b.i}" data-m="0">Not sure</button></div></div>`;
  const P = st.problem;
  if (P && P.i === b.i) {
    if (st.solving === b.i) h += `<div class="prob"><p class="live"><span class="pulse"></span> Jarvis is working out your options…</p></div>`;
    else if (P.step === 'missing') h += `<div class="prob"><p>What’s missing?</p><div class="chips">${mealFoods(b).map(f => `<button class="chip ${P.missing.includes(f) ? 'on' : ''}" data-act="miss" data-f="${f}">${esc(FOODS[f][0])}</button>`).join('')}</div><button class="btn sm pri" data-act="solve" data-i="${b.i}" data-kind="" ${P.missing.length ? '' : 'disabled'}>Find options</button></div>`;
    else h += `<div class="prob"><div class="chips">${(PROBLEMS[b.type] || []).map(k => `<button class="chip" data-act="solve" data-i="${b.i}" data-kind="${esc(k)}">${esc(k)}</button>`).join('')}${(b.type === 'cook' || b.type === 'meal') && mealFoods(b).length ? `<button class="chip" data-act="missing" data-i="${b.i}">Missing ingredients</button>` : ''}<button class="chip quiet" data-act="problem-close">Never mind</button></div>
      <form class="inline" data-solve="${b.i}"><input id="prob-txt" placeholder="Or say what happened" maxlength="400"><button class="btn sm">Go</button></form></div>`;
  }
  const pr = (st.plan.problems || []).filter(x => x.block && x.block.i === b.i && x.chosen == null).pop();
  if (pr && !(P && P.i === b.i)) h += optionsCard(pr);
  return h;
}
function optionsCard(pr) {
  return `<div class="opts"><p class="sit"><b>${esc(pr.problem)}</b>${pr.situation ? ` ${esc(pr.situation)}` : ''}</p><ol>${pr.options.map((o, k) => `<li class="opt ${k === pr.pick ? 'pick' : ''}">
    <div class="ot"><b>${esc(o.title)}</b>${k === pr.pick ? '<span class="tag day">Jarvis’s pick</span>' : ''}${o.minutes ? `<span class="tag">${dur(o.minutes)}</span>` : ''}</div>
    <p>${esc(o.how)}</p>
    ${o.food && !o.food.sameFoodAsPlanned ? `<p class="det">${esc(o.food.foods)} — ${o.food.kcal} kcal, ${o.food.protein} g protein, ${o.food.carbs} g carbs, ${o.food.fat} g fat (${esc(o.food.vsPlan)})</p>` : ''}
    ${o.today ? `<p class="det"><b>Today:</b> ${esc(o.today)}</p>` : ''}${o.costs ? `<p class="det"><b>Costs:</b> ${esc(o.costs)}</p>` : ''}
    ${pr.chosen == null ? `<button class="btn sm ${k === pr.pick ? 'pri' : ''}" data-act="choose" data-date="${esc(pr.date || st.date)}" data-pid="${esc(pr.id)}" data-k="${k}">Go with this</button>` : pr.chosen === k ? '<span class="tag goal">You picked this</span>' : ''}</li>`).join('')}</ol>
    ${pr.why ? `<p class="det">Why the pick: ${esc(pr.why)}</p>` : ''}</div>`;
}
/** What to take, and the calls Jarvis made — with one-tap alternatives. */
function foresight(p) {
  let h = '';
  if ((p.bring || []).length) {
    const key = b => `${st.date}|${b.what}`, done = p.bring.filter(b => st.packed.has(key(b))).length;
    h += `<section class="card bring"><div class="ch"><span class="eb">Take with you</span><span class="eb dim">${done} of ${p.bring.length} packed</span></div>
      ${p.bring.map(b => { const on = st.packed.has(key(b)); return `<button class="pk ${on ? 'on' : ''}" data-act="pack" data-w="${esc(b.what)}"><i>${on ? '✓' : ''}</i><span><b>${esc(b.what)}</b>${b.why ? `<small>${esc(b.why)}</small>` : ''}</span></button>`; }).join('')}</section>`;
  }
  for (const [ci, c] of (p.choices || []).entries()) h += `<section class="card call"><span class="eb">A call I made</span><p><b>${esc(c.problem)}.</b> I went with ${esc(c.picked)}.</p>
    <div class="alts">${c.options.map((o, k) => `<div class="alt"><button class="btn sm" data-act="alt" data-c="${ci}" data-k="${k}">Instead: ${esc(o.title)}</button>${o.costs ? `<small>${esc(o.costs)}</small>` : ''}</div>`).join('')}</div></section>`;
  return h;
}

function viewAhead() {
  let h = head('The week ahead', 'Seven days, one at a time.', 'I plan each day the evening before and tell you when to get up. Open any day to plan it now.');
  if (!st.ahead) return h + `<p class="empty">Reading your apps…</p>`;
  const W0 = 300, W = 1020, pct = m => `${Math.max(0, Math.min(100, (m - W0) / W * 100)).toFixed(2)}%`, wid = (a, b) => `${Math.max(.8, (b - a) / W * 100).toFixed(2)}%`;
  const cls = st.ahead.reduce((a, d) => a + d.classes, 0), due = st.ahead.reduce((a, d) => a + d.due.length, 0), gym = st.ahead.filter(d => !/Rest/.test(d.gym)).length;
  h += `<div class="stats"><span><b style="color:var(--uni)">${cls}</b> classes</span><span><b style="color:var(--gym)">${gym}</b> sessions</span><span><b>${due}</b> deadline${due === 1 ? '' : 's'}</span></div>`;
  h += `<ol class="week">${st.ahead.map(d => {
    const isT = d.date === today(), f = toMin(d.first), l = toMin(d.last), g = toMin(d.gymAt);
    const status = d.planned ? 'Planned' : dayDiff(today(), d.date) === 1 ? 'Plans tonight' : 'Not planned yet';
    const times = d.planned ? [['Up', d.wake], ['Leave', d.leave], [d.gym, d.gymAt], ['Lights out', d.bed]].filter(x => x[1]) : [];
    return `<li class="wday ${isT ? 'today' : ''} ${d.planned ? 'planned' : ''}">
      <div class="dn"><span class="nm">${esc(relDay(d.date))}</span><span class="eb">${+d.date.slice(8)} ${MON[+d.date.slice(5, 7) - 1]}</span><span class="st"><i></i>${status}</span></div>
      <div class="ribbon">${d.classes && f != null ? `<i class="cl" style="left:${pct(f)};width:${wid(f, l)}"></i>` : ''}${g != null ? `<i class="gy" style="left:${pct(g)};width:${wid(g, g + 75)}"></i>` : ''}${d.due.map(x => toMin(x.at) != null ? `<i class="du" style="left:${pct(toMin(x.at))}"></i>` : '').join('')}</div>
      <div class="axis"><span>5a</span><span>10a</span><span>3p</span><span>8p</span></div>
      <div class="facts"><span>${d.classes ? `${d.classes} class${d.classes > 1 ? 'es' : ''} · ${T(d.first)} – ${T(d.last)}` : 'No classes'}</span><span class="tag ${/Rest/.test(d.gym) ? '' : 'gym'}">${esc(d.gym)}</span>${d.changes.map(c => `<span class="tag day">${esc(c)}</span>`).join('')}</div>
      ${d.summary ? `<p class="sum">${esc(d.summary)}</p>` : ''}
      ${times.length ? `<div class="times">${times.map(([k, v]) => `<div><span class="eb">${esc(k)}</span><b>${tt(toMin(v))}</b></div>`).join('')}</div>` : ''}
      ${d.due.map(x => `<div class="due"><span>${esc(x.title)}${x.weight ? ` <em>${esc(x.weight)}</em>` : ''}</span><b>${T(x.at)}</b></div>`).join('')}
      <div class="row2"><button class="link" data-act="open-day" data-date="${d.date}">${d.planned ? 'Open' : 'Plan it now'}</button>${/done/.test(d.gym) ? '' : `<button class="link quiet" data-act="rest" data-date="${d.date}">${d.chosenRest ? 'Train this day' : 'Make it a rest day'}</button>`}</div></li>`;
  }).join('')}</ol>`;
  return h;
}

// ----- apps -----
function goalsView(track) {
  const g = st.goals;
  if (!g) return `<p class="empty">Reading your apps…</p>`;
  const kv = o => Object.entries(o || {}).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `<li><b>${esc(LABEL[k] || k)}</b><span>${esc(Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? Object.values(v).join(' · ') : v)}</span></li>`).join('');
  const mine = g.bigGoals.filter(x => x.track === track);
  if (!mine.length) return `<p class="empty">No ${track === 'body' ? 'body' : 'grades'} goal yet — add one under What I know.</p>`;
  return mine.map((goal, gi) => {
    const pr = goal.progress || {};
    let h = `${gi ? `<h2 class="sec">${esc(goal.goal)}</h2>` : ''}<div class="goalgrid"><section class="card gstat"><span class="eb">Where it stands</span><ul class="kv">${kv(pr.courses ? { gradeAtStakeNext14Days: pr.gradeAtStakeNext14Days, missing: pr.missing } : pr)}</ul>
      ${pr.courses ? `<form id="mark-form" class="markf"><select id="mk-ref"><option value="">Record a mark…</option>${(g.markable || []).map(x => `<option value="${esc(x.ref)}">${esc(x.label)}</option>`).join('')}</select><input id="mk-score" type="number" step="any" min="0" placeholder="Score"><input id="mk-of" type="number" step="any" min="1" placeholder="Out of"><button class="btn sm pri">Save</button></form>` : ''}</section>
      <section class="card ghabits"><span class="eb">Habits that get you there</span>${goal.habits.map(x => `<div class="hab"><div class="hh"><b>${esc(x.habit)}</b>${x.strength === 'must' ? '<span class="tag must">Must</span>' : ''}</div>${x.lately ? `<ul class="kv">${kv(x.lately)}</ul>` : ''}</div>`).join('') || '<p class="det">None yet.</p>'}</section></div>`;
    if (pr.courses) h += `<h2 class="sec">Your courses</h2><div class="ctiles">${pr.courses.map(c => `<div class="card ctile"><b>${esc(c.course)}</b><span>${esc(c.marked)}</span><small>Still to come: ${esc(c.stillToCome)}</small>${c.next ? `<small>Next: ${esc(c.next)}</small>` : ''}${c.doneButNoMark ? `<em>Done, no mark yet: ${esc(c.doneButNoMark.join(', '))}</em>` : ''}</div>`).join('')}</div>`;
    if (goal.rules.length) h += `<section class="card grules"><span class="eb">Rules for this goal</span><ul>${goal.rules.map(x => `<li>${esc(x.rule)}${x.strength === 'must' ? '<span class="tag must">Must</span>' : ''}</li>`).join('')}</ul></section>`;
    return h;
  }).join('');
}
const LABEL = { target: 'Target', now: 'Now', phase: 'Phase', math: 'The math', pace: 'Pace', nutritionCoachRoute: 'Nutrition Coach’s route', appVsGoal: 'Mismatch', missing: 'Missing', gradeAtStakeNext14Days: 'Grade at stake in the next 14 days',
  last7Days: 'Last 7 days', lastDays: 'Logged', today: 'Today', note: 'Note', lastSet1: 'Last top sets', belowMinimum: 'Below the minimum', repeatedSessions: 'Progression', targets: 'Targets', weighIns7: 'Weigh-ins this week',
  measured: 'How it’s measured', lateReports14Days: 'Late reports (14 days)', pastDueNotTickedInUniPlanner: 'Past due, not ticked', dueNext7Days: 'Due in the next 7 days', next14Days: 'Next 14 days', status: 'Status' };
async function loadGoals() { try { st.goals = await B.call('goals', {}); } catch (e) { st.goals = { bigGoals: [], generalRules: [], habitsForNoGoal: [] }; toast(e.message); } if (['physique', 'uni'].includes(st.tab)) render(); }
function appCard(app) {
  if (!st.reviews) return `<p class="empty">Loading…</p>`;
  const r = st.reviews[app], busy = st.reviewing === 'all' || st.reviewing === app;
  let h = `<section class="app" data-app="${app}"><div class="app-h"><h2>${APP_NAME[app]}</h2>${r ? `<span class="state ${r.status}">${{ good: 'On track', watch: 'Watch', problem: 'Problem' }[r.status] || 'Watch'}</span>` : ''}</div>`;
  if (busy) return h + `<p class="live" style="margin-top:12px;color:var(--jarvis);display:flex;gap:10px;align-items:center"><span class="pulse"></span>Jarvis is going through your ${APP_NAME[app]} data…</p></section>`;
  if (!r) return h + `<p class="empty">Not analysed yet.</p><button class="btn sm" data-act="analyse" data-app="${app}">Analyse ${APP_NAME[app]}</button></section>`;
  const part = (title, items, fmt) => items && items.length ? `<div class="part"><h3>${title}</h3><ul>${items.map(fmt).join('')}</ul></div>` : '';
  return h + `<p class="head">${esc(r.headline)}</p><p class="when">Analysed ${r.madeAt ? `${relDay(localOf(r.madeAt, 180).date).toLowerCase()} at ${t12(localOf(r.madeAt, 180).min)}` : ''}</p>
    ${part('How it’s going', r.going, x => `<li>${esc(x)}</li>`)}
    ${part('Mistakes', r.mistakes, x => `<li><b>${esc(x.title)}.</b> ${esc(x.detail)}</li>`)}
    ${r.changes && r.changes.length ? `<div class="part"><h3>Change in ${APP_NAME[app]}</h3><ul class="chg">${r.changes.map(c => `<li>${esc(c.what)}${c.from || c.to ? `<span class="ft">${esc(c.from || '—')} → <em>${esc(c.to || '—')}</em></span>` : ''}<span class="det" style="color:var(--ink-2);font-size:14px">${esc(c.why)}</span></li>`).join('')}</ul></div>` : ''}
    ${part('Missing', r.missing, x => `<li>${esc(x)}</li>`)}
    ${part('Better ways', r.better, x => `<li><b>${esc(x.title)}.</b> ${esc(x.why)}</li>`)}
    ${part('Jarvis needs to know', r.questions, x => `<li>${esc(x)}</li>`)}
    <div class="foot"><button class="link" data-act="ask-about" data-app="${app}">Ask about this</button><button class="link quiet" data-act="analyse" data-app="${app}">Analyse again</button></div></section>`;
}
const goalsSeg = () => `<div class="seg"><button data-tab="physique">Physique</button><button data-tab="uni">Uni</button></div>`;
const goalText = (track, d) => { const x = st.goals && st.goals.bigGoals.find(b => b.track === track); return esc(x ? x.goal : d); };
function viewPhysique() {
  return goalsSeg() + head('Big goal · body', goalText('body', 'Your body goal.'), 'Read from PPL Coach and Nutrition Coach. I never change those apps — the changes below are yours to make.')
    + goalsView('body') + `<h2 class="sec">What I see in your apps</h2><div class="apps2">${appCard('ppl')}${appCard('nutrition')}</div>`;
}
function viewUni() {
  return goalsSeg() + head('Big goal · grades', goalText('grades', 'Your grades goal.'), 'Read from Uni Planner. Marks are the ones you tell me — Uni Planner doesn’t keep scores.')
    + goalsView('grades') + `<h2 class="sec">What I see in Uni Planner</h2><div class="apps2">${appCard('uni')}</div>`;
}

// ----- personal: everything Jarvis keeps about you, and looks back to -----
const CATS = { study: 'Study', university: 'University — classes and what to bring', gym: 'Gym', food: 'Food and cooking', sleep: 'Sleep and routine', travel: 'Travel', home: 'Home and help', other: 'Other' };
const ovText = o => Object.entries(o || {}).map(([k, v]) => `${{ gymAt: 'gym', wake: 'up', sleep: 'lights out', lunchAt: 'lunch', dinnerAt: 'dinner' }[k] || k} ${T(v)}`).join(', ');
function memRow(m) {
  if (st.editing === m.id) return `<div class="rw"><form class="edit-mem" data-id="${esc(m.id)}" style="grid-column:1/-1;display:grid;gap:8px"><textarea id="edit-text" maxlength="500">${esc(m.text)}</textarea>
    <div style="display:flex;gap:8px"><button class="btn sm pri">Save</button><button type="button" class="btn sm" data-act="edit-cancel">Cancel</button></div></form></div>`;
  return `<div class="rw ${m.kind}"><div class="l">${m.kind === 'habit' ? '<span class="lvl">Habit</span> ' : ''}${esc(m.text)}${m.course ? `<span class="tag day">${esc(m.course)}</span>` : ''}${m.kind === 'goal' ? '<span class="tag goal">Big goal</span>' : m.kind === 'day' ? `<span class="tag day">${esc(relDay(m.date))}</span>` : m.strength === 'must' ? '<span class="tag must">Must</span>' : '<span class="tag">When possible</span>'}</div>
    ${m.kind === 'day' && ovText(m.overrides) ? `<div class="s">${esc(ovText(m.overrides))}</div>` : ''}<div class="c">${m.kind !== 'day' ? `<button class="btn sm" data-act="edit-mem" data-id="${esc(m.id)}">Edit</button>` : ''}<button class="btn sm bad" data-act="forget" data-id="${esc(m.id)}">${m.kind === 'day' ? 'Undo' : 'Forget'}</button></div></div>`;
}
// ----- the questionnaire -----
const qnCtx = () => ({ prefs: st.settings.prefs || {}, courses: ((((st.goals || {}).bigGoals || []).find(g => g.track === 'grades') || {}).progress || { courses: [] }).courses.map(c => c.course) });
function qnCard() {
  const Q = buildQuestions(qnCtx()), A = (st.settings.prefs || {}).questionnaire || {}, n = Q.filter(q => answered(q, A[q.id])).length;
  return `<section class="app qn-card"><div class="app-h"><h2>Questionnaire</h2><span class="state ${n === Q.length ? 'good' : 'watch'}">${n} of ${Q.length}</span></div>
    <p class="sub" style="margin:6px 0 10px">Everything Jarvis needs to plan your days precisely: sleep, each class and what you bring to it, the gym, food and who cooks, travel, what comes first when time runs out, and your goals. Every answer becomes something below that Jarvis plans by. You can stop and continue any time, and re-answer to change things.</p>
    <button class="btn sm pri" data-act="qn-open">${n ? (n === Q.length ? 'Review answers' : 'Continue') : 'Start'}</button></section>`;
}
function qnInput(q, a) {
  const chip = (v, on, act = 'qn-pick', extra = '') => `<button type="button" class="chip ${on ? 'on' : ''}" data-act="${act}" data-q="${esc(q.id)}" data-v="${esc(v)}" ${extra}>${esc(v)}</button>`;
  if (q.type === 'choice') return `<div class="chips">${q.options.map(o => chip(o, a === o)).join('')}</div>`;
  if (q.type === 'multi') return `<div class="chips">${q.options.map(o => chip(o, (a || []).includes(o), 'qn-multi')).join('')}</div>${q.other ? `<input class="qn-in" data-q="${esc(q.id)}" data-f="other" placeholder="Something else (comma-separated)" value="${esc(((a || []).filter(x => !q.options.includes(x))).join(', '))}">` : ''}`;
  if (q.type === 'number') return `<div class="inline"><input class="qn-in" data-q="${esc(q.id)}" type="number" min="${q.min ?? 0}" max="${q.max ?? 999}" placeholder="${esc(q.placeholder || '')}" value="${esc(a ?? q.prefill ?? '')}" style="width:110px"> <span class="det">${esc(q.unit || '')}</span></div>`;
  if (q.type === 'times' || q.type === 'times2') return `<div class="f2">${q.fields.map(([f, l, d]) => `<div class="field"><label>${esc(l)}</label><input class="qn-in" data-q="${esc(q.id)}" data-f="${f}" type="${q.type === 'times' ? 'time' : 'number'}" value="${esc((a && a[f]) ?? d)}"></div>`).join('')}</div>`;
  if (q.type === 'text') return `<textarea class="qn-in" data-q="${esc(q.id)}" maxlength="400" placeholder="${esc(q.placeholder || '')}">${esc(a || '')}</textarea>`;
  if (q.type === 'textNum') return `<div class="f2"><div class="field"><label>Where</label><input class="qn-in" data-q="${esc(q.id)}" data-f="text" placeholder="${esc(q.placeholder || '')}" value="${esc((a && a.text) || '')}"></div><div class="field"><label>Minutes</label><input class="qn-in" data-q="${esc(q.id)}" data-f="num" type="number" value="${esc((a && a.num) || '')}"></div></div>`;
  if (q.type === 'perItem') return q.items.map(it => `<div class="per"><span>${esc(it)}</span><div class="chips">${q.options.map(o => chip(o, a && a[it] === o, 'qn-item', `data-i="${esc(it)}"`)).join('')}</div></div>`).join('');
  if (q.type === 'rank') { const order = a || q.prefill || q.items; return `<ol class="rank">${order.map((it, k) => `<li><b>${k + 1}.</b> ${esc(it)} <button type="button" class="link" data-act="qn-up" data-q="${esc(q.id)}" data-k="${k}" ${k ? '' : 'disabled'}>Up</button><button type="button" class="link quiet" data-act="qn-down" data-q="${esc(q.id)}" data-k="${k}" ${k < order.length - 1 ? '' : 'disabled'}>Down</button></li>`).join('')}</ol>`; }
  return '';
}
function viewQuestionnaire() {
  const Q = buildQuestions(qnCtx()), secs = SECTIONS(Q), A = st.qn.answers;
  if (st.qn.sec >= secs.length) {
    const ch = answersToChanges(Q, A, st.memory);
    return head('Questionnaire · review', 'Here’s what saving does.', `${ch.answeredCount} of ${Q.length} questions answered.`) + `
      <div class="grp"><h3>Added to Personal (${ch.add.length})</h3><ul class="plain">${ch.add.map(r => `<li>${esc(r.text)}${r.course ? ` <span class="tag day">${esc(r.course)}</span>` : ''}${r.strength === 'must' ? ' <span class="tag must">Must</span>' : ''}</li>`).join('')}</ul></div>
      ${ch.remove.length ? `<div class="grp"><h3>Replaced</h3><ul class="plain">${ch.remove.map(id => { const m = st.memory.find(x => String(x.id) === id); return m ? `<li>${esc(m.text)}</li>` : ''; }).join('')}</ul></div>` : ''}
      ${Object.keys(ch.prefs).length ? `<div class="grp"><h3>Settings</h3><ul class="plain">${Object.entries(ch.prefs).map(([k, v]) => `<li>${esc({ arrivalBuffer: 'Minutes early for class', parking: 'Parking to room', priorities: 'When time runs out, protect', notify: 'Warn before leaving' }[k] || k)}: ${esc(Array.isArray(v) ? v.join(' → ') : typeof v === 'object' ? (v.lead + ' min') : v)}</li>`).join('')}</ul></div>` : ''}
      ${ch.updates.length ? `<div class="grp"><h3>Goals</h3><ul class="plain">${ch.updates.map(u => `<li>${esc(u.patch.text)}</li>`).join('')}</ul></div>` : ''}
      <div class="qn-nav"><button class="btn sm" data-act="qn-back">Back</button><button class="btn sm pri" data-act="qn-save">Save to Personal</button></div>`;
  }
  const sec = secs[st.qn.sec], qs = Q.filter(q => q.section === sec);
  return `<div class="qbar">${secs.map((_, k) => `<i class="${k < st.qn.sec ? 'on' : k === st.qn.sec ? 'cur' : ''}"></i>`).join('')}</div>` + head(`Questionnaire · ${st.qn.sec + 1} of ${secs.length}`, esc(sec), '') + `
    ${qs.map(q => `<div class="grp qn" data-qid="${esc(q.id)}"><h3 style="text-transform:none;letter-spacing:0;font-size:16px;color:var(--ink)">${esc(q.q)}</h3><p class="det">${esc(q.why)}</p>${qnInput(q, A[q.id])}</div>`).join('')}
    <div class="qn-nav"><button class="btn sm" data-act="${st.qn.sec ? 'qn-back' : 'qn-close'}">${st.qn.sec ? 'Back' : 'Close'}</button><button class="btn sm pri" data-act="qn-next">${st.qn.sec === secs.length - 1 ? 'Review' : 'Next'}</button></div>`;
}
/** Read the typed answers on screen into st.qn.answers. */
function qnCollect() {
  const Q = buildQuestions(qnCtx()), A = st.qn.answers;
  document.querySelectorAll('.qn-in').forEach(el => {
    const q = Q.find(x => x.id === el.dataset.q); if (!q) return;
    const v = el.value.trim();
    if (q.type === 'multi') { const base = (A[q.id] || []).filter(x => q.options.includes(x)); A[q.id] = [...base, ...v.split(',').map(x => x.trim()).filter(Boolean)]; }
    else if (el.dataset.f) { A[q.id] = { ...(A[q.id] || {}), [el.dataset.f]: v }; }
    else A[q.id] = v;
  });
}
function viewPersonal() {
  if (st.qn) return viewQuestionnaire();
  const goals = st.memory.filter(m => m.kind === 'goal'), habits = st.memory.filter(m => m.kind === 'habit'), rules = st.memory.filter(m => m.kind === 'rule');
  const days = st.memory.filter(m => m.kind === 'day' && m.date >= today()).sort((a, b) => a.date < b.date ? -1 : 1);
  const servesAny = x => goals.some(g => (x.serves || []).map(String).includes(String(g.id)));
  let h = head('You', 'What I know about how you live.', 'I read all of this every time I plan. It grows as we talk — when you say something worth keeping, I ask before adding it here.') + qnCard();
  h += `<div class="grp" id="memory"><h3>Big goals and the habits for them</h3><div class="rows">${goals.flatMap(g => [g, ...habits.filter(x => (x.serves || []).map(String).includes(String(g.id)))]).map(memRow).join('') || '<div class="rw"><div class="l" style="color:var(--muted)">No goals yet.</div></div>'}${habits.filter(x => !servesAny(x)).map(memRow).join('')}</div></div>`;
  for (const [k, label] of Object.entries(CATS)) {
    const list = rules.filter(r => (r.category || 'other') === k).sort((a, b) => String(a.course || '') < String(b.course || '') ? -1 : 1);
    if (list.length) h += `<div class="grp" data-cat="${k}"><h3>${esc(label)}</h3><div class="rows">${list.map(memRow).join('')}</div></div>`;
  }
  if (days.length) h += `<div class="grp"><h3>Changes for one day</h3><div class="rows">${days.map(memRow).join('')}</div></div>`;
  h += `<div class="grp"><h3>Add something</h3><form id="mem-form" style="display:grid;gap:10px">
      <div class="field"><label for="m-text">What should Jarvis know?</label><textarea id="m-text" maxlength="500" required placeholder="e.g. Bring my lab coat and goggles to every BIOL 110 lab"></textarea></div>
      <div class="f2"><div class="field"><label for="m-kind">It is</label><select id="m-kind"><option value="prefer">A rule — when possible</option><option value="must">A rule — a must</option><option value="habit">A habit (a must)</option><option value="goal">A big goal</option><option value="day">Just for one day</option></select></div>
        <div class="field" id="m-cat-f"><label for="m-cat">About</label><select id="m-cat">${Object.entries(CATS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field" id="m-course-f"><label for="m-course">Class (optional)</label><input id="m-course" maxlength="40" placeholder="e.g. BIOL 110"></div>
        <div class="field" id="m-serves-f"><label for="m-serves">For which big goal</label><select id="m-serves"><option value="">None in particular</option>${goals.map(g => `<option value="${esc(g.id)}">${esc(g.text)}</option>`).join('')}</select></div>
        <div class="field" id="m-date-f" hidden><label for="m-date">Which day</label><input id="m-date" type="date" value="${today()}" min="${today()}"></div></div>
      <div class="f3" id="m-times" hidden><div class="field"><label for="m-gym">Gym at</label><input id="m-gym" type="time"></div><div class="field"><label for="m-wake">Up at</label><input id="m-wake" type="time"></div><div class="field"><label for="m-sleep">Lights out</label><input id="m-sleep" type="time"></div></div>
      <div><button class="btn sm pri">Add to Personal</button></div></form></div>`;
  return h + kitchenGroup() + `<button class="card linkrow" data-act="you"><span><b>Places, messages and account</b><small>Where you go, when I message you, and your sign-in</small></span><em>›</em></button>`;
}
/** Things Jarvis offered to add to Personal from the conversation: Add or Not now. */
function proposalsCard(list) {
  if (!list || !list.length) return '';
  const known = t => st.memory.some(m => m.text === t);
  return `<ul class="mem props">${list.map(p => {
    const state = p.state || (known(p.row.text) ? 'added' : null), r = p.row;
    return `<li><b>Add to Personal?</b> ${esc(r.text)} <span class="tag">${esc(r.kind === 'rule' ? (CATS[r.category] || 'Other').split(' — ')[0] : r.kind === 'habit' ? 'Habit' : 'Big goal')}</span>${r.course ? `<span class="tag day">${esc(r.course)}</span>` : ''}${p.replacesText ? `<br><span class="det">Replaces: ${esc(p.replacesText)}</span>` : ''}
      <div class="acts" style="display:flex;gap:14px;margin-top:4px">${state === 'added' ? '<span class="tag goal">Added</span>' : state === 'dismissed' ? '<span class="det">Not added</span>' : `<button class="link" data-act="prop-add" data-pid="${esc(p.pid)}">Add</button><button class="link quiet" data-act="prop-no" data-pid="${esc(p.pid)}">Not now</button>`}</div></li>`;
  }).join('')}</ul>`;
}
function findProposal(pid) {
  for (const m of [...(st.thread || []), ...(st.reply ? [{ data: { proposals: st.reply.proposals } }] : [])]) { const p = ((m.data && m.data.proposals) || []).find(x => x.pid === pid); if (p) return p; }
  return null;
}

// ----- ask -----
function viewAsk() {
  let h = head('Ask Jarvis', 'Tell me what changed.', 'I answer from your real data and re-plan when your day moves. Nothing lasting is saved until you tap Add.');
  const th = st.thread;
  if (!th) return h + `<p class="empty">Loading…</p>`;
  const intro = { role: 'jarvis', body: 'I read your timetable, training and nutrition every time I plan. Tell me what changed and I’ll rework the day.\n\nTell me how you like things — “gym at 6pm if possible”, “an hour of study the day before every GCA” — and I’ll remember it for good. Say “today” or “tonight” for one-off changes.\n\nAsk me anything about your week, your lifts, your cut or your deadlines.' };
  h += `<div class="thread">${(th.length ? th : [intro]).map(msg).join('')}${st.sending ? `<div class="msg j typing">${LIVE_DOTS}Thinking</div>` : ''}</div>`;
  return h;
}
function memLine(c) {
  const when = d => { const r = relDay(d); return r === 'Today' || r === 'Tomorrow' ? r.toLowerCase() : `on ${r}`; };
  if (c.op === 'rest') return `<b>Rest day</b> ${esc(when(c.date))} — PPL Coach’s rotation waits a day.`;
  if (c.op === 'train') return `<b>Training day</b> again ${esc(when(c.date))}.`;
  if (c.op === 'forgot') return `<b>Forgot:</b> ${esc(c.text)}`;
  if (c.op === 'pantry') return `<b>Kitchen:</b> ${esc(c.text)}`;
  if (c.op === 'mark') return `<b>Mark saved:</b> ${esc(c.text)}`;
  if (c.kind === 'goal') return `<b>New big goal:</b> ${esc(c.text)}`;
  if (c.kind === 'habit') return `<b>New habit${c.strength === 'must' ? ' (a must)' : ''}:</b> ${esc(c.text)}`;
  if (c.kind === 'rule') return `<b>Remembered for good${c.strength === 'must' ? ' (a must)' : ''}:</b> ${esc(c.text)}`;
  return `<b>Just ${esc(when(c.date))}:</b> ${esc(c.text)}`;
}
function msg(m) {
  const at = m.created_at ? localOf(m.created_at, 180) : null, ts = at ? `${relDay(at.date)}, ${t12(at.min)}` : '';
  if (m.role === 'user') return `<div class="msg u">${esc(m.body)}${ts ? `<div class="when">${ts}</div>` : ''}</div>`;
  const R = m.kind === 'report' && m.data, mem = m.data && m.data.memory;
  return `<div class="msg j"><span class="who">${DOTS}Jarvis</span>${String(m.body || '').split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('')}
    ${mem && mem.length ? `<ul class="mem">${mem.map(c => `<li>${memLine(c)}</li>`).join('')}</ul>` : ''}
    ${m.data && m.data.replanned ? `<p style="margin-top:6px"><button class="link" data-act="open-day" data-date="${esc(m.data.replanned)}">See the new plan</button></p>` : ''}
    ${m.data && m.data.solutions ? optionsCard(m.data.solutions) : ''}
    ${m.data && m.data.proposals ? proposalsCard(m.data.proposals) : ''}
    ${R ? `<div class="rep">${(R.sections || []).map(s => `<div><h4>${esc(s.title)}</h4><ul>${(s.points || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
      ${(R.changes || []).length ? `<div><h4>Changes to make — you make them in the app</h4><ol>${R.changes.map(c => `<li><b>${esc(c.app)}:</b> ${esc(c.what)}${c.from || c.to ? ` (${esc(c.from || '…')} → ${esc(c.to || '…')})` : ''}. ${esc(c.why || '')}</li>`).join('')}</ol></div>` : ''}
      ${(R.ideas || []).length ? `<div><h4>Next week</h4><ol>${R.ideas.map(i => `<li><b>${esc(i.title)}.</b> ${esc(i.why || '')}</li>`).join('')}</ol></div>` : ''}
      ${(R.watch || []).length ? `<div><h4>Keeping an eye on</h4><ul>${R.watch.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${(R.dataGaps || []).length ? `<div><h4>What I’m missing</h4><ul>${R.dataGaps.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
    ${ts ? `<div class="when">${ts}</div>` : ''}</div>`;
}

// ----- you (settings sheet) -----
function sheetYou() {
  const goals = st.memory.filter(m => m.kind === 'goal'), habits = st.memory.filter(m => m.kind === 'habit'), rules = st.memory.filter(m => m.kind === 'rule'), days = st.memory.filter(m => m.kind === 'day' && m.date >= today()).sort((a, b) => a.date < b.date ? -1 : 1);
  const under = g => [...habits, ...rules].filter(m => (m.serves || []).map(String).includes(String(g.id)));
  const loose = [...habits, ...rules].filter(m => !goals.some(g => (m.serves || []).map(String).includes(String(g.id))));
  const ov = o => Object.entries(o || {}).map(([k, v]) => `${{ gymAt: 'gym', wake: 'up', sleep: 'lights out', lunchAt: 'lunch', dinnerAt: 'dinner' }[k] || k} ${T(v)}`).join(', ');
  const memRow = m => `<div class="rw ${m.kind}"><div class="l">${m.kind === 'habit' ? '<span class="lvl">Habit</span> ' : m.kind === 'rule' ? '<span class="lvl">Rule</span> ' : ''}${esc(m.text)}${m.kind === 'goal' ? '<span class="tag goal">Big goal</span>' : m.kind === 'day' ? `<span class="tag day">${esc(relDay(m.date))}</span>` : m.strength === 'must' ? '<span class="tag must">Must</span>' : '<span class="tag">When possible</span>'}</div>
    ${m.kind === 'day' && ov(m.overrides) ? `<div class="s">${esc(ov(m.overrides))}</div>` : ''}<div class="c"><button class="btn sm bad" data-act="forget" data-id="${esc(m.id)}">Forget</button></div></div>`;
  const P = st.settings.places || {}, prefs = st.settings.prefs || {}, n = prefs.notify || {}, nb = n.blocks || {};
  const on = (v, d = true) => v === undefined ? d : !!v;
  let h = `<div class="sh"><div class="sh-top"><h2>Places and settings</h2><button class="btn sm" data-act="close-sheet">Done</button></div>
    <div class="grp"><h3>Places</h3><p>Every place Jarvis can send you, so it can time every drive. Set the gym branches your membership covers — Jarvis picks one for each session.</p><div class="rows">`;
  for (const k of PLACES.filter(k => k !== 'gym')) {
    const p = P[k], f = st.find[k];
    h += `<div class="rw"><div class="l">${PLACE_LABEL[k]}</div><div class="s">${p ? esc(p.label || `${p.lat}, ${p.lng}`) : 'Not set'}</div>
      <div class="c"><button class="btn sm" data-act="here" data-k="${k}">I’m here</button><button class="btn sm" data-act="paste" data-k="${k}">Paste link</button><button class="btn sm" data-act="find" data-k="${k}">Search</button></div>
      ${st.paste === k ? `<form class="inline" data-paste="${k}" style="grid-column:1/-1"><input type="text" id="l-${k}" placeholder="Google Maps link, or 29.31, 47.98"><button class="btn sm pri">Set</button></form>` : ''}
      ${f ? `<form class="inline" data-find="${k}" style="grid-column:1/-1"><input type="search" id="q-${k}" placeholder="Search a place in Kuwait" value="${esc(f.q || '')}"><button class="btn sm pri">Search</button></form>${f.results ? `<ul class="results" style="grid-column:1/-1">${f.results.length ? f.results.map((r, i) => `<li><button data-act="pick" data-k="${k}" data-i="${i}">${esc(r.display_name)}</button></li>`).join('') : '<li class="s">No matches.</li>'}</ul>` : ''}` : ''}</div>`;
  }
  h += `</div></div>
    <div class="grp"><h3>Getting to class</h3><form id="park-form" class="f2" style="align-items:end"><div class="field"><label for="park">Minutes from parking to the room</label><input id="park" type="number" min="0" max="60" value="${esc(prefs.parking ?? 10)}"></div><div><button class="btn sm">Save</button></div></form></div>`;
  if (B.mode === 'live') {
    const P2 = st.push;
    h += `<div class="grp"><h3>When I message you</h3><p>${P2.subscribed ? 'On for this phone.' : 'Off for this phone.'} ${!P2.supported ? 'On iPhone: Share → Add to Home Screen, open Jarvis from there, then turn this on.' : P2.perm === 'denied' ? 'Notifications are blocked in your phone settings.' : ''}</p>
      <form id="notify-form" class="rows" style="padding:4px 14px;background:var(--sunk)">
        ${[['n-tomorrow', on(n.tomorrow), 'Tomorrow’s plan in the evening, with when to get up'], ['n-wake', on(n.wake), 'A brief when you wake up'], ['n-leave', on(n.leave), 'When to leave, re-checked against live traffic'], ['n-gym', on(nb.gym), 'Gym time'], ['n-study', on(nb.study), 'Study blocks'], ['n-cook', on(nb.cook), 'Time to cook'], ['n-meal', on(nb.meal, false), 'Every meal'], ['n-sleep', on(nb.sleep), 'Wind down before lights out'], ['n-report', on(n.report), 'Weekly report, Saturday 9pm']]
          .map(([id, v, l]) => `<label class="check"><input id="${id}" type="checkbox" ${v ? 'checked' : ''}> ${l}</label>`).join('')}
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0 10px"><button class="btn sm pri">Save</button>${P2.supported && P2.perm !== 'denied' ? (P2.subscribed ? '<button type="button" class="btn sm" data-act="push-test">Send a test</button><button type="button" class="btn sm" data-act="push-off">Turn off on this phone</button>' : '<button type="button" class="btn sm" data-act="push-on">Turn on for this phone</button>') : ''}</div></form></div>`;
  }
  h += `<div class="grp"><h3>Account</h3><div class="rows"><div class="rw"><div class="l">${esc(st.user.email || '')}</div><div class="c">${B.mode === 'live' ? '<button class="btn sm" data-act="signout">Sign out</button>' : '<button class="btn sm bad" data-act="reset">Reset the preview</button>'}</div></div></div></div></div>`;
  return h;
}
function kitchenGroup() {
  const k = st.kitchen;
  if (!k) return `<div class="grp" id="kitchen"><h3>Kitchen and what I’ve learned</h3><p>Loading…</p></div>`;
  const out = k.outOf || [], times = k.cookTimes || [];
  return `<div class="grp" id="kitchen"><h3>Kitchen and what I’ve learned</h3>
    <p>What you’re out of — I won’t plan meals around it and I’ll fit in a shop on a drive. Tap “Got it” when it’s back, or mark the shopping drive done.</p>
    <div class="rows">${out.map(o => `<div class="rw"><div class="l">${esc(o.name)} <span class="tag must">${esc(o.status)}</span></div><div class="s">since ${esc(o.since)}</div><div class="c"><button class="btn sm" data-act="pantry" data-f="${esc(o.food)}" data-s="have">Got it</button></div></div>`).join('') || '<div class="rw"><div class="l" style="color:var(--muted)">Nothing missing.</div></div>'}</div>
    <form id="pantry-form" class="inline" style="margin-top:10px"><select id="pantry-food"><option value="">I’m out of…</option>${Object.entries(FOODS).map(([f, x]) => `<option value="${f}">${esc(x[0])}</option>`).join('')}</select><button class="btn sm">Save</button></form>
    <p style="margin-top:14px">How long cooking really takes you, from your Start and Done taps.</p>
    <div class="rows">${times.map(c => `<div class="rw"><div class="l">${esc(c.cooking)}</div><div class="s">about ${c.typical} min (${c.minutesEachTime.length} time${c.minutesEachTime.length > 1 ? 's' : ''}: ${c.minutesEachTime.join(', ')} min)</div></div>`).join('') || '<div class="rw"><div class="l" style="color:var(--muted)">Nothing timed yet — tap Start when you begin cooking and Done when you finish.</div></div>'}</div>
    ${typeof k.groceryList === 'object' && k.groceryList ? `<p style="margin-top:14px">Nutrition Coach grocery list from ${esc(k.groceryList.listMadeOn)}: covers you until ${esc(k.groceryList.coversUntil)}.${k.groceryList.notTicked.length ? ` Not ticked: ${esc(k.groceryList.notTicked.join(', '))}.` : ''}</p>` : ''}</div>`;
}
async function loadKitchen() { try { st.kitchen = await B.call('kitchen', {}); } catch { st.kitchen = { outOf: [], cookTimes: [] }; } if (st.tab === 'personal') render(); }
function openSheet() { const d = $('#sheet'); d.innerHTML = sheetYou(); if (!d.open) d.showModal(); }
const refreshSheet = () => { if ($('#sheet').open) { const y = $('#sheet').scrollTop; $('#sheet').innerHTML = sheetYou(); $('#sheet').scrollTop = y; } };

// ------------------------------------------------------------------ events
document.addEventListener('change', e => { if (e.target.id === 'm-kind') { const day = e.target.value === 'day'; $('#m-date-f').hidden = !day; $('#m-times').hidden = !day; $('#m-serves-f').hidden = day || e.target.value === 'goal'; $('#m-cat-f').hidden = $('#m-course-f').hidden = !['prefer', 'must'].includes(e.target.value); } });
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && st.user) { e.preventDefault(); const b = document.querySelector('[data-act=focus-ask]'); if (b) b.click(); return; } if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-act]')) { e.preventDefault(); e.target.click(); } });
document.addEventListener('submit', async e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'login') { st.err = ''; try { await B.signIn($('#em').value.trim(), $('#pw').value); } catch (err) { st.err = err.message; render(); } return; }
  if (f.id === 'ask-form') { ask($('#ask-in').value); return; }
  if (f.id === 'mem-form') {
    const kind = $('#m-kind').value, text = $('#m-text').value.trim(); if (!text) return;
    const row = { text, source: 'app', kind: kind === 'day' ? 'day' : kind === 'goal' ? 'goal' : kind === 'habit' ? 'habit' : 'rule' };
    if (row.kind === 'rule') row.strength = kind;
    if (row.kind === 'habit') row.strength = 'must';
    if ((row.kind === 'rule' || row.kind === 'habit') && $('#m-serves').value) row.serves = [$('#m-serves').value];
    if (row.kind === 'rule') { row.category = $('#m-cat').value || 'other'; const c = $('#m-course').value.trim(); if (c) row.course = c.slice(0, 40); }
    if (row.kind === 'day') { row.date = $('#m-date').value || today(); const o = {}; for (const [id, k] of [['m-gym', 'gymAt'], ['m-wake', 'wake'], ['m-sleep', 'sleep']]) { const v = $('#' + id).value; if (v) o[k] = v; } row.overrides = o; }
    try { await B.addMemory(row); await loadMemory(); toast(row.kind === 'day' ? 'Got it — just for that day.' : 'Got it. I’ll plan by that from now on.'); await afterMemoryChange(row); } catch (err) { toast(err.message, 6000); }
    $('#m-text').value = ''; render(); return;
  }
  if (f.classList.contains('edit-mem')) {
    const id = f.dataset.id, m = st.memory.find(x => String(x.id) === id), text = $('#edit-text').value.trim(); if (!m || !text) return;
    try { await B.updateMemory(id, { text }); st.editing = null; await loadMemory(); toast('Updated. Jarvis plans by the new version.'); await afterMemoryChange(m); } catch (err) { toast(err.message, 6000); }
    render(); return;
  }
  if (f.dataset.solve != null) { const v = $('#prob-txt').value.trim(); if (v) solveIt(+f.dataset.solve, v, []); return; }
  if (f.id === 'mark-form') {
    const ref = $('#mk-ref').value, score = $('#mk-score').value, outOf = $('#mk-of').value; if (!ref || score === '' || !outOf) { toast('Pick the item, then the score and what it was out of.'); return; }
    try { await B.call('mark', { ref, score: +score, outOf: +outOf }); toast('Mark saved.'); await loadGoals(); } catch (err) { toast(err.message, 6000); } return;
  }
  if (f.id === 'pantry-form') { const food = $('#pantry-food').value; if (food) await pantry(food, 'out'); return; }
  if (f.id === 'park-form') { const v = Math.max(0, Math.min(60, +$('#park').value || 0)); await saveSettings({ prefs: { ...(st.settings.prefs || {}), parking: v } }); toast('Saved.'); return; }
  if (f.id === 'notify-form') {
    const c = id => $('#' + id).checked;
    const notify = { tomorrow: c('n-tomorrow'), wake: c('n-wake'), leave: c('n-leave'), report: c('n-report'), lead: 10, blocks: { gym: c('n-gym'), study: c('n-study'), homework: c('n-study'), cook: c('n-cook'), meal: c('n-meal'), sleep: c('n-sleep') } };
    await saveSettings({ prefs: { ...(st.settings.prefs || {}), notify } }); toast('Saved.'); return;
  }
  if (f.dataset.paste) {
    const k = f.dataset.paste, v = $('#l-' + k).value.trim(); if (!v) return;
    const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    try { const r = m ? { lat: +m[1], lng: +m[2], label: null } : await B.call('resolve-link', { url: v }); await setPlace(k, { lat: r.lat, lng: r.lng, label: r.label || 'Pinned from Google Maps' }); st.paste = null; refreshSheet(); } catch (err) { toast(err.message, 6000); }
    return;
  }
  if (f.dataset.find) {
    const k = f.dataset.find, q = $('#q-' + k).value.trim(); if (!q) return;
    st.find[k] = { q, results: null }; refreshSheet();
    try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=kw&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } }); st.find[k].results = r.ok ? await r.json() : []; } catch { st.find[k].results = []; }
    refreshSheet(); return;
  }
});
document.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]');
  if (tab && tab !== document.body) {          // body carries data-tab too (for styling) — it isn't a tab button
    st.tab = tab.dataset.tab; st.reply = null;
    if (st.tab === 'ahead') loadAhead(); if (st.tab === 'physique' || st.tab === 'uni') { loadReviews(true); loadGoals(); } if (st.tab === 'personal') { loadMemory().then(render); loadKitchen(); if (!st.goals) loadGoals().then(render); } if (st.tab === 'ask') loadThread();
    render(); window.scrollTo(0, 0); return;
  }
  const q = e.target.closest('[data-quick]'); if (q) { ask(q.dataset.quick); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'day') { st.date = addDays(st.date, +a.dataset.d); st.reply = null; loadPlan(st.date); return; }
  if (act === 'goto-today') { st.date = today(); st.reply = null; loadPlan(st.date); return; }
  if (act === 'open-day') { st.date = a.dataset.date; st.tab = 'today'; st.reply = null; window.scrollTo(0, 0); await loadPlan(st.date); if (!st.plan && st.planState !== 'planning') makePlan(st.date); return; }
  if (act === 'make') { if (st.date === today()) locate(); makePlan(st.date); return; }
  if (act === 'replan') { if (st.date === today()) locate(); makePlan(st.date, true); return; }
  if (act === 'earlier') { st.showEarlier = true; render(); return; }
  if (act === 'toggle') { const i = +a.dataset.i; st.open.has(i) ? st.open.delete(i) : st.open.add(i); render(); return; }
  if (act === 'mark') {
    const b = st.plan.blocks[+a.dataset.i], f = a.dataset.f, other = f === 'done' ? 'skipped' : 'done';
    if (b[f]) { delete b[f]; if (f === 'done') { delete b.doneAt; delete b.took; } }
    else {
      b[f] = true; delete b[other];
      if (f === 'done' && b.startedAt) b.doneAt = new Date().toISOString();
      if (f === 'done' && !b.startedAt && b.by !== 'maid' && ['cook', 'study', 'homework'].includes(b.type)) st.took = +a.dataset.i;
      if (f === 'done' && b.type === 'gym') st.crowdAsk = +a.dataset.i;
      if (f === 'skipped') { delete b.startedAt; }
    }
    render(); try { await B.savePlan(st.date, st.plan); } catch (err) { toast(err.message); } return;
  }
  if (act === 'qn-open') { if (!st.goals) await loadGoals(); st.qn = { sec: 0, answers: JSON.parse(JSON.stringify((st.settings.prefs || {}).questionnaire || {})) }; render(); window.scrollTo(0, 0); return; }
  if (act === 'qn-close') { qnCollect(); await qnPersist(); st.qn = null; render(); return; }
  if (act === 'qn-next') { qnCollect(); await qnPersist(); st.qn.sec++; render(); window.scrollTo(0, 0); return; }
  if (act === 'qn-back') { if (st.qn.sec < SECTIONS(buildQuestions(qnCtx())).length) qnCollect(); st.qn.sec = Math.max(0, st.qn.sec - 1); render(); window.scrollTo(0, 0); return; }
  if (act === 'qn-pick') { qnCollect(); st.qn.answers[a.dataset.q] = st.qn.answers[a.dataset.q] === a.dataset.v ? '' : a.dataset.v; render(); return; }
  if (act === 'qn-multi') { qnCollect(); const cur = st.qn.answers[a.dataset.q] || [], v = a.dataset.v; st.qn.answers[a.dataset.q] = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]; render(); return; }
  if (act === 'qn-item') { qnCollect(); st.qn.answers[a.dataset.q] = { ...(st.qn.answers[a.dataset.q] || {}), [a.dataset.i]: a.dataset.v }; render(); return; }
  if (act === 'qn-up' || act === 'qn-down') { qnCollect(); const q = buildQuestions(qnCtx()).find(x => x.id === a.dataset.q), o = (st.qn.answers[q.id] || q.prefill || q.items).slice(), k = +a.dataset.k, j = act === 'qn-up' ? k - 1 : k + 1; [o[k], o[j]] = [o[j], o[k]]; st.qn.answers[q.id] = o; render(); return; }
  if (act === 'qn-save') { await qnSave(); return; }
  if (act === 'edit-mem') { st.editing = a.dataset.id; render(); return; }
  if (act === 'edit-cancel') { st.editing = null; render(); return; }
  if (act === 'prop-no') { const p = findProposal(a.dataset.pid); if (p) p.state = 'dismissed'; render(); return; }
  if (act === 'prop-add') {
    const p = findProposal(a.dataset.pid); if (!p) return;
    try { await B.addMemory(p.row); if (p.replaces) await B.deleteMemory(p.replaces); p.state = 'added'; await loadMemory(); toast('Added to Personal.'); await afterMemoryChange(p.row); } catch (err) { toast(err.message, 6000); }
    render(); return;
  }
  if (act === 'undo-change') {
    const c = (st.plan.changes || []).find(x => x.id === a.dataset.id); if (!c) return;
    st.plan.blocks = c.prevBlocks; st.plan.changes = st.plan.changes.filter(x => x !== c); render();
    try { await B.savePlan(st.date, st.plan); toast('Back to the plan before that change.'); } catch (err) { toast(err.message); } return;
  }
  if (act === 'copy') { const b = st.plan.blocks[+a.dataset.i]; try { await navigator.clipboard.writeText(b.message); toast('Copied — paste it to her.'); } catch { toast(b.message, 8000); } return; }
  if (act === 'start') { const b = st.plan.blocks[+a.dataset.i]; b.startedAt = new Date().toISOString(); delete b.skipped; render(); try { await B.savePlan(st.date, st.plan); } catch (err) { toast(err.message); } return; }
  if (act === 'crowd') { const b = st.plan.blocks[+a.dataset.i]; b.crowd = a.dataset.v; st.crowdAsk = null; render(); try { await B.savePlan(st.date, st.plan); toast('Thanks — noted for planning.'); } catch (err) { toast(err.message); } return; }
  if (act === 'took') { const b = st.plan.blocks[+a.dataset.i], m = +a.dataset.m; if (m) b.took = m; st.took = null; render(); try { await B.savePlan(st.date, st.plan); } catch (err) { toast(err.message); } return; }
  if (act === 'problem') { st.problem = { i: +a.dataset.i, step: 'menu', missing: [] }; st.open.add(+a.dataset.i); render(); return; }
  if (act === 'problem-close') { st.problem = null; render(); return; }
  if (act === 'missing') { st.problem = { i: +a.dataset.i, step: 'missing', missing: [] }; render(); return; }
  if (act === 'miss') { const f = a.dataset.f, m = st.problem.missing; st.problem.missing = m.includes(f) ? m.filter(x => x !== f) : [...m, f]; render(); return; }
  if (act === 'solve') { const i = +a.dataset.i; solveIt(i, a.dataset.kind || '', st.problem && st.problem.step === 'missing' ? st.problem.missing : []); return; }
  if (act === 'choose') { chooseIt(a.dataset.date, a.dataset.pid, +a.dataset.k); return; }
  if (act === 'alt') { const c = st.plan.choices[+a.dataset.c], o = c.options[+a.dataset.k]; if (st.date === today()) locate(); makePlan(st.date, true, `Instead of "${c.picked}" (${c.problem}): ${o.title}`); return; }
  if (act === 'pantry') { await pantry(a.dataset.f, a.dataset.s); return; }
  if (act === 'close-reply') { st.reply = null; render(); return; }
  if (act === 'report') { weeklyReport(); return; }
  if (act === 'analyse') { analyse(a.dataset.app); return; }
  if (act === 'ask-about') { st.tab = 'ask'; await loadThread(); const inp = $('#ask-in'); inp.value = `About ${APP_NAME[a.dataset.app]}: `; inp.focus(); return; }
  if (act === 'rest') {
    const d = a.dataset.date, day = (st.ahead || []).find(x => x.date === d);
    try {
      await B.setRestDay(d, !(day && day.chosenRest));
      toast(day && day.chosenRest ? `${relDay(d)} is a training day again.` : `${relDay(d)} is a rest day. PPL Coach’s rotation waits a day.`);
      if (d === today()) await replanToday(); else if (st.date >= d && st.date !== today()) st.plan = null;
      await loadAhead();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'you') { openSheet(); return; }
  if (act === 'pack') { const k = `${st.date}|${a.dataset.w}`; st.packed.has(k) ? st.packed.delete(k) : st.packed.add(k); render(); return; }
  if (act === 'focus-ask') { if (!['today', 'ask'].includes(st.tab)) { st.tab = 'ask'; st.reply = null; loadThread(); render(); } const i = $('#ask-in'); if (i) i.focus(); return; }
  if (act === 'close-sheet') { $('#sheet').close(); return; }
  if (act === 'forget') {
    const m = st.memory.find(x => x.id === a.dataset.id); if (!m) return;
    try { await B.deleteMemory(m.id); await loadMemory(); toast(m.kind === 'day' ? 'Change undone.' : 'Forgotten.'); await afterMemoryChange(m); } catch (err) { toast(err.message); }
    refreshSheet(); render(); return;
  }
  if (act === 'paste') { const k = a.dataset.k; st.paste = st.paste === k ? null : k; refreshSheet(); return; }
  if (act === 'find') { const k = a.dataset.k; st.find[k] = st.find[k] ? null : { q: PLACE_QUERY[k] || '' }; refreshSheet(); return; }
  if (act === 'pick') { const k = a.dataset.k, r = st.find[k].results[+a.dataset.i]; await setPlace(k, { lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6), label: r.display_name.split(',').slice(0, 3).join(',') }); st.find[k] = null; refreshSheet(); return; }
  if (act === 'here') {
    const k = a.dataset.k;
    if (!('geolocation' in navigator)) { toast('This browser can’t share your location.'); return; }
    toast('Finding you…');
    navigator.geolocation.getCurrentPosition(async p => { await setPlace(k, { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), label: `Pinned where you stood (within ${Math.round(p.coords.accuracy)} m)` }); refreshSheet(); },
      err => toast(err.code === 1 ? 'Location is blocked — allow it for Jarvis in your phone settings.' : 'Couldn’t get your location.'), { enableHighAccuracy: true, timeout: 20000 });
    return;
  }
  if (act === 'push-on') { try { await B.pushOn(); st.push = await B.pushStatus(); toast('Notifications are on for this phone.'); } catch (err) { toast(err.message, 6000); } refreshSheet(); return; }
  if (act === 'push-off') { try { await B.pushOff(); st.push = await B.pushStatus(); toast('Notifications are off for this phone.'); } catch (err) { toast(err.message); } refreshSheet(); return; }
  if (act === 'push-test') { try { const r = await B.call('test-push', {}); toast(r.error || `Sent to ${r.delivered} of ${r.devices} device${r.devices > 1 ? 's' : ''}.`); } catch (err) { toast(err.message, 6000); } return; }
  if (act === 'signout') { $('#sheet').close(); await B.signOut(); return; }
  if (act === 'reset') { if (B.reset) { await B.reset(); location.reload(); } return; }
});

/** Something got in the way: Jarvis works out options for that block. */
async function solveIt(i, problem, missing) {
  const date = st.date;
  st.solving = i; render();
  try {
    const r = await B.call('solve', { date, i, problem, missing, nowMin: date === today() ? here().min : undefined, coords: date === today() ? st.coords : undefined });
    if (st.date === date && st.plan) st.plan.problems = [...(st.plan.problems || []), r];
    st.problem = null; st.open.add(i);
    if ((missing || []).length) st.kitchen = null;
  } catch (e) { toast(e.message, 6000); }
  st.solving = null; render();
}
/** He picked an option: the day is re-planned around it. */
async function chooseIt(date, id, k) {
  if (st.planState === 'planning') return;
  st.date = date; st.tab = 'today'; st.reply = null; st.planState = 'planning'; st.progress = 'Re-planning around your pick…'; st.planStarted = Date.now(); render();
  try {
    const r = await B.call('choose', { date, id, option: k, nowMin: date === today() ? here().min : undefined, coords: date === today() ? st.coords : undefined });
    st.plan = r.plan; toast(r.say || 'Done.', 7000);
    for (const m of st.thread || []) if (m.data && m.data.solutions && m.data.solutions.id === id) m.data.solutions.chosen = k;
    loadAhead(true);
  } catch (e) { toast(e.message, 6000); }
  st.planState = 'idle'; render(); updateEta();
}
async function pantry(food, status) {
  try {
    const r = await B.call('pantry', { changes: [{ food, status }] });
    toast(status === 'have' ? `${FOODS[food][0]} is back. I’ll plan with it again.` : `Noted — out of ${FOODS[food][0].toLowerCase()}. I’ll work around it and fit in a shop.`, 5000);
    await loadKitchen();
    if (r.staleToday && st.date === today()) replanToday();
    else if (st.date !== today() && dayDiff(today(), st.date) <= 3) st.plan = null;
    loadAhead(true); render();
  } catch (e) { toast(e.message, 6000); }
}
async function qnPersist() { try { await saveSettings({ prefs: { ...(st.settings.prefs || {}), questionnaire: st.qn.answers } }); } catch { } }
/** Save the questionnaire: replace what earlier answers saved, add the new rules, apply the settings and goal changes. */
async function qnSave() {
  const Q = buildQuestions(qnCtx()), ch = answersToChanges(Q, st.qn.answers, st.memory);
  try {
    for (const id of ch.remove) await B.deleteMemory(id);
    for (const u of ch.updates) await B.updateMemory(u.id, u.patch);
    for (const row of ch.add) await B.addMemory(row);
    await saveSettings({ prefs: { ...(st.settings.prefs || {}), ...ch.prefs, questionnaire: st.qn.answers } });
    await loadMemory(); st.qn = null; st.goals = null;
    toast(`Saved ${ch.add.length} things to Personal. Jarvis re-plans with them.`, 6000);
    await afterMemoryChange({ kind: 'rule' });
  } catch (err) { toast(err.message, 6000); }
  render(); window.scrollTo(0, 0);
}
/** Today's plan no longer matches what he said: keep the past, re-plan the rest. */
async function replanToday() {
  const t = today(), p = st.date === t ? st.plan : await B.getPlan(t);
  if (p) { p.stale = true; await B.savePlan(t, p); }
  if (st.date === t) makePlan(t);
}
async function saveSettings(patch) { await B.saveSettings(patch); Object.assign(st.settings, patch); }
async function setPlace(k, pl) {
  try { await saveSettings({ places: { ...(st.settings.places || {}), [k]: pl } }); toast('Saved. Working out drive times…'); await B.call('travel', {}); toast('Drive times updated.'); } catch (err) { toast(err.message, 6000); }
}
/** A memory change can make saved plans wrong: drop them and re-plan the day on screen. */
async function afterMemoryChange(m) {
  if (m.kind === 'goal') { loadAhead(true); return; }                     // a goal shapes future plans; it doesn't break saved ones
  const t = today(), dates = m.kind === 'day' ? [m.date] : [...Array(14)].map((_, i) => addDays(t, i));
  await B.dropPlans(dates.filter(d => d !== t));                           // today keeps what already happened…
  if (dates.includes(t)) await replanToday();                               // …and is re-planned from now
  if (st.date !== t && dates.includes(st.date)) st.plan = null;
  loadAhead(true);
}

// ------------------------------------------------------------------ boot
async function boot(user) {
  st.user = user;
  if (!user) { render(); return; }
  $('#app').innerHTML = '';
  if (B.onProgress) B.onProgress(text => { st.progress = text; const el = $('#prog'); if (el) el.textContent = text; });
  try { st.settings = await B.getSettings(); } catch { }
  await loadMemory();
  if (location.hash === '#ask') st.tab = 'ask';
  locate(); render();
  try { st.push = await B.pushStatus(); } catch { }
  if (st.tab === 'ask') loadThread();
  await loadPlan(st.date);
}
async function start(backend) {
  B = backend;
  let started = false;
  B.onAuth(user => { if (user && !started) { started = true; boot(user); } else if (!user) { started = false; Object.assign(st, { user: null, plan: null, thread: null, reviews: null, ahead: null }); $('#app').innerHTML = ''; render(); } });
  const u = await B.getUser();
  if (!u) render();
  let lastDay = today();
  setInterval(() => {
    if (!st.user) return;
    if (today() !== lastDay) { const was = st.date === lastDay; lastDay = today(); if (was) { st.date = lastDay; loadPlan(st.date); return; } }
    if (st.tab === 'today' && st.date === today() && st.planState === 'idle' && !document.querySelector('#ask-in:focus')) render();
    if (st.planState === 'planning' && !st.progress) { const el = $('#prog'); if (el && (Date.now() - st.planStarted) > 8000) el.textContent = 'Thinking it through — this takes about a minute.'; }
  }, 30000);
  setInterval(() => { if (st.user && st.date === today()) locate(); }, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.user && st.date === today()) { locate(); if (st.planState === 'idle') render(); } });
}
export { start };
