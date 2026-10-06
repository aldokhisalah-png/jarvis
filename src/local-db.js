// An in-memory `db` adapter for Jarvis's core — used by the preview and the tests.
// Same methods as the Supabase adapter in the backend. Nothing here touches the other apps' data except to read it.
import { shapeApps } from './core.js';

function createLocalDb(seed) {
  const S = {
    classes: seed.classes || [], events: seed.events || [], plannerSettings: seed.plannerSettings || {},
    pplRows: seed.pplRows || [], nutritionRows: seed.nutritionRows || [],
    settings: seed.settings || { places: {}, prefs: {}, travel: {} },
    memory: (seed.memory || []).map(m => ({ active: true, overrides: {}, created_at: new Date().toISOString(), ...m })),
    plans: seed.plans || [], messages: seed.messages || [], reviews: seed.reviews || [], reports: seed.reports || [], marks: seed.marks || []
  };
  let n = 0;
  const id = p => `${p}-${Date.now().toString(36)}-${(++n).toString(36)}`;
  const copy = x => JSON.parse(JSON.stringify(x));
  return {
    state: S,
    async load() {
      return { classes: copy(S.classes), events: copy(S.events), plannerSettings: copy(S.plannerSettings), ...shapeApps({ pplRows: S.pplRows, nutritionRows: S.nutritionRows }),
        settings: copy(S.settings), memory: copy(S.memory.filter(m => m.active !== false)), plans: copy(S.plans), marks: copy(S.marks) };
    },
    async getPlan(date) { const p = S.plans.find(p => p.date === date); return p ? copy(p.plan) : null; },
    async savePlan(date, plan) { S.plans = S.plans.filter(p => p.date !== date).concat({ date, plan: copy(plan) }).sort((a, b) => a.date < b.date ? -1 : 1); },
    async updatePlan(date, plan) { return this.savePlan(date, plan); },
    async deletePlans(dates) { S.plans = S.plans.filter(p => !dates.includes(p.date)); },
    async insertMemory(row) { const r = { id: id('m'), active: true, overrides: {}, serves: [], created_at: new Date(Date.now() + n).toISOString(), ...row }; S.memory.push(r); return copy(r); },
    async deleteMemory(mid) { const r = S.memory.find(m => m.id === mid); if (!r) return null; S.memory = S.memory.filter(m => m !== r); return copy(r); },
    async listMemory() { return copy(S.memory); },
    async updateMemory(mid, patch) { const r = S.memory.find(m => m.id === mid); if (r) Object.assign(r, copy(patch), { updated_at: new Date().toISOString() }); return r ? copy(r) : null; },
    async insertMark(row) { const r = { id: id('mk'), created_at: new Date().toISOString(), ...row }; S.marks.push(r); return copy(r); },
    async deleteMark(mid) { S.marks = S.marks.filter(m => m.id !== mid); },
    async saveSettings(patch) { S.settings = { ...S.settings, ...copy(patch) }; },
    async saveMessage(m) { S.messages.push({ id: id('msg'), created_at: new Date(Date.now() + (++n)).toISOString(), kind: null, title: null, data: null, ...copy(m) }); },
    async recentMessages(k) { return copy(S.messages.slice(-k)); },
    async listMessages() { return copy(S.messages); },
    async saveReview(app, review, stats) { S.reviews.push({ app, review: copy(review), stats: copy(stats), created_at: new Date().toISOString() }); },
    async latestReviews() { const out = { ppl: null, nutrition: null, uni: null }; for (const r of S.reviews) out[r.app] = copy(r.review); return out; },
    async saveReport(row) { S.reports.push({ ...copy(row), created_at: new Date().toISOString() }); },
    async latestReport() { const r = S.reports[S.reports.length - 1]; return r ? copy(r.report) : null; }
  };
}

export { createLocalDb };
