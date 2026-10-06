// Run: node test/core.test.mjs — Jarvis's core with sample data, a fixed clock and a scripted "Claude".
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { createJarvis } from '../src/core.js';
import { createLocalDb } from '../src/local-db.js';
import { SAMPLE } from '../src/sample-data.js';

const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); };
let NOW = 300;
const clock = { today: () => '2026-10-05', nowMin: () => NOW };
const places = { async drive({ settings, coords }) { return { drive: E.makeDrive({ freeFlow: settings.travel, parking: (settings.prefs || {}).parking ?? 10 }), startLoc: coords ? coords.at : null }; } };
const calls = [];
let script = () => { throw new Error('no script'); };
const ai = { async json(req) { calls.push(req); return script(req, calls.length); } };
const db = createLocalDb(JSON.parse(JSON.stringify(SAMPLE)));
const J = createJarvis({ db, ai, places, clock });

// A sensible Monday, written the way Claude would (drives: home–uni 18 min empty road + 10 parking).
const B = (start, end, type, title, extra = {}) => ({ start, end, type, title, ...extra });
const MONDAY = { summary: 'Lab at 8:30, two lectures, Legs at 6pm, lights out 9pm.', notes: [], blocks: [
  B('05:00', '05:00', 'wake', 'Wake up', { loc: 'home' }),
  B('05:05', '05:20', 'cook', 'Make breakfast', { loc: 'home', reason: 'r' }), B('05:20', '05:40', 'meal', 'Breakfast', { loc: 'home', reason: 'r' }),
  B('05:40', '07:00', 'study', 'Prepare CE 337 Graded Lab 1', { loc: 'home', ref: 'lab337-1', reason: 'r' }),
  B('07:50', '08:20', 'travel', 'Drive to uni', { from: 'home', to: 'uni', reason: 'r' }),
  B('08:30', '11:00', 'class', 'CE 337 Lab', { loc: 'uni' }),
  B('11:00', '11:30', 'travel', 'Drive home', { from: 'uni', to: 'home', reason: 'r' }),
  B('11:30', '12:00', 'cook', 'Cook lunch', { loc: 'home', reason: 'r' }), B('12:00', '12:20', 'meal', 'Lunch', { loc: 'home', reason: 'r' }),
  B('12:25', '12:55', 'travel', 'Drive to uni', { from: 'home', to: 'uni', reason: 'r' }),
  B('13:00', '14:15', 'class', 'BIOL 110 Lecture', { loc: 'uni' }),
  B('14:15', '15:30', 'study', 'BIOL 110 lab safety quiz', { loc: 'uni', ref: 'quiz-bio', reason: 'r' }),
  B('16:00', '16:10', 'meal', 'Pre-workout', { loc: 'uni', reason: 'r' }),
  B('16:30', '17:45', 'class', 'CE 468 Lecture', { loc: 'uni' }),
  B('17:45', '18:00', 'travel', 'Drive to Oxygen Rigae', { from: 'uni', to: 'gym_rigae', reason: 'r' }),
  B('18:00', '19:30', 'gym', 'Legs', { loc: 'gym_rigae', reason: 'r' }),
  B('19:30', '19:40', 'travel', 'Drive home', { from: 'gym', to: 'home', reason: 'r' }),
  B('19:40', '20:05', 'cook', 'Cook dinner', { loc: 'home', reason: 'r' }), B('20:05', '20:25', 'meal', 'Dinner', { loc: 'home', reason: 'r' }),
  B('20:30', '20:40', 'meal', 'Evening shake', { loc: 'home', reason: 'r' }),
  B('21:00', '21:00', 'sleep', 'Lights out', { loc: 'home' })
] };
// The rest of Monday from 11:40 at home, with the gym at 10pm and a late night.
const LATE = { summary: 'Gym at 10pm, lights out 12:30am.', notes: ['Short night before Tuesday.'], blocks: [
  B('11:40', '12:00', 'cook', 'Cook lunch', { loc: 'home', reason: 'r' }), B('12:00', '12:20', 'meal', 'Lunch', { loc: 'home', reason: 'r' }),
  B('12:25', '12:55', 'travel', 'Drive to uni', { from: 'home', to: 'uni', reason: 'r' }),
  B('13:00', '14:15', 'class', 'BIOL 110 Lecture', { loc: 'uni' }),
  B('14:15', '15:45', 'study', 'BIOL 110 lab safety quiz', { loc: 'uni', ref: 'quiz-bio', reason: 'r' }),
  B('16:30', '17:45', 'class', 'CE 468 Lecture', { loc: 'uni' }),
  B('17:45', '18:15', 'travel', 'Drive home', { from: 'uni', to: 'home', reason: 'r' }),
  B('18:15', '19:00', 'cook', 'Cook dinner', { loc: 'home', reason: 'r' }), B('19:00', '19:20', 'meal', 'Dinner', { loc: 'home', reason: 'r' }),
  B('20:30', '20:40', 'meal', 'Pre-workout', { loc: 'home', reason: 'r' }),
  B('21:45', '22:00', 'travel', 'Drive to Oxygen Rigae', { from: 'home', to: 'gym_rigae', reason: 'r' }),
  B('22:00', '23:30', 'gym', 'Legs', { loc: 'gym_rigae', reason: 'r' }),
  B('23:30', '23:45', 'travel', 'Drive home', { from: 'gym', to: 'home', reason: 'r' }),
  B('23:45', '23:55', 'meal', 'Evening shake', { loc: 'home', reason: 'r' }),
  B('00:30', '00:30', 'sleep', 'Lights out', { loc: 'home' })
] };

console.log('1 · planning a whole day');
script = () => MONDAY;
let r = await J.plan({ date: '2026-10-05' });
ok(r.plan.blocks.length === MONDAY.blocks.length && r.plan.attempts === 1, 'a valid plan is accepted first time and saved');
const F1 = JSON.parse(/FACTS\n(.*)/.exec(calls[0].turns[0].content)[1]), W1 = F1.whatHeIsWorkingToward;
ok(calls[0].system.includes('You plan ONE day') && /big goals are the point of everything/i.test(calls[0].system), 'Claude is told the big goals are the point of everything');
ok(W1.bigGoals[0].goal.startsWith('Get to 80 kg at 12% body fat') && W1.bigGoals[0].habits.some(h => /gym every day/.test(h.habit) && h.lately.last7Days) && W1.bigGoals[0].rules.some(r => /6pm/.test(r.rule)), 'each big goal comes with its habits (and how they went) and its rules');
ok(W1.bigGoals[1].habits.length === 3 && W1.generalRules.some(r => /9pm to 5am/.test(r.rule)), 'grades goal: classes, assignments, studying on time; sleep is a general rule');
ok(!W1.bigGoals[0].progress.appVsGoal, 'his 12% goal matches Nutrition Coach\'s final cut, so no mismatch is reported');
ok(/its final cut stops at 12% body fat, but his goal is 10%/.test(E.bodyProgress({ weightKg: 80, bodyFatPct: 10 }, { weighIns: { trend7: null, last: [] }, bodyFat: { trend7: null, last: [], total: 1 } }).appVsGoal || ''), 'a goal below Nutrition Coach\'s final cut is still flagged');
ok(/PPL Coach shows Legs next/.test(calls[0].turns[0].content) && /Salmon day/.test(calls[0].turns[0].content), 'facts come from his apps (PPL rotation, Nutrition Coach day)');

console.log('2 · an impossible plan goes back to Claude with the reasons');
calls.length = 0;
script = (req, n) => {
  if (n === 1) { const p = JSON.parse(JSON.stringify(MONDAY)); p.blocks[4].end = '08:00'; p.blocks.splice(5, 1); return p; }   // 10-min drive + class dropped
  return MONDAY;
};
r = await J.plan({ date: '2026-10-05' });
ok(calls.length === 2 && r.plan.attempts === 2, 'second attempt accepted');
const fix = calls[1].turns.at(-1).content;
ok(/CE 337 Lab 08:30–11:00 is missing/.test(fix) && /takes 28 min/.test(fix), 'the fix request names the moved class and the too-short drive');

console.log('3 · "gym at 10pm tonight" — remembered for today, day rebuilt');
calls.length = 0; NOW = 700;
script = (req) => req.task === 'ask'
  ? { reply: "Done — gym at 10pm tonight, just for today. Lights out moves to 12:30am.", remember: [{ kind: 'day', date: '2026-10-05', text: "Not sleeping at 9pm today — gym at 10pm", mustKeep: { gymAt: '22:00', junk: 1 } }], replan: '2026-10-05' }
  : LATE;
r = await J.ask({ date: '2026-10-05', message: "I don't want to sleep at 9pm today, I'm going to the gym at 10pm", nowMin: 700, coords: { at: 'home' } });
ok(r.memory[0].op === 'saved' && r.memory[0].kind === 'day' && JSON.stringify(r.memory[0].overrides) === '{"gymAt":"22:00"}', 'saved as a one-day change, junk dropped');
ok(r.replanned === '2026-10-05' && r.plan.blocks.find(b => b.type === 'gym').start === '22:00', 'today re-planned with the gym at 10pm');
ok(r.plan.blocks[0].type === 'wake' && r.plan.blocks.some(b => b.start === '08:30'), 'the morning that already happened is kept');
ok(/HIS LATEST REQUEST: I don't want to sleep/.test(calls[1].turns[0].content) && /"mustKeep":\{"gymAt":"22:00"\}/.test(calls[1].turns[0].content), 'the planner sees his request and the must-keep time');

console.log('4 · a plan that ignores his 10pm is rejected');
calls.length = 0;
script = (req, n) => n === 1 ? { ...LATE, blocks: LATE.blocks.map(b => b.type === 'gym' ? { ...b, start: '20:00', end: '21:30' } : b) } : LATE;
r = await J.plan({ date: '2026-10-05', nowMin: 700, coords: { at: 'home' } });
ok(calls.length >= 2 && /He said gym at 22:00 today/.test(calls[1].turns.at(-1).content), 'the checker holds Claude to it');

console.log('5 · something lasting — Jarvis asks before adding it to Personal');
calls.length = 0;
script = () => ({ reply: 'Want me to add that to Personal?', remember: [{ kind: 'rule', strength: 'must', category: 'study', text: 'Never schedule study after 8pm.' }, { kind: 'rule', category: 'university', course: 'BIOL 110', text: 'Bring my lab coat and goggles to BIOL 110 labs.', replaces: '9a1f0c2e-0201-4b6a-9c11-5a1a00000201' }], replan: null });
db.state.plans.push({ date: '2026-10-07', plan: MONDAY });
r = await J.ask({ date: '2026-10-05', message: 'never schedule study after 8pm' });
ok(r.proposals.length === 2 && r.proposals[0].row.strength === 'must' && r.proposals[0].row.category === 'study' && !db.state.memory.some(m => m.text === 'Never schedule study after 8pm.'), 'proposed with a category, not saved until he taps Add');
ok(r.proposals[1].row.course === 'BIOL 110' && r.proposals[1].replaces === '9a1f0c2e-0201-4b6a-9c11-5a1a00000201' && db.state.messages.at(-1).data.proposals.length === 2, 'per-class things carry the course; an update says what it replaces; the offer stays in the conversation');
ok(db.state.plans.some(p => p.date === '2026-10-07'), 'nothing changes until he says yes');
await db.insertMemory(r.proposals[0].row);                                             // he taps Add
ok(db.state.memory.some(m => m.text === 'Never schedule study after 8pm.' && m.strength === 'must' && m.category === 'study'), 'tapping Add saves it to Personal');
const mem = /MEMORY\n(\{.*\})/.exec(calls[0].turns[0].content);
const tree = mem && JSON.parse(mem[1]);
ok(tree && tree.bigGoals.length === 2 && tree.bigGoals[1].rules.some(r => r.id === '9a1f0c2e-0206-4b6a-9c11-5a1a00000206' && /day before every GCA/.test(r.rule)), 'Claude sees his memory as goals → habits → rules, with ids');
script = () => ({ reply: 'Forgotten.', forget: ['9a1f0c2e-0202-4b6a-9c11-5a1a00000202'] });
r = await J.ask({ date: '2026-10-05', message: 'forget the 6pm gym thing' });
ok(r.memory[0].op === 'forgot' && !db.state.memory.some(m => m.id === '9a1f0c2e-0202-4b6a-9c11-5a1a00000202'), 'rule removed');

console.log('6 · rest day');
script = () => ({ reply: 'Tomorrow is a rest day.', restDay: { date: '2026-10-06', rest: true } });
r = await J.ask({ date: '2026-10-05', message: 'make tomorrow a rest day' });
const wk = await J.ahead();
ok(wk[1].chosenRest && wk[2].gym === 'Push' && wk.filter(d => d.gym === 'Rest (your choice)').length === 1, 'tomorrow is his rest day; the rotation pauses, then he trains through PPL Coach\'s Rest step with Push');
ok(wk.every(d => d.chosenRest || /^(Push|Pull|Legs)/.test(d.gym)), 'every other day of the week is a training day — Jarvis never plans a rest day itself');


console.log('7 · app analysis');
calls.length = 0;
script = req => ({ status: 'watch', headline: 'Lat pulldown set 2 was heavier than Set 1.', going: ['5 sessions'], mistakes: [{ title: 'Set 2 heavier', detail: '45×5 after 40×10' }], changes: [{ what: 'Lat pulldown Set 1', from: '40 kg', to: '45 kg', why: '10 reps = top of range' }] });
const all = await J.reviewAll();
ok(all.ppl.status === 'watch' && all.nutrition.headline && all.uni.headline, 'three reviews written and saved');
const pplPrompt = calls.find(c => /Analyse ONE of his apps — PPL Coach/.test(c.system)).turns[0].content;
ok(/backoffNotAsAppSays/.test(pplPrompt) && /"set":2,"did":"45×5"/.test(pplPrompt), 'Claude gets the back-off sets that broke the app\'s rule');
ok(/below the rep minimum/.test(pplPrompt), 'and the Set 1s stuck below the range');
const nutPrompt = calls.find(c => /Nutrition Coach —/.test(c.system)).turns[0].content;
ok(/"bodyFat":\{"total":0/.test(nutPrompt) && /Chicken shawarma wrap/.test(nutPrompt), 'Nutrition data: no body-fat readings, the off-plan meal');
const uniPrompt = calls.find(c => /— Uni Planner/.test(c.system)).turns[0].content;
ok(/Check the exact day on Moodle/.test(uniPrompt) && /Midterm exams week/.test(uniPrompt), 'Uni data: the unconfirmed quiz date and midterm placeholder');

console.log('8 · weekly report');
script = () => ({ headline: 'Thin week of data.', sections: [{ area: 'ppl', title: 'PPL Coach', points: ['x'] }], changes: [{ app: 'Uni Planner', what: 'Confirm quiz date', why: 'y' }] });
const rep = await J.report();
ok(rep.changes.length === 1 && db.state.messages.at(-1).kind === 'report', 'saved and posted in the chat');

console.log('9 · it adapts to what actually happened');
const PAST = { summary: 'Sunday.', blocks: [
  B('05:00', '05:00', 'wake', 'Wake up'), B('05:40', '07:00', 'study', 'Prepare CE 337 Graded Lab 1', { skipped: true }),
  B('18:00', '18:25', 'cook', 'Cook dinner', { makes: [{ meal: 'dinner' }], startedAt: '2026-10-04T15:02:00.000Z', doneAt: '2026-10-04T15:37:00.000Z', done: true }),
  B('19:30', '20:10', 'cook', 'Batch-cook lunches', { makes: [{ meal: 'lunch', date: '2026-10-06' }, { meal: 'lunch', date: '2026-10-07' }], took: 50, done: true }),
  B('21:00', '21:00', 'sleep', 'Lights out')] };
db.state.plans.push({ date: '2026-10-04', plan: PAST });
let d0 = await J.load(), tue = E.dayFacts(await J.dayFor(d0, '2026-10-06'));
ok(tue.kitchen.hisCookTimes.some(c => c.cooking === 'Dinner (salmon)' && c.typical === 35) && tue.kitchen.hisCookTimes.some(c => c.cooking === 'Lunch ×2' && c.typical === 50), 'his real cook times, learned from his Start/Done taps (35 min for a salmon dinner, 50 for two lunches)');
ok(tue.kitchen.alreadyCooked.some(a => a.meal === 'Lunch' && /cooked/.test(a.status)), 'Tuesday knows lunch was batch-cooked on Sunday');
ok(tue.howHisRecentDaysWent.skipped.some(x => /05:40 study/.test(x)) && tue.howHisRecentDaysWent.tookLongerOrShorter.some(x => /planned 25 min, took 35/.test(x)), 'it sees what he skipped and what ran over');
ok(tue.nextDays.length === 3 && tue.nextDays[0].weekday === 'Wednesday' && tue.food.meals.find(m => m.key === 'breakfast').needsCooking === 'Eggs', 'it looks at the next days, and knows what needs cooking');
const BR = await import('../src/brain.js');
ok(/gym bag with a towel, shower things and a clean change of clothes/.test(BR.PLAN_SYSTEM) && BR.SCHEMA.plan.properties.bring && BR.SCHEMA.plan.properties.choices, 'every plan is asked for a bring list and its trade-offs');

console.log('10 · the checker: cook before eating, nothing over 3 days ahead, nothing he is out of');
const monDay = { ...(await J.dayFor(d0, '2026-10-05')), overrides: {} };
const noCook = { ...MONDAY, blocks: MONDAY.blocks.filter(b => b.title !== 'Cook dinner') };
{ const generic = { ...MONDAY, blocks: MONDAY.blocks.map(b => b.type === 'travel' && b.to === 'gym_rigae' ? { ...b, to: 'gym' } : b.type === 'gym' ? { ...b, loc: 'gym' } : b) };
  ok(E.validatePlan(monDay, generic).errors.some(e => /pick the branch yourself/.test(e)), 'a plan that just says "the gym" is rejected — Jarvis has to name the branch'); }
{ const noGym = { ...MONDAY, blocks: MONDAY.blocks.filter(b => b.type !== 'gym') };
  ok(E.validatePlan(monDay, noGym).errors.some(e => /no gym session\. He trains every day/.test(e)), 'a day with no gym is rejected — he trains every day');
  ok(!E.validatePlan(monDay, { ...noGym, rulesNotMet: ['Gym: a 6-hour exam block and a 9pm bedtime leave no room — options below.'] }).errors.some(e => /no gym session/.test(e)), '…unless Jarvis says why the gym truly can\'t fit');
  ok(!E.validatePlan({ ...monDay, gym: { workout: 'rest', chosenRest: true } }, noGym).errors.some(e => /no gym session/.test(e)), '…and a rest day he picked needs no gym'); }
ok(E.validatePlan(monDay, noCook).errors.some(e => /Dinner at 20:05 needs cooking \(Salmon, Sweet potato\)/.test(e)), 'dinner with nothing cooking it is rejected');
const tooFar = { ...MONDAY, blocks: MONDAY.blocks.map(b => b.title === 'Cook dinner' ? { ...b, makes: [{ meal: 'dinner' }, { meal: 'lunch', date: '2026-10-10' }] } : b) };
ok(E.validatePlan(monDay, tooFar).errors.some(e => /at most 3 days ahead/.test(e)), 'cooking 5 days ahead is rejected');
const out = { ...monDay, kitchen: { ...monDay.kitchen, pantry: { ...monDay.kitchen.pantry, outOf: [{ food: 'eggs', name: 'Eggs', status: 'out', since: 'Mon 5 Oct' }] } } };
ok(E.validatePlan(out, MONDAY).errors.some(e => /Breakfast at 05:20 uses Eggs, which he's out of/.test(e)), 'breakfast with eggs he doesn\'t have is rejected');
const swapped = { ...MONDAY, blocks: MONDAY.blocks.map(b => b.title === 'Breakfast' ? { ...b, instead: { foods: [{ food: 'greek_yogurt', grams: 300 }, { food: 'whey', grams: 25 }, { food: 'banana', grams: 120 }, { food: 'blueberries', grams: 100 }] } } : b) };
ok(!E.validatePlan(out, swapped).errors.some(e => /Eggs/.test(e)), '…but a changed breakfast without eggs passes');

console.log('11 · "I\'m out of eggs" — Jarvis keeps track of the kitchen');
db.state.plans.push({ date: '2026-10-07', plan: MONDAY });
script = () => ({ reply: 'Noted — no eggs until you buy more. I’ll plan a stop.', pantry: [{ food: 'eggs', status: 'out' }] });
r = await J.ask({ date: '2026-10-05', message: "I'm out of eggs" });
ok(db.state.settings.prefs.pantry.some(p => p.food === 'eggs' && p.status === 'out') && r.memory.some(m => m.op === 'pantry' && /Eggs: out/.test(m.text)), 'saved as out of eggs');
ok(!db.state.plans.some(p => p.date === '2026-10-07'), 'the next days are re-planned with the new kitchen');
d0 = await J.load();
ok(E.dayFacts(await J.dayFor(d0, '2026-10-06')).food.meals.find(m => m.key === 'breakfast').heIsOutOf[0] === 'Eggs (out)', 'Tuesday\'s breakfast is flagged');
const shopDone = { date: '2026-10-05', plan: { ...MONDAY, blocks: MONDAY.blocks.map(b => b.start === '19:30' && b.type === 'travel' ? { ...b, shop: ['eggs'], done: true } : b) } };
ok(E.pantryFacts({ pantry: db.state.settings.prefs.pantry, plans: [shopDone], date: '2026-10-06', today: '2026-10-05' }).outOf.length === 0, 'a shop stop he marks done puts eggs back');

console.log('12 · no time for dinner — options with honest numbers, then his pick');
NOW = 1080; calls.length = 0;
const OPTIONS = { situation: 'Home at 7:40, lights out at 12:30 after the 10pm gym — 25 minutes of cooking is the squeeze.', pick: 1, why: 'Keeps protein and needs no cooking.', options: [
  { title: 'Same dinner, faster', kind: 'faster', how: 'Microwave the sweet potato 7 min while the salmon goes in the air fryer.', minutes: 15, meal: 'dinner', today: 'Dinner at 7:55.', costs: 'Nothing.' },
  { title: 'No-cook protein bowl', kind: 'swap', how: 'Greek yogurt, whey, banana, walnuts.', minutes: 5, meal: 'dinner', foods: [{ food: 'greek_yogurt', grams: 300 }, { food: 'whey', grams: 30 }, { food: 'banana', grams: 120 }, { food: 'walnuts', grams: 15 }], today: 'Dinner at 7:45.', costs: 'Less fat from fish.' },
  { title: 'Grilled chicken plate on the way home', kind: 'buy', how: 'Pick it up on the drive.', minutes: 10, meal: 'dinner', buy: { what: 'Grilled chicken breast, rice and salad', kcal: 620, protein: 48, carbs: 60, fat: 18 }, today: 'Drive home +10 min.', costs: 'About 3 KWD; macros are an estimate.' }] };
script = req => req.task === 'solve' ? OPTIONS : null;
let today = await db.getPlan('2026-10-05'); const di = today.blocks.findIndex(b => b.type === 'meal' && /Dinner/.test(b.title));
const sol = await J.solve({ date: '2026-10-05', i: di, problem: 'No time to cook dinner', nowMin: 1080, coords: { at: 'home' } });
const sp = calls[0].turns[0].content;
ok(calls[0].system.includes('Something got in the way') && /"mealAffected":\{"key":"dinner"/.test(sp) && /Microwave|microwave/.test(calls[0].system), 'Claude gets the problem, the meal and the kitchen know-how');
const bowl = sol.options[1].food, bowlTrue = E.macrosOf([{ food: 'greek_yogurt', grams: 300 }, { food: 'whey', grams: 30 }, { food: 'banana', grams: 120 }, { food: 'walnuts', grams: 15 }]);
ok(bowl.kcal === bowlTrue.kcal && bowl.protein === bowlTrue.protein && /as edited: Greek yogurt 300 g/.test(bowl.log) && /kcal, [+-]\d+ g protein vs the plan/.test(bowl.vsPlan), `the bowl's macros are computed, not guessed (${bowl.kcal} kcal, ${bowl.protein} g protein; ${bowl.vsPlan})`);
ok(sol.options[2].food.estimated && /as something else: Grilled chicken/.test(sol.options[2].food.log) && sol.options[0].food.sameFoodAsPlanned, 'bought food is flagged as an estimate; the faster option is the same food');
ok((await db.getPlan('2026-10-05')).problems.some(p => p.id === sol.id), 'the options are kept with the day');
const AFTER = { summary: 'Protein bowl instead of cooking; gym at 10pm.', bring: [{ what: 'Gym bag', why: 'Gym at 10pm.' }],
  choices: [{ problem: 'Sleep is short after a 10pm gym', picked: 'Lights out at 12:30', options: [{ title: 'Train at 7pm instead', costs: 'Breaks the 10pm you asked for' }] }],
  blocks: [B('18:05', '18:15', 'meal', 'Dinner', { meal: 'dinner', loc: 'home', reason: 'r' }), B('20:30', '20:40', 'meal', 'Pre-workout', { loc: 'home', reason: 'r' }),
    B('21:45', '22:00', 'travel', 'Drive to Oxygen Rigae', { from: 'home', to: 'gym_rigae', reason: 'r' }), B('22:00', '23:30', 'gym', 'Legs', { loc: 'gym_rigae', reason: 'r' }),
    B('23:30', '23:45', 'travel', 'Drive home', { from: 'gym', to: 'home', reason: 'r' }), B('23:45', '23:55', 'meal', 'Evening shake', { loc: 'home', reason: 'r' }), B('00:30', '00:30', 'sleep', 'Lights out', { loc: 'home' })] };
script = req => req.task === 'plan' ? AFTER : OPTIONS;
calls.length = 0;
r = await J.choose({ date: '2026-10-05', id: sol.id, option: 1, nowMin: 1080, coords: { at: 'home' } });
ok(/He chose: "No-cook protein bowl"/.test(calls[0].turns[0].content) && /heChoseInstead/.test(calls[0].turns[0].content), 'the day is re-planned around his pick');
const dinner = r.plan.blocks.find(b => b.meal === 'dinner');
ok(dinner && dinner.instead && dinner.instead.fromHisChoice && dinner.instead.kcal === bowlTrue.kcal && r.plan.attempts === 1, 'dinner carries the swap — no cook block needed, the checker accepts it');
ok(r.plan.swaps[0].meal === 'dinner' && r.plan.bring[0].what === 'Gym bag' && r.plan.choices[0].options[0].title === 'Train at 7pm instead', 'the swap, the bring list and the trade-off are saved');
ok(/Going with “No-cook protein bowl”\. Log Dinner in Nutrition Coach as edited/.test(db.state.messages.at(-1).body), 'and it tells him exactly what to log');

console.log('13 · telling Jarvis in Ask gets the same options');
calls.length = 0;
script = req => req.task === 'ask' ? { reply: 'Here are your options for dinner.', problem: 'Stuck at uni until 8pm — no time to cook dinner', problemAbout: '18:05' } : OPTIONS;
r = await J.ask({ date: '2026-10-05', message: "I'm stuck at uni till 8, no time to cook dinner", nowMin: 1080, coords: { at: 'home' } });
ok(r.solutions && r.solutions.options.length === 3 && r.solutions.block.start === '18:05' && !r.replanned, 'options come back with the reply; nothing is re-planned until he picks');
ok(db.state.messages.at(-1).data.solutions.id === r.solutions.id, 'and they stay in the conversation');

console.log('14 · the big goals: progress, habits, marks');
let g = await J.goals();
const body = g.bigGoals.find(x => x.progress && x.progress.nutritionCoachRoute), grades = g.bigGoals.find(x => x.progress && x.progress.courses);
ok(body.habits.find(h => /gym every day/.test(h.habit)).lately.last7Days && body.habits.find(h => /progressive overload/.test(h.habit)).lately.lastSet1, 'gym every day and progressive overload are measured from PPL Coach');
ok(/days? logged/.test(body.habits.find(h => /macros/.test(h.habit)).lately.lastDays), 'macros are measured from Nutrition Coach\'s food logs');
ok(grades.progress.marksRecorded === 0 && /no marks recorded/.test(grades.progress.courses[0].marked) && g.markable.length > 0, 'grades: no marks yet, and Jarvis lists what can be marked');
const ev = g.markable[0];
script = () => ({ reply: 'Nice — 13/15 recorded.', marks: [{ ref: ev.ref, score: 13, outOf: 15 }] });
r = await J.ask({ date: '2026-10-05', message: `I got 13/15 on ${ev.label}` });
g = await J.goals();
const course = g.bigGoals.find(x => x.progress && x.progress.courses).progress.courses.find(c => /earned/.test(c.marked));
ok(r.memory.some(m => m.op === 'mark') && course && /\(87%\)/.test(course.marked), `a mark he tells Jarvis shows where the course stands (${course && course.course}: ${course && course.marked})`);
script = () => ({ reply: 'Add it to Personal as a habit under your body goal?', remember: [{ kind: 'habit', strength: 'must', text: 'Weigh in every morning before breakfast.', serves: ['9a1f0c2e-0001-4b6a-9c11-5a1a00000001', 'not-a-goal'] }] });
r = await J.ask({ date: '2026-10-05', message: 'I want to weigh in every morning — it\'s for the cut' });
await db.insertMemory(r.proposals[0].row);
g = await J.goals();
ok(g.bigGoals[0].habits.some(h => /Weigh in every morning/.test(h.habit)) && db.state.memory.find(m => /Weigh in/.test(m.text)).serves.join() === '9a1f0c2e-0001-4b6a-9c11-5a1a00000001', 'a new habit lands under the goal it serves (unknown goal ids dropped)');
const revP = calls.length; script = () => ({ status: 'watch', headline: 'x', going: ['y'] });
await J.review({ app: 'nutrition' });
ok(/HIS BIG GOALS, THE HABITS AND RULES UNDER THEM/.test(calls.at(-1).turns[0].content) && /judged by what it does for his BIG GOALS/.test(calls.at(-1).system), 'app analysis is judged against the big goals');

console.log('15 · the maid cooks in the background');
const MAID = { ...MONDAY, blocks: MONDAY.blocks.filter(b => b.title !== 'Cook lunch').map(b => b.title === 'Lunch' ? { ...b, meal: 'lunch' } : b)
  .concat(B('10:00', '10:45', 'cook', 'Maid cooks lunch', { by: 'maid', makes: [{ meal: 'lunch' }], message: 'Please cook chicken breast 150 g, rice 150 g, broccoli 150 g for 12:00.' })) };
ok(E.validatePlan(monDay, MAID).ok, 'her cooking overlaps his lab and he isn\'t home — fine, it\'s in the background');
ok(E.validatePlan(monDay, { ...MAID, blocks: MAID.blocks.map(b => b.by === 'maid' ? { ...b, message: '' } : b) }).errors.some(e => /needs "message"/.test(e)), 'a maid block without the text to send her is rejected');
ok(E.validatePlan(monDay, { ...MAID, blocks: MAID.blocks.map(b => b.by === 'maid' ? { ...b, start: '11:40', end: '12:10' } : b) }).errors.some(e => /eaten before its cooking finishes/.test(e)), 'lunch can\'t be eaten before she finishes');
const BR2 = await import('../src/brain.js');
ok(/"by": "maid"/.test(BR2.PLAN_SYSTEM) && BR2.cleanPlan({ blocks: [{ start: '10:00', end: '10:45', type: 'cook', title: 'x', by: 'maid', message: 'hi' }] }).blocks[0].message === 'hi', 'the planner knows how to hand cooking to the maid');

console.log('16 · live traffic');
db.state.memory = db.state.memory.filter(m => m.kind !== 'day');
db.state.plans = db.state.plans.filter(p => p.date !== '2026-10-05').concat({ date: '2026-10-05', plan: JSON.parse(JSON.stringify(MONDAY)) });
const drv = () => db.state.plans.find(p => p.date === '2026-10-05').plan.blocks.findIndex(b => b.type === 'travel' && b.to === 'uni');
let tr = await J.traffic({ date: '2026-10-05', i: drv(), need: 31, nowMin: 440 });
ok(tr.action === 'ok' && /as expected/.test(db.state.plans.find(p => p.date === '2026-10-05').plan.blocks[drv()].trafficNote), 'on time: nothing changes, the leave alert will say traffic is as expected');
tr = await J.traffic({ date: '2026-10-05', i: drv(), need: 40, nowMin: 440 });
let tp = db.state.plans.find(p => p.date === '2026-10-05').plan;
ok(tr.action === 'shift' && tp.blocks[drv()].start === '07:40' && /leave for uni at 7:40am instead of 7:50am/.test(tr.message) && tp.changes.length === 1 && tp.changes[0].prevBlocks, `+10 min: leave earlier, taken from free time, with undo kept ("${tr.message}")`);
const stretch = JSON.parse(JSON.stringify(MONDAY)); stretch.blocks.push(B('07:00', '07:50', 'other', 'Sort the week’s notes', { loc: 'home' }));
db.state.plans = db.state.plans.filter(p => p.date !== '2026-10-05').concat({ date: '2026-10-05', plan: stretch });
tr = await J.traffic({ date: '2026-10-05', i: drv(), need: 38, nowMin: 400 });
ok(tr.action === 'shift' && /Sort the week’s notes ends at 7:42am instead of 7:50am/.test(tr.message), 'when there\'s no free time, a flexible block (not university work) gives up a few minutes and he\'s told which');
const NOWPLAN = { ...MONDAY, summary: 'Left late because of traffic.', blocks: [B('07:20', '08:30', 'travel', 'Drive to uni', { from: 'home', to: 'uni', reason: 'r' }), ...MONDAY.blocks.filter(b => b.start >= '08:30')] };
calls.length = 0;
script = (req, n) => n === 1 ? { ...NOWPLAN, blocks: NOWPLAN.blocks.map(b => b.type === 'travel' && b.to === 'uni' ? { ...b, start: '07:50' } : b) } : NOWPLAN;
tr = await J.traffic({ date: '2026-10-05', i: drv(), need: 70, nowMin: 440, coords: { at: 'home' } });
tp = db.state.plans.find(p => p.date === '2026-10-05').plan;
ok(/Live traffic \(check\): the drive to uni now takes 70 min/.test(calls[0].turns[0].content) && /"liveTrafficNow"/.test(calls[0].turns[0].content), 'a big delay goes to Claude with the live drive time');
ok(/Live traffic: the drive to uni takes 70 min right now/.test(calls[1].turns.at(-1).content), 'and a plan that ignores it is sent back');
ok(tr.action === 'replan' && tp.blocks.find(b => b.type === 'travel' && b.to === 'uni').start === '07:20' && /I re-planned the rest of today: Drive to uni: 7:4\dam → 7:20am/.test(tr.message), `the day is re-planned and he's told exactly what moved ("${tr.message.slice(0, 140)}…")`);
ok(tp.changes.length === 2 && db.state.messages.at(-1).body === tr.message, 'the change is kept with undo and posted in the conversation');

console.log('17 · never late: margin before class, slow routes learned, priorities, maid hours');
const d17 = await J.load(); d17.settings.prefs = { ...d17.settings.prefs, arrivalBuffer: 5, maidHours: { from: '06:00', to: '21:00' }, priorities: ['university', 'gym', 'nutrition', 'sleep'] };
let day17 = { ...(await J.dayFor(d17, '2026-10-05')), overrides: {} };
ok(E.validatePlan(day17, MONDAY).errors.some(e => /home → uni leaving 07:50 takes 28 min.*plus 5 min of margin \(5 min early for class\).*make it at least 33/.test(e)), 'a class drive without 5 min of margin is sent back');
const past17 = { date: '2026-10-01', plan: { blocks: [B('07:40', '08:10', 'travel', 'Drive to uni', { from: 'home', to: 'uni', liveMinutes: 41 })] } }, past18 = { date: '2026-10-02', plan: { blocks: [B('07:40', '08:10', 'travel', 'Drive to uni', { from: 'home', to: 'uni', liveMinutes: 37 })] } };
const learned = E.routeOverruns([past17, past18]);
ok(learned['home→uni morning'].extraMinutes === 11 && learned['home→uni morning'].drives === 2, 'it learns that the morning drive to uni runs over (11 min at the 80th percentile)');
day17 = { ...day17, travel: { ...day17.travel, learned } };
ok(E.validatePlan(day17, MONDAY).errors.some(e => /make it at least 44/.test(e)) && /run 11 min over in the morning/.test(E.validatePlan(day17, MONDAY).errors.join(' ')), 'so morning class drives get 16 min of margin on top of the forecast');
const F17 = E.dayFacts(day17);
ok(/university → gym → nutrition → sleep/.test(F17.whenTimeIsShort) && F17.maidHours === '06:00–21:00' && /5 min of margin/.test(F17.neverLate), 'the planner gets his priority order, the maid\'s hours and the margin rule');
ok(E.validatePlan(day17, { ...MONDAY, blocks: [...MONDAY.blocks, B('05:00', '05:40', 'cook', 'Maid cooks breakfast', { by: 'maid', makes: [{ meal: 'breakfast' }], message: 'x' })] }).errors.some(e => /maid works 6am–9pm/.test(e)), 'the maid can\'t be planned before 6am');
const sh17 = E.shiftForTraffic({ blocks: [B('06:00', '07:45', 'study', 'Prepare CE 337 lab'), B('07:50', '08:20', 'travel', 'Drive', { to: 'uni' })] }, 1, 7 * 60 + 40, 400);
ok(sh17 === null, 'a traffic shift never eats into university work — that goes to a re-plan instead');

console.log('18 · the questionnaire');
const QN = await import('../src/questionnaire.js');
const Qs = QN.buildQuestions({ courses: ['BIOL 110', 'CE 337'], prefs: { parking: 10, arrivalBuffer: 5 } });
ok(Qs.length >= 35 && QN.SECTIONS(Qs).includes('Your classes — BIOL 110') && Qs.some(q => q.id === 'c_bring_CE 337'), `${Qs.length} questions in ${QN.SECTIONS(Qs).length} sections, with questions for each of his classes`);
const ans = { s_sleep: { bed: '21:30', wake: '05:00' }, s_min: '7 hours', 'c_bring_BIOL 110': ['Lab coat', 'Safety goggles', 'Printed lab sheet / pre-lab', 'Gloves'], u_early: '10',
  p_rank: ['university', 'sleep', 'gym', 'nutrition'], f_who: { Breakfast: 'Me', Lunch: 'The maid', Dinner: 'The maid' }, t_lead: '15 min', f_no: '' };
const memNow = [...db.state.memory, { id: 'old-q', qid: 's_min', kind: 'rule', text: 'Never plan less than 6 hours…' }];
const chg = QN.answersToChanges(Qs, ans, memNow);
ok(chg.add.some(r => r.text === 'On school nights I sleep from 9:30pm to 5am.' && r.category === 'sleep') && chg.remove.includes('9a1f0c2e-0201-4b6a-9c11-5a1a00000201'), 'sleep times replace the old "9pm to 5am" rule');
ok(chg.add.some(r => r.course === 'BIOL 110' && r.strength === 'must' && /lab coat, safety goggles, printed lab sheet \/ pre-lab and gloves/.test(r.text)), 'what he brings to BIOL 110 becomes a must rule for that class (with his own extra item)');
ok(chg.prefs.arrivalBuffer === 10 && chg.prefs.priorities.join() === 'university,sleep,gym,nutrition' && chg.prefs.notify.lead === 15, 'answers that are settings go to settings (10 min early for class, his priority order, 15 min warning)');
ok(!Qs.some(q => q.id === 'goal_bf') && chg.remove.includes('old-q') && chg.add.every(r => r.qid && r.source === 'app'), 'the settled 12% question is gone; re-answering replaces what the question saved before');
ok(chg.add.some(r => /lunch — the maid cooks; dinner — the maid cooks/.test(r.text)) && chg.answeredCount === 7, 'who cooks each meal; blank answers are skipped');

console.log('19 · the weekly grocery day');
const list7 = E.weeklyGroceries('2026-10-06', null);
const chick = list7.find(x => x.food === 'chicken_breast'), milk = list7.find(x => x.food === 'milk'), rice = list7.find(x => x.food === 'rice');
ok(chick.buy === 'about 1.4 kg raw (1.05 kg cooked)' && rice.buy === 'about 360 g dry (1.05 kg cooked)' && milk.buy === '1.8 L' && list7.find(x => x.food === 'eggs').buy === '1.05 kg (about 21 large eggs)', 'a week of food, with raw amounts to buy for what is counted cooked (chicken 1.4 kg raw, rice 360 g dry, milk 1.8 L, 21 eggs)');
const dG = await J.load(); dG.settings.prefs = { ...dG.settings.prefs, groceryDay: 'Monday' };
const gDay = { ...(await J.dayFor(dG, '2026-10-05')), overrides: {} }, gF = E.dayFacts(gDay);
ok(gF.groceryDay.today && gF.groceryDay.shopKeys.includes('salmon') && /his grocery day is Monday/.test(gF.groceryDay.why), 'on his grocery day the planner gets the full list');
ok(E.validatePlan(gDay, MONDAY).errors.some(e => /Today is his grocery day/.test(e)), 'a grocery-day plan without the weekly shop is sent back');
const withShop = { ...MONDAY, blocks: MONDAY.blocks.map(b => b.type === 'travel' && b.start === '19:30' ? { ...b, end: '20:10', shop: gF.groceryDay.shopKeys } : b.start >= '19:40' && b.type !== 'sleep' ? { ...b, start: b.start === '19:40' ? '20:10' : b.start } : b) };
ok(!E.validatePlan(gDay, withShop).errors.some(e => /grocery day/.test(e)), '…and accepted with a shop stop on the drive home');
const dA = await J.load(); dA.settings.prefs = { ...dA.settings.prefs, groceryDay: null };
ok(/hasn't picked a grocery day/.test(E.dayFacts(await J.dayFor(dA, '2026-10-06')).groceryDay.why), 'until he picks one, it\'s the first day of the week without classes');

console.log('20 · two homes, three gym branches, and how busy they are');
const dP = await J.load();
dP.settings.places = { ...dP.settings.places, grandma: { lat: 29.28, lng: 48.05 }, gym_rigae: { lat: 29.32, lng: 47.93 }, gym_mahboula: { lat: 29.15, lng: 48.12 } };
delete dP.settings.places.gym;
dP.plans = [...dP.plans, { date: '2026-10-01', plan: { blocks: [B('18:00', '19:15', 'gym', 'Push', { loc: 'gym_mahboula', crowd: 'packed' })] } }, { date: '2026-10-08', plan: { blocks: [B('18:10', '19:20', 'gym', 'Pull', { loc: 'gym_mahboula', crowd: 'packed' })] } }];
const dayP = { ...(await J.dayFor(dP, '2026-10-05')), overrides: {} }, FP = E.dayFacts(dayP);
ok(FP.hisPlaces.keys.join() === 'home,uni,gym_rigae,grandma,gym_mahboula' && /never ask him which one/.test(FP.hisPlaces.gyms) && /none of his things are there/.test(FP.hisPlaces.grandma) && /Oxygen Gym Rigae \(key "gym_rigae"\)/.test(FP.hisPlaces.gyms), 'the planner knows both homes, which places are set, and each branch');
ok(FP.hisPlaces.howBusyHeSaidTheyWere['Oxygen Gym Mahboula, Thursdays 4–7pm'] === 'packed (2 reports)', 'his "packed" taps after training become what Jarvis knows about that branch at that time');
const atGym = { ...MONDAY, blocks: MONDAY.blocks.map(b => b.type === 'travel' && b.to === 'gym' ? { ...b, to: 'gym_rigae' } : b.type === 'gym' ? { ...b, loc: 'gym_rigae' } : b) };
ok(!E.validatePlan(dayP, atGym).errors.some(e => /gym/i.test(e)), 'training at a branch passes');
const wrongBranch = { ...atGym, blocks: atGym.blocks.map(b => b.type === 'gym' ? { ...b, loc: 'gym_mahboula' } : b) };
ok(E.validatePlan(dayP, wrongBranch).errors.some(e => /is at Oxygen Gym Mahboula, but he'd still be at Oxygen Gym Rigae/.test(e)), 'but he can\'t drive to Rigae and train at Mahboula');
ok(E.validatePlan(dayP, { ...MONDAY, blocks: MONDAY.blocks.map(b => b.type === 'travel' && b.to === 'gym_rigae' ? { ...b, to: 'gym_sabah' } : b) }).errors.some(e => /hasn't set as a place/.test(e)) || !dayP.drive.known, 'a branch he hasn\'t set can\'t be used');

console.log('21 · his apps were only read');
ok(JSON.stringify(db.state.pplRows) === JSON.stringify(SAMPLE.pplRows) && JSON.stringify(db.state.nutritionRows) === JSON.stringify(SAMPLE.nutritionRows) && JSON.stringify(db.state.events) === JSON.stringify(SAMPLE.events), 'PPL Coach, Nutrition Coach and Uni Planner data unchanged');
console.log('\ncore test passed');
