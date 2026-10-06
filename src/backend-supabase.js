// The live backend: Supabase (same project and sign-in as his other three apps) + the `jarvis` Edge Function.
// The app reads and writes only Jarvis's own tables here; his other apps are read by the function, never written.
import { addDays, localOf } from './engine.js';

function supabaseBackend(cfg) {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jv-auth' } });
  let uid = null;
  const one = async q => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
  const today = () => localOf(new Date().toISOString(), 180).date;
  const b64ToU8 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const api = {
    mode: 'live',
    async getUser() { const { data: { session } } = await sb.auth.getSession(); uid = session ? session.user.id : null; return session ? session.user : null; },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, session) => { uid = session ? session.user.id : null; cb(session ? session.user : null); }); },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message); },
    signOut: () => sb.auth.signOut(),
    async call(action, body = {}) {
      const { data, error } = await sb.functions.invoke('jarvis', { body: { action, ...body } });
      if (error) { let msg = error.message; try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch { } throw new Error(msg); }
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    async getPlan(date) { const r = await one(sb.from('day_plans').select('plan').eq('user_id', uid).eq('date', date).maybeSingle()); return r ? r.plan : null; },
    async savePlan(date, plan) { await one(sb.from('day_plans').update({ plan, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('date', date)); },
    async dropPlans(dates) { if (dates.length) await one(sb.from('day_plans').delete().eq('user_id', uid).in('date', dates)); },
    async listMemory() {
      const r = await one(sb.from('jarvis_memory').select('id,kind,strength,text,serves,track,target,category,course,qid,date,overrides,created_at').eq('user_id', uid).eq('active', true).order('created_at'));
      const from = addDays(today(), -1); return (r || []).filter(m => m.kind !== 'day' || m.date >= from);
    },
    async addMemory(row) { await one(sb.from('jarvis_memory').insert({ user_id: uid, ...row })); },
    async updateMemory(id, patch) { await one(sb.from('jarvis_memory').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('id', id)); },
    async deleteMemory(id) { await one(sb.from('jarvis_memory').delete().eq('user_id', uid).eq('id', id)); },
    async getSettings() { const r = await one(sb.from('day_settings').select('places,prefs').eq('user_id', uid).maybeSingle()); return { places: {}, prefs: {}, ...(r || {}) }; },
    async saveSettings(patch) {
      const cur = await one(sb.from('day_settings').select('places,prefs,travel').eq('user_id', uid).maybeSingle()) || { places: {}, prefs: {}, travel: {} };
      await one(sb.from('day_settings').upsert({ user_id: uid, ...cur, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
    },
    async setRestDay(date, rest) {
      const s = await api.getSettings(), set = new Set((s.prefs && s.prefs.restDays) || []);
      rest ? set.add(date) : set.delete(date);
      await api.saveSettings({ prefs: { ...(s.prefs || {}), restDays: [...set].filter(d => d >= addDays(today(), -60)).sort() } });
      await api.dropPlans([...Array(7)].map((_, i) => addDays(date, i)).filter(d => d !== today()));   // the rotation shifts from that day; today is re-planned by the app
    },
    async listMessages(n) { const r = await one(sb.from('jarvis_messages').select('role,kind,title,body,data,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(n)); return (r || []).reverse(); },
    async latestReviews() {
      const r = await one(sb.from('jarvis_reviews').select('app,review,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(30));
      const out = { ppl: null, nutrition: null, uni: null }; for (const x of r || []) if (!out[x.app]) out[x.app] = x.review; return out;
    },
    async pushStatus() {
      const s = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, subscribed: false, perm: 'default' };
      if (!s.supported) return s;
      s.perm = Notification.permission;
      try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); s.subscribed = !!sub; } catch { }
      return s;
    },
    async pushOn() {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications weren’t allowed.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.vapidPublicKey) });
      const j = sub.toJSON();
      await one(sb.from('jarvis_push_subs').upsert({ endpoint: j.endpoint, user_id: uid, p256dh: j.keys.p256dh, auth: j.keys.auth, device: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' }));
    },
    async pushOff() {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) { await one(sb.from('jarvis_push_subs').delete().eq('endpoint', sub.endpoint)); await sub.unsubscribe(); }
    }
  };
  return api;
}
export { supabaseBackend };
