// The preview backend: Jarvis's real core (the same code the server runs) on sample data, thinking with Claude
// through the page's `sample` capability on the viewer's own Claude account. Nothing reaches his real apps.
import { createJarvis } from './core.js';
import { createLocalDb } from './local-db.js';
import { SAMPLE } from './sample-data.js';
import * as E from './engine.js';
import { asJsonPrompt } from './brain.js';

const KEY = 'jarvis-preview-v2';
function previewBackend() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { }
  const db = createLocalDb(saved || JSON.parse(JSON.stringify(SAMPLE)));
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db.state)); } catch { } };
  let progress = () => { };
  const samplerP = window.claude && window.claude.use ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
  const why = e => ({ not_granted: 'Allow this page to use Claude (the prompt at the top) and Jarvis can think.', sampling_disabled: 'Claude isn’t available for this account here.',
    rate_limited: 'Claude’s usage limit was reached for a moment — try again shortly.', invalid_json: 'Claude’s answer came back garbled — try again.', prompt_too_large: 'That was too much to send at once.' }[e && e.code] || (e && e.message) || 'Claude couldn’t answer.');
  const ai = {
    async json({ system, turns, schema, task }) {
      const sample = await samplerP;
      if (!sample && window.claude && window.claude.complete) return completeJson({ system, turns, schema, task });
      if (!sample) throw new Error('This preview can’t reach Claude from here. Open it in the Claude app and allow it to use Claude.');
      const input = [{ role: 'user', content: asJsonPrompt({ system, user: turns[0].content }, schema) }, ...turns.slice(1)];
      try {
        return await sample.json(input, { cache: false, onText: ({ text }) => {
          if (task === 'plan') { const n = (text.match(/"start"\s*:/g) || []).length; progress(n ? `Writing your plan — ${n} block${n > 1 ? 's' : ''} so far` : 'Thinking it through…'); }
          else progress(task === 'review' ? 'Writing the analysis…' : task === 'solve' ? 'Working out your options…' : 'Writing…');
        } });
      } catch (e) { throw new Error(why(e)); }
    }
  };
  // Fallback for pages that only offer window.claude.complete: one call, JSON parsed from the reply.
  async function completeJson({ system, turns, schema, task }) {
    progress(task === 'plan' ? 'Thinking it through — this takes about a minute.' : task === 'review' ? 'Writing the analysis…' : task === 'solve' ? 'Working out your options…' : 'Writing…');
    const messages = [{ role: 'user', content: asJsonPrompt({ system, user: turns[0].content }, schema) }, ...turns.slice(1)];
    let text;
    try { text = await window.claude.complete({ model: 'claude-sonnet-4-5', max_tokens: 16000, messages }); }
    catch (e) { throw new Error(/rate/i.test(String(e && e.message)) ? why({ code: 'rate_limited' }) : `Claude couldn’t answer just now (${e && e.message || e}).`); }
    const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
    try { return JSON.parse(s.slice(a, b + 1)); } catch { throw new Error(why({ code: 'invalid_json' })); }
  }
  const places = { async drive({ settings }) { return { drive: E.makeDrive({ freeFlow: settings.travel || {}, parking: (settings.prefs && settings.prefs.parking) ?? 10 }), startLoc: null }; } };
  const clock = { today: () => E.localOf(new Date().toISOString(), 180).date, nowMin: () => E.localOf(new Date().toISOString(), 180).min };
  const J = createJarvis({ db, ai, places, clock });
  const user = { id: 'preview', email: 'Preview — sample data' };
  const done = async p => { try { return await p; } finally { persist(); } };
  return {
    mode: 'preview',
    banner: 'Preview on sample data. Jarvis thinks with Claude on your account.',
    async getUser() { return user; },
    onAuth(cb) { setTimeout(() => cb(user), 0); },
    async signIn() { }, async signOut() { },
    onProgress(f) { progress = f; },
    async call(action, body = {}) {
      if (action === 'plan') return done(J.plan(body));
      if (action === 'solve') return done(J.solve(body));
      if (action === 'choose') return done(J.choose(body));
      if (action === 'pantry') return done(J.setPantry({ changes: body.changes || [] }));
      if (action === 'kitchen') return J.kitchen();
      if (action === 'goals') return J.goals();
      if (action === 'mark') return done(J.addMark(body));
      if (action === 'ask') return done(J.ask(body));
      if (action === 'ahead') return { days: await J.ahead() };
      if (action === 'review') return done(body.app ? J.review({ app: body.app }).then(r => ({ [body.app]: r })) : J.reviewAll());
      if (action === 'report') return done(J.report().then(report => ({ report })));
      if (action === 'travel' || action === 'eta') return {};
      if (action === 'resolve-link') throw new Error('Links work in the installed app. In the preview, paste coordinates like 29.31, 47.98.');
      return { error: 'Not in the preview.' };
    },
    getPlan: date => db.getPlan(date),
    savePlan: (date, plan) => done(db.savePlan(date, plan)),
    dropPlans: dates => done(db.deletePlans(dates)),
    async listMemory() { const from = E.addDays(clock.today(), -1); return (await db.listMemory()).filter(m => m.kind !== 'day' || m.date >= from); },
    addMemory: row => done(db.insertMemory(row)),
    deleteMemory: id => done(db.deleteMemory(id)),
    updateMemory: (id, patch) => done(db.updateMemory(id, patch)),
    async getSettings() { return JSON.parse(JSON.stringify(db.state.settings)); },
    saveSettings: patch => done(db.saveSettings(patch)),
    async setRestDay(date, rest) {
      const prefs = { ...(db.state.settings.prefs || {}) }, set = new Set(prefs.restDays || []);
      rest ? set.add(date) : set.delete(date); prefs.restDays = [...set].sort();
      await db.saveSettings({ prefs }); await db.deletePlans([...Array(7)].map((_, i) => E.addDays(date, i)).filter(d => d !== clock.today())); persist();
    },
    listMessages: n => db.listMessages().then(m => m.slice(-n)),
    latestReviews: () => db.latestReviews(),
    async pushStatus() { return { supported: false, subscribed: false, perm: 'default' }; },
    async pushOn() { throw new Error('Notifications work in the installed app.'); }, async pushOff() { },
    async reset() { try { localStorage.removeItem(KEY); } catch { } }
  };
}
export { previewBackend };
