// Supabase connection — the same project as Uni Planner, PPL Coach and Nutrition Coach, so one sign-in covers all four.
// The publishable key and the notification public key are safe to publish: row-level security limits
// every signed-in user to their own rows. Never put the service_role / secret key, the Claude or Google API keys,
// or the VAPID private key here — those live only in Supabase → Edge Functions → Secrets.
window.JV_CONFIG = {
  supabaseUrl: 'https://mwlzmpyiendhvebkatfi.supabase.co',
  supabaseAnonKey: 'sb_publishable_6-Z4ivZdsmcOgtw3LyhXeg_IpiIpggI',
  vapidPublicKey: 'BNL5EkpVlGrqNGYVT0UCb-Hl5ds_pwzeBxMPiqe5-TJIVvsC59CIMWZT8-VRBgr_PoGUSnU7F93f0ig_pbxKUo0'
};
