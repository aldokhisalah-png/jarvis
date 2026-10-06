// Live app: Supabase + the jarvis function.
import { start } from './app.js';
import { supabaseBackend } from './backend-supabase.js';
start(supabaseBackend(window.JV_CONFIG));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
