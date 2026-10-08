# Jarvis

Salah's day, hour by hour, built from **his rules** and his three apps (Uni Planner, PPL Coach, Nutrition Coach — read only, never changed).
The plan itself is plain code (`src/scheduler.js`). Claude is used for three things only:

1. **Changes you tell it** — “no gym today”, “I'm at my grandmother's 4–7”, “from now on 45 min for quizzes”. One-day things apply to that day; “from now on” things change a rule.
2. **Double-checking each day is doable** — shown on Today as “Heads up” with a fix you can tap.
3. **Traffic** — live drive times are checked before every drive. A small delay moves the leave time; if that breaks something, Claude decides what to tell you.

## The rules (8 Oct 2026)
- **Classes** are fixed. Leave from wherever you are to be at uni **10 min before** class (time to park).
- **Quiz / assignment / pre-lab / homework**: 30 min on the day it opens (Uni Planner's “… opens” entry; none → 48 h before the deadline). Unchecked ones move to the next day, up to the deadline.
- **Graded lab**: 30 min revision the day before. **GCA**: 2 h study 2 days before.
- **Exams**: 3 h a day (total) from 14 days before exam week, 4 h a day from 7 days before, through exam week (exam weeks come from Uni Planner's academic entries).
- **Gym** every day unless you say no. Workout and its length from PPL Coach (+15 min shower when going gym → uni). Branch = shortest trip from where you are to where you go next, **Rigae wins ties**. **Never Sabah Al-Salem 5–9am or 11am–3pm.** Crowds: 10pm–4am quiet (best) · 4am–4pm fine · 9–10pm getting busy · 4–9pm packed. The gym time keeps 8 h of sleep when it can.
- **Uni → gym**: bring headphones. **Gym → uni**: bring a gym bag, shower at the gym.
- **Groceries** every Saturday (co-op near home).
- **Meals** from Nutrition Coach. The maid cooks 7am–9pm (Jarvis writes her message: dish, method, exact raw amounts, ready-by time); before that you cook breakfast yourself. Meals away from home go in the car cooler; cooked food gets 10 extra min for the microwave (gyms, gas station near uni).
- **Walking pad**: 1.5 h a day at home, during desk things (eating, studying) first, then free time.
- **Sleep**: no set time — 8 h preferred, never under 6 h. When time is short: uni → gym → food → sleep.
- **Everything except classes has a checkmark.** Checks tell Jarvis where you are; opening the app sends your live location, and Jarvis re-plans the rest of the day from there.

All the numbers are in Settings → Your rules, and change when you tell Jarvis.

## Files
| Path | What |
|---|---|
| `src/scheduler.js` | The rules. Same file runs in the app and the backend (`scripts/sync-function.sh` copies it). |
| `src/app.js`, `styles/app.css`, `index.html` | The app: Today · Week · Tell · Settings |
| `src/backend-supabase.js` | Supabase connection (same project and sign-in as the other apps) |
| `supabase/functions/jarvis/` | Edge Function: planning, Claude, Google traffic, notifications (pg_cron calls it every minute) |
| `test/run-real.mjs` | Print a week of plans from a saved copy of real data |
| `test/backend.test.ts` | The backend's planning path end to end, on a stand-in database |

## Deploying
1. `scripts/sync-function.sh`, commit, push (GitHub Pages serves the app).
2. Redeploy the `jarvis` function (JWT verification off — it checks sign-in itself) as the one-line `index.ts` that imports `supabase/functions/jarvis/index.ts` from this repo at the new commit id.
3. Secrets: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, optional `AI_MODEL`.
