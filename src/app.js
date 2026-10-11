// Jarvis — the app. Four tabs: Today (hour by hour, checkmarks), Calendar (the whole term, day by day),
// Jarvis (tell it changes, ask questions), Settings (places, notifications, every rule).
import * as SC from './scheduler.js';
const { t12, dlong, addDays, localOf, PLACE_NAME, DAYS, RULES, RULE_TEXT } = SC;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowLocal = () => { const l = localOf(new Date().toISOString()); return l.min < 180 ? { date: addDays(l.date, -1), min: l.min + 1440 } : l; };
const ICON = { drive: '→', class: '◆', exam: '◆', gym: '▲', meal: '●', cook: '◐', study: '■', walk: '≈', errand: '▣', maid: '✉', busy: '◇', place: '⌂', wake: '☀', sleep: '☾' };
const TINT = { class: 'uni', exam: 'uni', study: 'uni', gym: 'gym', meal: 'food', cook: 'food', maid: 'food', errand: 'food', walk: 'walk', drive: 'drive', place: 'drive' };
const MEAL = { breakfast: 'Breakfast', lunch: 'Lunch', preworkout: 'Pre-workout', dinner: 'Dinner', evening: 'Shake' };
const SHORT = { home: 'home', grandma: 'grandma’s', uni: 'uni', car: 'in the car', gym_rigae: 'Rigae', gym_mahboula: 'Mahboula', gym_sabah: 'Sabah Al-Salem' };

let API, S = { tab: 'today', plans: [], where: null, changes: [], settings: null, messages: [], busy: false, open: null, push: null, term: null, termErr: null, week: null };

function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function locate(timeout = 8000) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}

// ---------------------------------------------------------------- data
async function load() {
  const t = nowLocal().date;
  const [plans, changes, settings] = await Promise.all([API.plans(t, 7), API.changes(), API.settings()]);
  S.plans = plans; S.changes = changes; S.settings = settings;
}
async function replan(reason) {
  if (S.busy) return; S.busy = true; render();
  try { const r = await API.call('plan', { coords: await locate(), reason }); S.where = r.where; await load(); S.term = null; }
  catch (e) { toast(e.message); }
  S.busy = false; render();
}
async function tick(date, ref, done) {
  const p = S.plans.find(p => p.date === date); const b = p && p.plan.blocks.find(x => x.ref === ref);
  if (b) { b.done = done; render(); }
  try {
    const r = await API.call('tick', { date, ref, done, coords: date === nowLocal().date ? await locate(4000) : null });
    if (r.where) S.where = r.where;
    await load(); render();
  } catch (e) { toast(e.message); if (b) { b.done = !done; render(); } }
}
async function tell(message) {
  if (!message.trim() || S.busy) return;
  S.busy = true; S.messages.push({ role: 'user', body: message }); render();
  try { const r = await API.call('tell', { message, coords: await locate(5000) }); S.messages.push({ role: 'jarvis', body: r.reply }); await load(); S.term = null; }
  catch (e) { S.messages.push({ role: 'jarvis', body: `Couldn’t do that: ${e.message}` }); }
  S.busy = false; render();
}

/** The whole term, planned in the browser with the same rules as the backend. Saved plans (the next 7 days) win. */
async function loadTerm() {
  S.termErr = null;
  try {
    const d = await API.termData();
    const today = nowLocal().date, travel = d.settings.travel || {};
    const ends = d.events.filter(e => e.kind === 'exam' || /exam|classes end/i.test(e.title || '')).map(e => localOf(e.due_at).date);
    const last = ends.length ? ends.sort().pop() : addDays(today, 90);
    const n = Math.max(7, Math.min(150, SC.dayDiff(today, last) + 1));
    const changes = {};
    for (const r of d.dayChanges) { const c = changes[r.date] = changes[r.date] || {}; for (const [k, v] of Object.entries(r.overrides || {})) c[k] = Array.isArray(v) && Array.isArray(c[k]) ? [...c[k], ...v] : v; }
    const done = []; for (const p of d.plans) for (const b of p.plan.blocks || []) if (b.done && b.ref) done.push(b.ref);
    const known = SC.PLACES.filter(k => d.settings.places && d.settings.places[k]);
    const driveFor = date => SC.makeDrive({ profile: ((travel.profiles || {})[SC.dowOf(date)] || {}).data || null, freeFlow: travel });
    const yesterday = d.plans.find(p => p.date === addDays(today, -1));
    const out = SC.planDays({ from: today, n, today, classes: d.classes, events: d.events, ppl: SC.pplFromRows(d.ppl), nutrition: SC.nutritionFromRows(d.nut),
      rules: (d.settings.prefs || {}).rules || {}, known, driveFor, changes, doneRefs: done, prevBedAbs: yesterday && yesterday.plan.bed != null ? yesterday.plan.bed - 1440 : null });
    const saved = Object.fromEntries(d.plans.map(p => [p.date, p.plan]));
    S.term = { days: out.days.map(x => saved[x.date] || x), items: SC.calendarItems(d.events, d.classes, { ...RULES, ...((d.settings.prefs || {}).rules || {}) }), last };
    if (!S.week) S.week = addDays(today, -SC.dowOf(today));
  } catch (e) { S.termErr = e.message; }
  render();
}

// ---------------------------------------------------------------- Today
const blockTime = b => b.instant || b.start === b.end ? t12(b.start) : `${t12(b.start)} – ${t12(b.end)}`;
function blockRow(b, date, isToday, nowMin, ticks = true) {
  const past = isToday && b.end <= nowMin && !b.done, cur = isToday && b.start <= nowMin && b.end > nowMin;
  const check = b.check && ticks ? `<button class="tick ${b.done ? 'on' : ''}" data-tick="${esc(b.ref)}" data-date="${date}" aria-label="${b.done ? 'Uncheck' : 'Check'} ${esc(b.title)}">${b.done ? '✓' : ''}</button>` : '<span class="tick none"></span>';
  const bring = (b.bring || []).length ? `<ul class="bring">${b.bring.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const extra = [b.walk ? `<span class="chip walk">≈ walking pad ${b.walk} min</span>` : '', b.trafficNote ? `<span class="chip warn">${esc(b.trafficNote)}</span>` : '', (b.supplements || []).length ? `<span class="chip ${b.nonStim ? 'warn' : ''}">${esc(b.supplements.join(' · '))}</span>` : ''].join('');
  const openable = b.type === 'maid' || b.type === 'cook' || (b.detail && b.detail.length > 90);
  return `<li class="blk t-${TINT[b.type] || 'jarvis'} ${b.done ? 'done' : ''} ${past ? 'past' : ''} ${cur ? 'cur' : ''} ty-${b.type}" ${openable ? `data-open="${esc(b.ref || b.start)}" data-date="${date}"` : ''}>
    <div class="when tnum">${blockTime(b)}</div><div class="ico">${ICON[b.type] || '·'}</div>
    <div class="what"><div class="ttl">${esc(b.title)}</div>${b.detail ? `<div class="det">${esc(openable && b.type !== 'maid' ? b.detail.slice(0, 90) + (b.detail.length > 90 ? '…' : '') : b.detail)}</div>` : ''}${extra ? `<div class="chips">${extra}</div>` : ''}${bring}</div>
    ${check}</li>`;
}
function todayTab() {
  const today = nowLocal().date, p = S.plans.find(p => p.date === today), n = nowLocal().min;
  if (!p) return `<div class="dayhead"><div class="eb">Today</div><h1>${esc(dlong(today))}</h1></div><div class="card empty"><p>${S.busy ? 'Planning your day…' : 'No plan for today yet.'}</p><button class="btn" data-act="replan">Plan today</button></div>`;
  const plan = p.plan, blocks = plan.blocks;
  const where = S.where || plan.where;
  const issues = [...(plan.warnings || []).map(w => ({ problem: w })), ...((plan.check && !plan.check.ok && plan.check.issues) || [])];
  const next = blocks.find(b => b.type === 'drive' && !b.done && b.end > n);
  return `<div class="dayhead"><div><div class="eb">Today</div><h1>${esc(dlong(today))}</h1></div>
      <div class="facts">${plan.gym ? `<span><b>Gym</b> ${esc(PLACE_NAME[plan.gym.at])} · ${t12(plan.gym.start)} · ${esc(plan.gym.crowd)}</span>` : '<span><b>Gym</b> none</span>'}<span><b>Sleep</b> ${t12(plan.bed)}</span><span><b>Walking pad</b> ${Math.round(plan.walk / 6) / 10} h</span></div></div>
    ${where ? `<div class="where">You’re at <b>${esc(PLACE_NAME[where.loc] || where.loc)}</b> — ${esc(where.how)}</div>` : ''}
    ${issues.length ? `<div class="card issues"><div class="eb warn">Heads up</div><ul>${issues.map(i => `<li>${i.at ? `<b>${esc(i.at)}</b> ` : ''}${esc(i.problem)}${i.fix ? `<button class="fix" data-say="${esc(i.fix)}">${esc(i.fix)}</button>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${next ? `<div class="card next"><div class="eb">Next drive</div><div class="big tnum">Leave ${t12(next.start)}</div><div>${esc(next.title)} · ${esc(next.detail)}</div>${(next.bring || []).length ? `<ul class="bring">${next.bring.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    ${plan.check ? (plan.check.ok ? '<div class="ok">✓ Jarvis checked today — it works.</div>' : '') : '<div class="ok dim">Jarvis is double-checking today…</div>'}
    <ol class="tl">${blocks.map(b => blockRow(b, p.date, true, n)).join('')}</ol>
    <div class="center"><button class="btn ghost" data-act="replan">${S.busy ? 'Re-planning…' : 'Re-plan from where I am now'}</button></div>
    ${rulesNotFollowed(plan, n, today)}`;
}

function rulesNotFollowed(plan, n, today) {
  const ov = {}; for (const c of S.changes.filter(c => c.kind === 'day' && c.date === today)) for (const [k, v] of Object.entries(c.overrides || {})) ov[k] = v;
  const list = SC.ruleCheck(plan, (S.settings && S.settings.prefs && S.settings.prefs.rules) || {}, n, ov);
  const walk = (plan.blocks || []).reduce((a, x) => a + (x.walk || 0), 0), walked = (plan.blocks || []).filter(x => x.walk && x.done).reduce((a, x) => a + x.walk, 0);
  return `<h2>Rules not followed today</h2>
    ${list.length ? `<ul class="list broken">${list.map(x => `<li><span><b>${esc(x.rule)}</b><br><span class="dim">${esc(x.why)}</span></span><span class="tag ${x.kind}">${x.kind === 'plan' ? 'didn’t fit' : 'missed'}</span></li>`).join('')}</ul>` : '<p class="sub good">Every rule is followed so far today.</p>'}
    <p class="sub">Walking pad: ${walked} of ${walk} min done so far. Walking during meals and study counts when you check that item.</p>`;
}

// ---------------------------------------------------------------- Calendar
function weekStarts() {
  const today = nowLocal().date, first = addDays(today, -SC.dowOf(today)), out = [];
  for (let w = first; w <= (S.term ? S.term.last : addDays(today, 90)); w = addDays(w, 7)) out.push(w);
  return out;
}
function daySummary(d) {
  const b = d.blocks, I = S.term.items, rows = [];
  const brk = !b.some(x => x.type === 'class') && SC.dowOf(d.date) < 5;
  for (const c of I.exams[d.date] || []) rows.push(['exam', `<b>Exam</b> ${esc(c)} (assumed today)`]);
  for (const x of I.inClass[d.date] || []) rows.push(['uni', `<b>In class</b> ${t12(x.at)} ${esc(x.course)} <b>${esc(x.title)}</b>${x.weight ? ` (${esc(x.weight)})` : ''}${x.room ? ` · ${esc(x.room)}` : ''}`]);
  for (const x of I.opens[d.date] || []) rows.push(['home', `<b>At home</b> ${esc(x.course)} <b>${esc(x.title)}</b>${x.weight ? ` (${esc(x.weight)})` : ''} opens${x.assumed ? ' (assumed)' : ''} · due ${esc(dlong(x.due.date))} ${t12(x.due.min)}`]);
  const g = b.find(x => x.type === 'gym'), gd = g && b.find(x => x.type === 'drive' && x.to === g.loc);
  rows.push(['gym', g ? `<b>Gym</b> ${esc(SHORT[g.loc])} ${t12(g.start)} (${esc(d.gym ? d.gym.crowd : '')})${gd ? `, leave ${t12(gd.start)}` : ''}${/shower/.test(g.detail || '') ? ', shower there' : ''}` : '<b>Gym</b> none today']);
  const cook = b.find(x => x.type === 'cook');
  rows.push(['food', `<b>Meals</b> ${b.filter(x => x.type === 'meal').sort((p, q) => p.start - q.start).map(x => `${MEAL[x.meal]} ${t12(x.start)}${x.meal === 'breakfast' && cook ? ' (you cook)' : ''}${x.loc === 'car' ? ' (car)' : x.loc !== 'home' ? ` (${esc(SHORT[x.loc] || x.loc)})` : ''}${x.nonStim ? ' (non-stim)' : ''}`).join(' · ')}`]);
  const st = []; for (const x of b.filter(x => x.type === 'study').sort((p, q) => p.start - q.start)) { const nme = x.title.replace(/^Study for /, '').replace(/^Revise for /, 'revise ').replace('midterm exams week', 'midterms').replace('final exams', 'finals'); const l = st[st.length - 1]; if (l && l.n === nme && l.e === x.start) l.e = x.end; else st.push({ n: nme, s: x.start, e: x.end, loc: x.loc }); }
  if (st.length) rows.push(['uni', `<b>Study</b> ${st.map(x => `${t12(x.s)}–${t12(x.e)} ${esc(x.n)}${x.loc !== 'home' ? ` (${esc(SHORT[x.loc] || x.loc)})` : ''}`).join(' · ')}`]);
  const er = b.find(x => x.type === 'errand'); if (er) rows.push(['food', `<b>Groceries</b> ${t12(er.start)}–${t12(er.end)}`]);
  const gm = b.find(x => x.type === 'place'); if (gm) rows.push(['drive', `<b>Break</b> at your grandmother’s ${t12(gm.start)}–${t12(gm.end)}`]);
  rows.push(['walk', `<b>Walking pad</b> ${Math.round((d.walk || 0) / 6) / 10} h`]);
  const bring = [...new Set(b.filter(x => x.type === 'drive' && x.from === 'home' && (x.bring || []).length).flatMap(x => x.bring.map(y => y.split(' — ')[0])))];
  if (bring.length) rows.push(['gym', `<b>Bring</b> ${esc(bring.join(', '))}`]);
  for (const w of d.warnings || []) rows.push(['warn', esc(w)]);
  return rows;
}
function calendarTab() {
  if (S.termErr) return `<div class="dayhead"><div class="eb">Calendar</div><h1>This term</h1></div><div class="card"><p>Couldn’t build the calendar: ${esc(S.termErr)}</p><button class="btn" data-act="term">Try again</button></div>`;
  if (!S.term) return `<div class="dayhead"><div class="eb">Calendar</div><h1>This term</h1></div><p class="sub">Planning every day until your last exam…</p>`;
  const weeks = weekStarts(), today = nowLocal().date;
  if (!weeks.includes(S.week)) S.week = weeks[0];
  const label = w => w === weeks[0] ? 'This week' : w === weeks[1] ? 'Next week' : `${+w.slice(8)} ${dlong(w).slice(-3)}`;
  const days = S.term.days.filter(d => d.date >= S.week && d.date < addDays(S.week, 7));
  return `<div class="dayhead"><div><div class="eb">Calendar</div><h1>Week of ${esc(dlong(S.week).slice(4))}</h1></div></div>
    <div class="dchips">${weeks.map(w => `<button class="wchip ${w === S.week ? 'on' : ''}" data-week="${w}">${esc(label(w))}</button>`).join('')}</div>
    ${days.length ? days.map(d => `<div class="card day ${d.date === today ? 'is-today' : ''}" data-day="${d.date}">
        <div class="dh"><b>${esc(dlong(d.date))}</b>${d.date === today ? ' <span class="chip">today</span>' : ''}<span class="dim">${d.wake != null ? `up ${t12(d.wake)} · ` : ''}sleep ${t12(d.bed)}</span></div>
        <ul class="sum">${daySummary(d).map(([k, h]) => `<li class="k-${k}">${h}</li>`).join('')}</ul></div>`).join('') : '<p class="sub">Nothing planned this week.</p>'}
    <p class="sub">Tap a day for the hour-by-hour plan.</p>`;
}

// ---------------------------------------------------------------- Jarvis
function jarvisTab() {
  const ideas = ['No gym today', 'Class is cancelled today', 'Eating out tonight, skip dinner', 'Gym at 10pm tonight', 'Sleep by 11 tonight', 'From now on, 45 min for quizzes'];
  const day = S.changes.filter(c => c.kind === 'day'), notes = S.changes.filter(c => c.kind === 'rule');
  const msgs = S.messages.slice(-14).map(m => `<div class="msg ${m.role}">${esc(m.body)}</div>`).join('');
  return `<div class="dayhead"><div><div class="eb">Jarvis</div><h1>What’s changing?</h1></div></div>
    <p class="sub">Tell Jarvis like you’d text it. It changes your schedule and remembers: one-day things for that day, “from now on” things become rules (see Settings).</p>
    ${msgs ? `<div class="msgs">${msgs}</div>` : ''}
    <form id="tellf" class="tell"><textarea id="tellt" rows="2" placeholder="No gym tomorrow, I have a family dinner 8–10pm" ${S.busy ? 'disabled' : ''}></textarea><button class="btn" ${S.busy ? 'disabled' : ''}>${S.busy ? '…' : 'Send'}</button></form>
    <div class="ideas">${ideas.map(i => `<button class="chip btnchip" data-say="${esc(i)}">${esc(i)}</button>`).join('')}</div>
    <h2>Changes Jarvis is using</h2>
    ${day.length ? `<ul class="list">${day.map(c => `<li><span><b>${esc(dlong(c.date))}</b> ${esc(c.text)}</span><button class="x" data-forget="${c.id}" aria-label="Remove">✕</button></li>`).join('')}</ul>` : '<p class="sub">None right now.</p>'}
    <h2>Notes you asked it to remember</h2>
    ${notes.length ? `<ul class="list">${notes.map(c => `<li><span>${esc(c.text)}</span><button class="x" data-forget="${c.id}" aria-label="Remove">✕</button></li>`).join('')}</ul>` : '<p class="sub">Nothing yet.</p>'}`;
}

// ---------------------------------------------------------------- Settings
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function ruleInput(it, val, changed) {
  const k = it.key;
  if (it.fmt === 'time') return `<input class="rin" type="time" data-rule="${k}" data-fmt="time" value="${hm(val)}">`;
  if (it.fmt === 'dow') return `<select class="rin" data-rule="${k}" data-fmt="dow">${DAYS.map((d, i) => `<option value="${i}" ${i === val ? 'selected' : ''}>${d}</option>`).join('')}</select>`;
  const shown = it.fmt === 'h' && k !== 'openFallbackH' && k !== 'stimFreeH' ? val / 60 : val;
  return `<span class="rnum"><input class="rin" type="number" min="0" step="${it.fmt === 'h' ? 0.5 : 5}" data-rule="${k}" data-fmt="${it.fmt}" value="${shown}"><span class="dim">${it.fmt === 'min' ? 'min' : it.fmt === 'h' ? 'h' : 'days'}</span></span>`;
}
function settingsTab() {
  const pl = S.settings ? S.settings.places || {} : {}, mine = (S.settings && S.settings.prefs && S.settings.prefs.rules) || {};
  const placeRow = k => `<li><span><b>${esc(PLACE_NAME[k][0].toUpperCase() + PLACE_NAME[k].slice(1))}</b> ${pl[k] ? '<span class="good">set</span>' : '<span class="warn">not set</span>'}</span>
      <span class="pa"><button class="btn sm ghost" data-here="${k}">I’m here</button><button class="btn sm ghost" data-link="${k}">Paste link</button></span></li>`;
  const ps = S.push;
  const rules = RULE_TEXT.map(g => `<h3>${esc(g.group)}</h3><ul class="list rules">${g.items.map(it => {
    if (!it.key) return `<li><span>${esc(it.text)}</span></li>`;
    const changed = mine[it.key] != null, val = changed ? mine[it.key] : RULES[it.key];
    return `<li class="${changed ? 'chg' : ''}"><span>${esc(it.text)}</span><span class="rv">${ruleInput(it, val)}${changed ? `<button class="x" data-reset="${it.key}" title="Back to default">↺</button>` : ''}</span></li>`;
  }).join('')}</ul>`).join('');
  return `<div class="dayhead"><div><div class="eb">Settings</div><h1>Jarvis</h1></div></div>
    <h2>Your places</h2><ul class="list">${['home', 'grandma', 'uni', 'gym_rigae', 'gym_mahboula', 'gym_sabah'].map(placeRow).join('')}</ul>
    <h2>Notifications</h2>
    <p class="sub">Leave times (checked against live traffic), what to bring, when to text the maid, each block as it starts, and a nudge to open Jarvis when it isn’t sure where you are.</p>
    <div class="row">${ps && ps.subscribed ? '<span class="good">On for this device</span>' : '<button class="btn" data-act="push">Turn on notifications</button>'}<button class="btn ghost" data-act="testpush">Send a test</button></div>
    <h2>Your rules</h2><p class="sub">Jarvis builds every day from these. Change a number here, or tell Jarvis (“from now on…”). Changed rules are highlighted; ↺ puts one back.</p>
    ${rules}
    <div class="center"><button class="btn ghost" data-act="signout">Sign out</button></div>`;
}

// ---------------------------------------------------------------- shell
function sheet(html) { const d = $('#sheet'); d.innerHTML = `<div class="sh">${html}<div class="row"><button class="btn ghost" data-act="close">Close</button></div></div>`; d.showModal(); }
function render() {
  const app = $('#app');
  if (!API.user) { app.innerHTML = `<main class="wrap login"><h1>Jarvis</h1><p class="sub">Same account as Uni Planner, PPL Coach and Nutrition Coach.</p><form id="loginf"><input id="em" type="email" placeholder="Email" autocomplete="email" required><input id="pw" type="password" placeholder="Password" autocomplete="current-password" required><button class="btn">Sign in</button></form></main>`; return; }
  const tabs = [['today', 'Today'], ['calendar', 'Calendar'], ['jarvis', 'Jarvis'], ['settings', 'Settings']];
  const body = S.tab === 'today' ? todayTab() : S.tab === 'calendar' ? calendarTab() : S.tab === 'jarvis' ? jarvisTab() : settingsTab();
  const y = window.scrollY;
  app.innerHTML = `<main class="wrap">${body}</main><nav class="tabbar">${tabs.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>`;
  if (S.tab === 'today' && !render.scrolled) { const c = app.querySelector('.blk.cur') || app.querySelector('.blk:not(.past):not(.done)'); if (c) { render.scrolled = true; c.scrollIntoView({ block: 'center' }); } }
  else if (render.keep) window.scrollTo(0, y);
  render.keep = false;
}
function wire() {
  document.addEventListener('click', async e => {
    const el = e.target.closest('button, [data-open], [data-day]'); if (!el) return;
    const d = el.dataset;
    if (d.tab) {
      S.tab = d.tab; render.scrolled = false; window.scrollTo(0, 0); render();
      if (d.tab === 'calendar' && !S.term) loadTerm();
      if (d.tab === 'jarvis' && !S.messages.length) { S.messages = await API.messages(14).catch(() => []); render(); }
      if (d.tab === 'settings') { S.push = await API.pushStatus(); render.keep = true; render(); }
      return;
    }
    if (d.tick) { e.stopPropagation(); return tick(d.date, d.tick, !el.classList.contains('on')); }
    if (d.week) { S.week = d.week; render(); return; }
    if (d.say) { if (S.tab !== 'jarvis') { S.tab = 'jarvis'; render(); } const t = $('#tellt'); if (t) { t.value = d.say; t.focus(); } return; }
    if (d.forget) { try { await API.call('forget', { id: d.forget }); await load(); S.term = null; render(); toast('Removed — schedule updated.'); } catch (x) { toast(x.message); } return; }
    if (d.reset) { try { await API.setRule(d.reset, null); await afterRuleChange(); } catch (x) { toast(x.message); } return; }
    if (d.here) { toast('Getting your location…'); const c = await locate(10000); if (!c) return toast('Couldn’t get your location — allow location for Jarvis.'); try { await API.call('place', { key: d.here, coords: c }); await load(); S.term = null; render.keep = true; render(); toast(`${PLACE_NAME[d.here]} saved.`); } catch (x) { toast(x.message); } return; }
    if (d.link) { const url = prompt(`Paste a Google Maps link for ${PLACE_NAME[d.link]}`); if (!url) return; try { await API.call('place', { key: d.link, url }); await load(); S.term = null; render.keep = true; render(); toast('Saved.'); } catch (x) { toast(x.message); } return; }
    if (d.day && S.term) {
      const day = S.term.days.find(x => x.date === d.day); if (!day) return;
      sheet(`<div class="eb">${esc(DAYS[SC.dowOf(day.date)])}</div><h2>${esc(dlong(day.date))}</h2><ol class="tl">${day.blocks.map(b => blockRow(b, day.date, false, 0, false)).join('')}</ol>`);
      return;
    }
    if (d.open) {
      const p = S.plans.find(p => p.date === d.date), b = p && p.plan.blocks.find(x => String(x.ref || x.start) === d.open); if (!b) return;
      if (b.type === 'maid') sheet(`<div class="eb">Text the maid</div><pre class="msgtext">${esc(b.message)}</pre><div class="row"><button class="btn" data-copy="1">Copy message</button>${b.check ? `<button class="btn ghost" data-tick="${esc(b.ref)}" data-date="${d.date}">${b.done ? 'Not sent' : 'Mark as sent'}</button>` : ''}</div>`);
      else sheet(`<div class="eb">${esc(blockTime(b))}</div><h2>${esc(b.title)}</h2><p class="long">${esc(b.detail)}</p>`);
      S.open = b; return;
    }
    if (d.copy) { try { await navigator.clipboard.writeText(S.open.message); toast('Copied — paste it to her.'); } catch { toast('Couldn’t copy — long-press the text instead.'); } return; }
    if (d.act === 'close') { $('#sheet').close(); return; }
    if (d.act === 'replan') return replan('Re-planned from the app');
    if (d.act === 'term') return loadTerm();
    if (d.act === 'push') { try { await API.pushOn(); S.push = await API.pushStatus(); render.keep = true; render(); toast('Notifications on.'); } catch (x) { toast(x.message); } return; }
    if (d.act === 'testpush') { try { const r = await API.call('test-push'); toast(r.error || `Sent to ${r.delivered} device${r.delivered === 1 ? '' : 's'}.`); } catch (x) { toast(x.message); } return; }
    if (d.act === 'signout') { await API.signOut(); location.reload(); }
  });
  document.addEventListener('change', async e => {
    const el = e.target; if (!el.dataset || !el.dataset.rule) return;
    const f = el.dataset.fmt, k = el.dataset.rule;
    let v = f === 'time' ? (([h, m]) => +h * 60 + +m)(el.value.split(':')) : +el.value;
    if (f === 'h' && k !== 'openFallbackH' && k !== 'stimFreeH') v = Math.round(v * 60);
    if (!isFinite(v) || v < 0) return toast('That isn’t a valid number.');
    try { await API.setRule(k, v === RULES[k] ? null : v); await afterRuleChange(); } catch (x) { toast(x.message); }
  });
  document.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'tellf') { const v = $('#tellt').value; $('#tellt').value = ''; return tell(v); }
    if (e.target.id === 'loginf') { try { await API.signIn($('#em').value, $('#pw').value); } catch (x) { toast(x.message); } }
  });
  document.addEventListener('keydown', e => { if (e.target.id === 'tellt' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#tellf').requestSubmit(); } });
  // coming back to the app: re-plan from where he is (that's how Jarvis follows him)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && API.user && Date.now() - (wire.last || 0) > 5 * 60000) { wire.last = Date.now(); replan(); } });
  setInterval(() => { if (API.user && S.tab === 'today' && !S.busy) render(); }, 60000);
}
async function afterRuleChange() {
  await load(); S.term = null; render.keep = true; render(); toast('Rule saved — re-planning.');
  try { await API.call('plan', {}); await load(); } catch (x) { toast(x.message); }
  render.keep = true; render();
}

export async function start(api) {
  API = api; wire();
  API.user = await API.getUser();
  API.onAuth(async u => { const was = !!API.user; API.user = u; if (u && !was) { await load().catch(() => {}); render(); replan(); } });
  if (API.user) { await load().catch(e => toast(e.message)); render(); wire.last = Date.now(); replan(); }
  else render();
}
