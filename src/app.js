// Jarvis — the app. Today hour by hour, the week, a box to tell Jarvis changes, and settings.
import { t12, dlong, addDays, localOf, PLACE_NAME, DAYS, RULES } from './scheduler.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowLocal = () => { const l = localOf(new Date().toISOString()); return l.min < 180 ? { date: addDays(l.date, -1), min: l.min + 1440 } : l; };
const ICON = { drive: '→', class: '◆', exam: '◆', gym: '▲', meal: '●', cook: '◐', study: '■', walk: '≈', errand: '▣', maid: '✉', busy: '◇', place: '⌂', wake: '☀', sleep: '☾' };
const TINT = { class: 'uni', exam: 'uni', study: 'uni', gym: 'gym', meal: 'food', cook: 'food', maid: 'food', errand: 'food', walk: 'walk', drive: 'drive' };
const RULE_LABEL = {
  classEarly: 'At uni before class (min)', taskMin: 'Quiz / assignment / pre-lab (min)', openFallbackH: 'No open date: assume it opened (hours before due)',
  labReviewMin: 'Graded lab revision, day before (min)', gcaStudyMin: 'GCA study (min)', gcaDaysBefore: 'GCA study, days before',
  examStartDays: 'Exam study starts (days before exam week)', examDailyMin: 'Exam study per day (min)', examFinalWeekMin: 'Exam study per day, last week (min)',
  studyChunkMax: 'Longest study block (min)', sleepPrefer: 'Preferred sleep (min)', sleepMin: 'Minimum sleep (min)', walkMin: 'Walking pad per day (min)',
  maidFrom: 'Maid starts (min after midnight)', maidTo: 'Maid stops (min after midnight)', groceryMin: 'Grocery shop (min)', groceryDrive: 'Drive to the co-op (min)',
  showerMin: 'Shower at the gym (min)', readyMin: 'Getting ready (min)', eatMin: 'Eating (min)', cookSelfMin: 'Cooking breakfast yourself (min)',
  lunchAt: 'Lunch around (min after midnight)', dinnerAt: 'Dinner around (min after midnight)', examMinutes: 'Exam length if unknown (min)', groceryDow: 'Grocery day (0 = Sun … 6 = Sat)', defaultBed: 'Bed with nothing to go by'
};

let API, S = { tab: 'today', day: null, plans: [], where: null, changes: [], settings: null, messages: [], busy: false, open: null, push: null };

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
  if (!S.day || S.day < t) S.day = t;
}
async function replan(reason) {
  if (S.busy) return; S.busy = true; render();
  try {
    const coords = await locate();
    const r = await API.call('plan', { coords, reason });
    S.where = r.where;
    await load();
  } catch (e) { toast(e.message); }
  S.busy = false; render();
}
async function tick(date, ref, done) {
  const p = S.plans.find(p => p.date === date); const b = p && p.plan.blocks.find(x => x.ref === ref);
  if (b) { b.done = done; render(); }
  try {
    const coords = date === nowLocal().date ? await locate(4000) : null;
    const r = await API.call('tick', { date, ref, done, coords });
    if (r.where) S.where = r.where;
    await load(); render();
  } catch (e) { toast(e.message); if (b) { b.done = !done; render(); } }
}
async function tell(message) {
  if (!message.trim() || S.busy) return;
  S.busy = true; S.messages.push({ role: 'user', body: message }); render();
  try {
    const coords = await locate(5000);
    const r = await API.call('tell', { message, coords });
    S.messages.push({ role: 'jarvis', body: r.reply });
    await load();
  } catch (e) { S.messages.push({ role: 'jarvis', body: `Couldn’t do that: ${e.message}` }); }
  S.busy = false; render();
}

// ---------------------------------------------------------------- views
const blockTime = b => b.instant || b.start === b.end ? t12(b.start) : `${t12(b.start)} – ${t12(b.end)}`;
function blockRow(b, date, isToday, nowMin) {
  const past = isToday && b.end <= nowMin && !b.done, cur = isToday && b.start <= nowMin && b.end > nowMin;
  const tint = TINT[b.type] || 'jarvis';
  const check = b.check ? `<button class="tick ${b.done ? 'on' : ''}" data-tick="${esc(b.ref)}" data-date="${date}" aria-label="${b.done ? 'Uncheck' : 'Check'} ${esc(b.title)}">${b.done ? '✓' : ''}</button>` : '<span class="tick none"></span>';
  const bring = (b.bring || []).length ? `<ul class="bring">${b.bring.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const extra = [b.walk ? `<span class="chip walk">≈ walking pad ${b.walk} min</span>` : '', b.trafficNote ? `<span class="chip warn">${esc(b.trafficNote)}</span>` : '', (b.supplements || []).length ? `<span class="chip">${esc(b.supplements.join(' · '))}</span>` : ''].join('');
  const openable = b.type === 'maid' || b.type === 'cook' || (b.detail && b.detail.length > 90);
  return `<li class="blk t-${tint} ${b.done ? 'done' : ''} ${past ? 'past' : ''} ${cur ? 'cur' : ''} ty-${b.type}" ${openable ? `data-open="${esc(b.ref || b.start)}" data-date="${date}"` : ''}>
    <div class="when tnum">${blockTime(b)}</div>
    <div class="ico">${ICON[b.type] || '·'}</div>
    <div class="what"><div class="ttl">${esc(b.title)}</div>${b.detail ? `<div class="det">${esc(openable && b.type !== 'maid' ? b.detail.slice(0, 90) + (b.detail.length > 90 ? '…' : '') : b.detail)}</div>` : ''}${extra ? `<div class="chips">${extra}</div>` : ''}${bring}</div>
    ${check}</li>`;
}
function dayView(p, isToday) {
  if (!p) return `<div class="card empty"><p>No plan for this day yet.</p><button class="btn" data-act="replan">Plan it</button></div>`;
  const plan = p.plan, n = nowLocal().min;
  const blocks = plan.blocks.filter(b => b.type !== 'place');
  const issues = [...(plan.warnings || []).map(w => ({ problem: w })), ...((plan.check && !plan.check.ok && plan.check.issues) || [])];
  const head = `<div class="dayhead">
      <div><div class="eb">${isToday ? 'Today' : DAYS[new Date(p.date + 'T00:00:00Z').getUTCDay()]}</div><h1>${esc(dlong(p.date))}</h1></div>
      <div class="facts">${plan.gym ? `<span><b>Gym</b> ${esc(PLACE_NAME[plan.gym.at])} · ${t12(plan.gym.start)} · ${esc(plan.gym.crowd)}</span>` : '<span><b>Gym</b> none</span>'}<span><b>Sleep</b> ${t12(plan.bed)}</span><span><b>Walking pad</b> ${plan.walk} min</span></div>
    </div>`;
  const where = isToday && (plan.where || S.where) ? `<div class="where">You’re at <b>${esc(PLACE_NAME[(S.where || plan.where).loc] || (S.where || plan.where).loc)}</b> — ${esc((S.where || plan.where).how)}</div>` : '';
  const checked = plan.check ? (plan.check.ok ? `<div class="ok">✓ Jarvis checked this day — it works.</div>` : '') : (isToday ? `<div class="ok dim">Jarvis is double-checking this day…</div>` : '');
  const iss = issues.length ? `<div class="card issues"><div class="eb warn">Heads up</div><ul>${issues.map(i => `<li>${i.at ? `<b>${esc(i.at)}</b> ` : ''}${esc(i.problem)}${i.fix ? `<button class="fix" data-say="${esc(i.fix)}">${esc(i.fix)}</button>` : ''}</li>`).join('')}</ul></div>` : '';
  const next = isToday ? blocks.find(b => b.type === 'drive' && !b.done && b.end > n) : null;
  const nextCard = next ? `<div class="card next"><div class="eb">Next drive</div><div class="big tnum">Leave ${t12(next.start)}</div><div>${esc(next.title)} · ${esc(next.detail)}</div>${(next.bring || []).length ? `<ul class="bring">${next.bring.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : '';
  return `${head}${where}${iss}${nextCard}${checked}<ol class="tl">${blocks.map(b => blockRow(b, p.date, isToday, n)).join('')}</ol>`;
}
function todayTab() {
  const t = nowLocal().date, p = S.plans.find(p => p.date === t);
  return `${dayView(p, true)}<div class="center"><button class="btn ghost" data-act="replan">${S.busy ? 'Re-planning…' : 'Re-plan from where I am now'}</button></div>`;
}
function weekTab() {
  const t = nowLocal().date;
  const chips = [...Array(7)].map((_, i) => { const d = addDays(t, i); return `<button class="dchip ${S.day === d ? 'on' : ''}" data-day="${d}"><span>${i === 0 ? 'Today' : i === 1 ? 'Tmrw' : DAYS[new Date(d + 'T00:00:00Z').getUTCDay()].slice(0, 3)}</span><b>${+d.slice(8)}</b></button>`; }).join('');
  const p = S.plans.find(p => p.date === S.day);
  return `<div class="dchips">${chips}</div>${dayView(p, S.day === t)}`;
}
function tellTab() {
  const ideas = ['No gym today', 'I’m at my grandmother’s from 4 to 7', 'Class is cancelled today', 'Eating out tonight, skip dinner', 'Gym at 10pm tonight', 'Sleep by 11 tonight'];
  const day = S.changes.filter(c => c.kind === 'day'), notes = S.changes.filter(c => c.kind === 'rule');
  const msgs = S.messages.slice(-10).map(m => `<div class="msg ${m.role}">${esc(m.body)}</div>`).join('');
  return `<div class="dayhead"><div><div class="eb">Tell Jarvis</div><h1>What’s changing?</h1></div></div>
    <p class="sub">Say it like you’d text it. Jarvis changes the plan and remembers it — one-day things for that day, “from now on” things for good.</p>
    <form id="tellf" class="tell"><textarea id="tellt" rows="2" placeholder="e.g. No gym tomorrow, I have a family dinner 8–10pm" ${S.busy ? 'disabled' : ''}></textarea><button class="btn" ${S.busy ? 'disabled' : ''}>${S.busy ? '…' : 'Send'}</button></form>
    <div class="ideas">${ideas.map(i => `<button class="chip btnchip" data-say="${esc(i)}">${esc(i)}</button>`).join('')}</div>
    ${msgs ? `<div class="msgs">${msgs}</div>` : ''}
    <h2>Changes Jarvis is using</h2>
    ${day.length ? `<ul class="list">${day.map(c => `<li><span><b>${esc(dlong(c.date))}</b> ${esc(c.text)}</span><button class="x" data-forget="${c.id}" aria-label="Remove">✕</button></li>`).join('')}</ul>` : '<p class="sub">None right now.</p>'}
    <h2>Things you asked it to remember</h2>
    ${notes.length ? `<ul class="list">${notes.map(c => `<li><span>${esc(c.text)}</span><button class="x" data-forget="${c.id}" aria-label="Remove">✕</button></li>`).join('')}</ul>` : '<p class="sub">Nothing yet.</p>'}`;
}
function settingsTab() {
  const pl = S.settings ? S.settings.places || {} : {}, rules = (S.settings && S.settings.prefs && S.settings.prefs.rules) || {};
  const placeRow = k => `<li><span><b>${esc(PLACE_NAME[k][0].toUpperCase() + PLACE_NAME[k].slice(1))}</b> ${pl[k] ? '<span class="good">set</span>' : '<span class="warn">not set</span>'}</span>
      <span class="pa"><button class="btn sm ghost" data-here="${k}">I’m here</button><button class="btn sm ghost" data-link="${k}">Paste link</button></span></li>`;
  const ruleRows = Object.keys(RULES).filter(k => RULE_LABEL[k]).map(k => `<li><span>${esc(RULE_LABEL[k])}</span><span class="tnum">${rules[k] != null ? `<b>${rules[k]}</b> <button class="x" data-rule="${k}" title="Back to ${RULES[k]}">↺</button>` : RULES[k]}</span></li>`).join('');
  const ps = S.push;
  return `<div class="dayhead"><div><div class="eb">Settings</div><h1>Jarvis</h1></div></div>
    <h2>Your places</h2><ul class="list">${['home', 'grandma', 'uni', 'gym_rigae', 'gym_mahboula', 'gym_sabah'].map(placeRow).join('')}</ul>
    <h2>Notifications</h2>
    <p class="sub">Leave times (re-checked against live traffic), what to bring, when to text the maid, each block as it starts, and a nudge to open Jarvis when it isn’t sure where you are.</p>
    <div class="row">${ps && ps.subscribed ? '<span class="good">On for this device</span>' : `<button class="btn" data-act="push">Turn on notifications</button>`}<button class="btn ghost" data-act="testpush">Send a test</button></div>
    <h2>Your rules</h2><p class="sub">Change any of these by telling Jarvis (“from now on, 45 min for quizzes”). Changed ones are bold — ↺ puts it back.</p>
    <ul class="list rules">${ruleRows}</ul>
    <div class="center"><button class="btn ghost" data-act="signout">Sign out</button></div>`;
}
function sheet(html) { const d = $('#sheet'); d.innerHTML = `<div class="sh">${html}<div class="row"><button class="btn ghost" data-act="close">Close</button></div></div>`; d.showModal(); }

function render() {
  const app = $('#app');
  if (!API.user) { app.innerHTML = loginView(); return; }
  const tabs = [['today', 'Today'], ['week', 'Week'], ['tell', 'Tell'], ['settings', 'Settings']];
  const body = S.tab === 'today' ? todayTab() : S.tab === 'week' ? weekTab() : S.tab === 'tell' ? tellTab() : settingsTab();
  app.innerHTML = `<main class="wrap">${body}</main><nav class="tabbar">${tabs.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>`;
  if (S.tab === 'today') { const c = app.querySelector('.blk.cur') || app.querySelector('.blk:not(.past):not(.done)'); if (c && !render.scrolled) { render.scrolled = true; c.scrollIntoView({ block: 'center' }); } }
}
function loginView() {
  return `<main class="wrap login"><h1>Jarvis</h1><p class="sub">Same account as Uni Planner, PPL Coach and Nutrition Coach.</p>
    <form id="loginf"><input id="em" type="email" placeholder="Email" autocomplete="email" required><input id="pw" type="password" placeholder="Password" autocomplete="current-password" required><button class="btn">Sign in</button></form></main>`;
}

// ---------------------------------------------------------------- events
function wire() {
  document.addEventListener('click', async e => {
    const el = e.target.closest('button, [data-open]'); if (!el) return;
    const d = el.dataset;
    if (d.tab) { S.tab = d.tab; render.scrolled = false; render(); if (d.tab === 'tell' && !S.messages.length) { S.messages = await API.messages(10).catch(() => []); render(); } if (d.tab === 'settings') { S.push = await API.pushStatus(); render(); } return; }
    if (d.tick) { e.stopPropagation(); return tick(d.date, d.tick, !el.classList.contains('on')); }
    if (d.day) { S.day = d.day; render(); return; }
    if (d.say) { if (S.tab !== 'tell') { S.tab = 'tell'; render(); } const t = $('#tellt'); if (t) { t.value = d.say; t.focus(); } return; }
    if (d.forget) { try { await API.call('forget', { id: d.forget }); await load(); render(); toast('Removed — plan updated.'); } catch (x) { toast(x.message); } return; }
    if (d.rule) { try { await API.call('rule', { key: d.rule }); await load(); render(); } catch (x) { toast(x.message); } return; }
    if (d.here) { toast('Getting your location…'); const c = await locate(10000); if (!c) return toast('Couldn’t get your location — allow location for Jarvis.'); try { await API.call('place', { key: d.here, coords: c }); await load(); render(); toast(`${PLACE_NAME[d.here]} saved.`); } catch (x) { toast(x.message); } return; }
    if (d.link) { const url = prompt(`Paste a Google Maps link for ${PLACE_NAME[d.link]}`); if (!url) return; try { await API.call('place', { key: d.link, url }); await load(); render(); toast('Saved.'); } catch (x) { toast(x.message); } return; }
    if (d.open) {
      const p = S.plans.find(p => p.date === d.date), b = p && p.plan.blocks.find(x => String(x.ref || x.start) === d.open); if (!b) return;
      if (b.type === 'maid') sheet(`<div class="eb">Text the maid</div><pre class="msgtext">${esc(b.message)}</pre><div class="row"><button class="btn" data-copy="1">Copy message</button>${b.check ? `<button class="btn ghost" data-tick="${esc(b.ref)}" data-date="${d.date}">${b.done ? 'Not sent' : 'Mark as sent'}</button>` : ''}</div>`);
      else sheet(`<div class="eb">${esc(blockTime(b))}</div><h2>${esc(b.title)}</h2><p class="long">${esc(b.detail)}</p>`);
      S.open = b; return;
    }
    if (d.copy) { try { await navigator.clipboard.writeText(S.open.message); toast('Copied — paste it to her.'); } catch { toast('Couldn’t copy — long-press the text instead.'); } return; }
    if (d.act === 'close') { $('#sheet').close(); return; }
    if (d.act === 'replan') return replan('Re-planned from the app');
    if (d.act === 'push') { try { await API.pushOn(); S.push = await API.pushStatus(); render(); toast('Notifications on.'); } catch (x) { toast(x.message); } return; }
    if (d.act === 'testpush') { try { const r = await API.call('test-push'); toast(r.error || `Sent to ${r.delivered} device${r.delivered === 1 ? '' : 's'}.`); } catch (x) { toast(x.message); } return; }
    if (d.act === 'signout') { await API.signOut(); location.reload(); }
  });
  document.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'tellf') { const v = $('#tellt').value; $('#tellt').value = ''; return tell(v); }
    if (e.target.id === 'loginf') { try { await API.signIn($('#em').value, $('#pw').value); } catch (x) { toast(x.message); } }
  });
  document.addEventListener('keydown', e => { if (e.target.id === 'tellt' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#tellf').requestSubmit(); } });
  // coming back to the app: re-plan from where he is (that's how Jarvis follows him)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && API.user && Date.now() - (wire.last || 0) > 5 * 60000) { wire.last = Date.now(); replan(); } });
  setInterval(() => { if (API.user && S.tab !== 'tell' && !S.busy) render(); }, 60000);
}

export async function start(api) {
  API = api; wire();
  API.user = await API.getUser();
  API.onAuth(async u => { const was = !!API.user; API.user = u; if (u && !was) { await load().catch(() => {}); render(); replan(); } });
  if (API.user) { await load().catch(e => toast(e.message)); render(); wire.last = Date.now(); replan(); }
  else render();
}
