// The live backend: Supabase (same project and sign-in as his other three apps) + the `jarvis` Edge Function.
// The app reads Jarvis's own tables directly; planning, changes and places go through the function.
import { addDays, localOf } from './scheduler.js';

function supabaseBackend(cfg) {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jv-auth' } });
  let uid = null;
  const one = async q => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
  const b64ToU8 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const api = {
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
    async plans(from, n) {
      const r = await one(sb.from('day_plans').select('date,plan').eq('user_id', uid).gte('date', from).lte('date', addDays(from, n - 1)).order('date'));
      return (r || []).filter(p => p.plan && p.plan.version === 2);
    },
    async changes() {
      const from = addDays(localOf(new Date().toISOString()).date, -1);
      const r = await one(sb.from('jarvis_memory').select('id,kind,text,date,category,created_at').eq('user_id', uid).eq('active', true).order('created_at'));
      return (r || []).filter(m => (m.kind === 'day' && m.date >= from) || (m.kind === 'rule' && m.category === 'standing'));
    },
    async settings() { const r = await one(sb.from('day_settings').select('places,prefs').eq('user_id', uid).maybeSingle()); return { places: {}, prefs: {}, ...(r || {}) }; },
    async messages(n = 20) { const r = await one(sb.from('jarvis_messages').select('role,body,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(n)); return (r || []).reverse(); },
    async pushStatus() {
      const s = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, subscribed: false, perm: 'default' };
      if (!s.supported) return s;
      s.perm = Notification.permission;
      try {
        const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); s.subscribed = !!sub;
        if (sub && uid && s.perm === 'granted') { const j = sub.toJSON(); await sb.from('jarvis_push_subs').upsert({ endpoint: j.endpoint, user_id: uid, p256dh: j.keys.p256dh, auth: j.keys.auth, device: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' }); }
      } catch { }
      return s;
    },
    async pushOn() {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications weren’t allowed.');
      if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('sw.js');
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('Close Jarvis fully, reopen it from your home screen and try again.')), 12000))]);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.vapidPublicKey) });
      const j = sub.toJSON();
      await one(sb.from('jarvis_push_subs').upsert({ endpoint: j.endpoint, user_id: uid, p256dh: j.keys.p256dh, auth: j.keys.auth, device: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' }));
    }
  };
  return api;
}
export { supabaseBackend };
