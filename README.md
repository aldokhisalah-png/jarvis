# Jarvis

Salah's chief of staff. Jarvis reads **PPL Coach**, **Nutrition Coach** and **Uni Planner** — never writes to them — and thinks with Claude:

Tabs: **Today · Physique · Uni · Ask · Ahead · Personal**.
- **Physique** — your body goal and how it's going, your gym and macros habits, and Jarvis's analysis of PPL Coach and Nutrition Coach.
- **Uni** — your grades goal, where each course stands (record marks here), and the Uni Planner analysis.
- **Personal** — everything Jarvis knows about how you live: big goals and their habits, then rules by category (study, university and what to bring per class, gym, food, sleep, travel, home). Jarvis reads it every time it plans. When you say something worth keeping in Ask, it offers "Add to Personal?" — nothing lasting is saved until you tap Add. Edit or forget anything here.
- **Questionnaire** (top of Personal) — about 40 questions plus two for each of your classes: sleep, study, what you bring to each class, gym, food and who cooks, travel, what to protect first, fixed commitments, your goals. Every answer becomes a Personal rule or a setting; re-answer any time.
- **Your places** — home (everything's there), your grandmother's home (closer to uni, none of your things — good for breaks between classes), uni, and the Oxygen Gym branches your membership covers (Rigae, Mahboula, Sabah Al-Salem). Jarvis picks the branch per session by drive time and how busy it is; tap Quiet / OK / Packed after training and it learns each branch's busy hours.
- **Grocery day** — once a week Jarvis plans the shop with the full list for the coming 7 days (the same list as Nutrition Coach's Grocery tab, with raw amounts to buy for foods counted cooked). It's the day you pick in the questionnaire, or until then the first day of the week without classes.
- **Never late** — every drive to class must include your minutes-early buffer plus what that route has really run over in the past (learned from live checks), and the checker enforces it. Class drives are watched from 90 minutes out. Traffic shifts never eat into university work; when time runs out, Jarvis protects university → gym → nutrition → sleep (your order).
- **Live traffic** — checked about 60, 35, 20 and 10 minutes before every drive (from your phone's location when it's recent). A small delay moves your leave time, taken from free time or a few minutes of a flexible block. A big one, or one that would make you late for something fixed, has Claude re-plan the rest of the day. Either way you get a notification saying exactly what changed, and an Undo in Today.
- **Today** — the whole day planned by Claude, hour by hour: when to wake up, eat, cook, leave, train, study and sleep, each with the reason. Classes never move, drives take as long as traffic says, and anything you told Jarvis for that day is kept exactly.
- **Ahead** — the next 7 days; Jarvis plans each day the evening before and tells you when to get up.
- **Apps** — Jarvis's analysis of each app: how it's going, mistakes, what's missing, better ways, and changes for you to make in the app.
- **Ask** — talk to Jarvis. It answers from your real data, remembers what you tell it (rules, goals, one-day changes), re-plans when your day changes, and writes a weekly report.

**It works from your goals down.** Jarvis remembers three levels, and you can see and change all of them under You → What I remember:
- **Big goals:** get to 80 kg at 12% body fat as fast as possible, and get the highest grade possible this semester. Everything else exists to reach these.
- **Habits** that serve them: gym every day, progressive overload, the right macros for each phase, classes on time, assignments on time, studying on time.
- **Rules**, which are your approximations and preferences: how long things take, when you like to do them, who cooks.

Apps → Your goals shows how each big goal is going, using numbers from your apps:
- Your body numbers against the target.
- Whether Nutrition Coach is aimed at your goal (its final cut and your goal are both 12%).
- Where each course stands, from the marks you tell Jarvis.
- How each habit has gone lately.

Plans and trade-offs protect what matters most for the big goals and say which goal each block serves. App analyses and the weekly report judge each app by what it does for the goals.

**It adapts and solves problems:**
- **Every plan looks ahead.** It lists what to take with you, like a gym bag, towel and clean shirt with time to shower when you go from the gym to class, or an ice pack for a packed lunch. Notifications remind you before you leave. It also shows the trade-offs it made (say, the gym doesn't fit at 6pm), each with alternatives you can switch to in one tap and what each one costs.
- **Problem? on any block:** no time, missing ingredients, can't make the gym, running late. Jarvis gives 2–4 options with what each costs you (sleep, macros, a rule, your PPL rotation). You pick one and the rest of the day is re-planned around it. Saying it in Ask works the same way.
- **Your maid:** she cooks in the background while you're elsewhere. Jarvis writes the exact text to send her (what, how much, ready by when) with a Copy button, and includes it in the evening notification. You keep the cooking you like to do yourself, like breakfast.
- **The kitchen:** every meal has to be cooked before you eat it, whether that day, earlier, or batch-cooked up to 3 days ahead. It works around anything you're out of, adds a supermarket stop to a drive, and counts the food as back once you mark that drive done. It reads Nutrition Coach's grocery ticks.
- **Honest numbers:** when a meal changes, Jarvis calculates the macros from Nutrition Coach's own food values (bought food is marked as an estimate) and tells you exactly how to log it.
- **It learns from what happens:** your real cook times (tap Start and Done), what you skip, and what runs over. Later plans change to match.

There are no built-in rules about when you study, eat, train or sleep. Those come from you (**You → What I remember**). The code only checks what's physically true: you can't be in two places at once, classes don't move, drives take time.

## How it's built
| Path | What |
|---|---|
| `src/engine.js` | Facts and physics: each app's own rules (copied from their code), drive times, the plan checker, per-app stats |
| `src/brain.js` | What Jarvis knows about each app and what it's asked to do (prompts and answer shapes) |
| `src/core.js` | Plan, talk, remember, analyse, report — the same code runs in the backend and the preview |
| `src/app.js`, `styles/app.css`, `index.html` | The app (plain JS, no build step), dark like the other three |
| `src/backend-supabase.js` | The live connection: same Supabase project and sign-in as the other apps |
| `supabase/functions/jarvis/` | The `jarvis` Edge Function: Claude, traffic, notifications. Run `scripts/sync-function.sh` before deploying |
| `supabase/migrations/20261005_jarvis.sql` | Jarvis's own tables: memory (goals, habits, rules, day changes), marks, messages, app reviews |
| `src/his-memory.js`, `supabase/seed-memory.sql` | What you've already told Claude, as Jarvis's starting memory: big goals → habits → rules |
| `src/backend-preview.js`, `scripts/build-preview.mjs` | The preview: the real app on sample data, thinking with Claude in the page |

## Setting it up
1. Run `supabase/migrations/20261005_jarvis.sql`, then `supabase/seed-memory.sql`.
2. Supabase → Edge Functions → Secrets: `ANTHROPIC_API_KEY` (required), `GOOGLE_MAPS_API_KEY` (live traffic; optional), `AI_MODEL` (optional, default `claude-sonnet-5-5`).
3. `scripts/sync-function.sh`, then deploy the `jarvis` function with JWT verification off (it checks sign-in itself; the existing `jarvis-push` cron job calls it every minute).
4. Push this folder to `aldokhisalah-png/jarvis` and turn on GitHub Pages.
5. In the app: set home, uni and gym under You → Places, and turn on notifications.

## Notifications
Tomorrow's plan in the evening (about 90 minutes before lights out) with when to get up · a brief when you wake · when to leave, re-checked against live traffic · gym, study, cooking and wind-down · the weekly report on Saturday at 9pm. App analyses refresh every night at 2am.

## Tests
```
node test/core.test.mjs
deno run -A --import-map=test/import_map.json test/function.test.ts
node scripts/build-preview.mjs <esbuild> --stub test/claude-stub.js   # then click through dist/preview-test.html
```
