// A stand-in for Claude in the page, for the click-through test only. Answers like the real thing would, but scripted.
(function () {
  const B = (start, end, type, title, extra) => Object.assign({ start, end, type, title, reason: 'Because it fits the day.' }, extra || {});
  const MONDAY = { summary: 'Lab at 8:30, two lectures, Legs at 6pm, lights out 9pm.', notes: ['Pack the pre-workout yogurt and banana — you eat it at uni at 4pm.'],
    bring: [{ what: 'Gym bag', why: 'Legs at 6pm straight from CE 468.' }, { what: 'Pre-workout yogurt and banana, with an ice pack', why: 'You eat it at uni at 4pm.' }],
    choices: [{ problem: 'Legs runs until 7:30pm', picked: 'Train at 6pm as you prefer', options: [{ title: 'Train at 2:15pm between classes', costs: 'Moves the BIOL quiz to the evening' }] }], blocks: [
    B('05:00', '05:00', 'wake', 'Wake up', { loc: 'home' }), B('05:05', '05:20', 'cook', 'Make breakfast', { loc: 'home', detail: 'Eggs 150 g' }), B('05:20', '05:40', 'meal', 'Breakfast', { loc: 'home', detail: 'Eggs, Greek yogurt, blueberries, banana; creatine, D3, omega-3' }),
    B('05:40', '07:00', 'study', 'Prepare CE 337 Graded Lab 1', { loc: 'home', ref: 'lab337-1', detail: 'Read the lab sheet, sketch the circuit', reason: 'It is 15% and due at 8:30 — the morning is the last chance.' }),
    B('07:50', '08:20', 'travel', 'Drive to uni', { from: 'home', to: 'uni', reason: '18 min empty road plus 10 to park, with a few minutes of margin.' }),
    B('08:30', '11:00', 'class', 'CE 337 Lab', { loc: 'uni', detail: 'E2-F-03' }), B('11:00', '11:30', 'travel', 'Drive home', { from: 'uni', to: 'home' }),
    B('11:30', '12:00', 'cook', 'Cook lunch', { loc: 'home' }), B('12:00', '12:20', 'meal', 'Lunch', { loc: 'home', detail: 'Chicken breast 150 g, rice 150 g, broccoli, spinach, olive oil' }),
    B('12:25', '12:55', 'travel', 'Drive to uni', { from: 'home', to: 'uni' }), B('13:00', '14:15', 'class', 'BIOL 110 Lecture', { loc: 'uni', detail: 'B2-F-08' }),
    B('14:15', '15:30', 'study', 'BIOL 110 lab safety quiz', { loc: 'uni', ref: 'quiz-bio' }), B('16:00', '16:10', 'meal', 'Pre-workout', { loc: 'uni', detail: 'Greek yogurt, banana — skip the caffeine today' }),
    B('16:30', '17:45', 'class', 'CE 468 Lecture', { loc: 'uni', detail: 'E1-G-04' }), B('17:45', '18:00', 'travel', 'Drive to Oxygen Rigae', { from: 'uni', to: 'gym_rigae' }),
    B('18:00', '19:30', 'gym', 'Legs', { loc: 'gym_rigae', detail: 'Hack squat, RDL, leg press, leg extension, leg curl, calves, abs' }), B('19:30', '19:40', 'travel', 'Drive home', { from: 'gym', to: 'home' }),
    B('19:40', '20:05', 'cook', 'Cook dinner', { loc: 'home' }), B('20:05', '20:25', 'meal', 'Dinner', { loc: 'home', detail: 'Salmon 120 g, sweet potato 190 g, cucumber, red pepper' }),
    B('20:30', '20:40', 'meal', 'Evening shake', { loc: 'home', detail: 'Milk, whey, strawberries, walnuts; magnesium, ashwagandha' }), B('21:00', '21:00', 'sleep', 'Lights out', { loc: 'home' }),
    B('15:00', '15:45', 'cook', 'Maid cooks tomorrow’s lunch', { by: 'maid', makes: [{ meal: 'lunch', date: '2026-10-06' }], message: 'Tomorrow’s lunch please: chicken breast 150 g, rice 150 g, broccoli 150 g — in the fridge by 4pm.' })] };
  const LATE = { summary: 'Gym at 10pm, lights out 12:30am.', notes: ['That leaves 4½ hours of sleep before 5am — tell me if Tuesday should start later.'], blocks: [
    B('11:40', '12:00', 'cook', 'Cook lunch', { loc: 'home' }), B('12:00', '12:20', 'meal', 'Lunch', { loc: 'home' }), B('12:25', '12:55', 'travel', 'Drive to uni', { from: 'home', to: 'uni' }),
    B('13:00', '14:15', 'class', 'BIOL 110 Lecture', { loc: 'uni' }), B('16:30', '17:45', 'class', 'CE 468 Lecture', { loc: 'uni' }), B('17:45', '18:15', 'travel', 'Drive home', { from: 'uni', to: 'home' }),
    B('18:15', '19:00', 'cook', 'Cook dinner', { loc: 'home' }), B('19:00', '19:20', 'meal', 'Dinner', { loc: 'home' }), B('21:45', '22:00', 'travel', 'Drive to Oxygen Rigae', { from: 'home', to: 'gym_rigae' }),
    B('22:00', '23:30', 'gym', 'Legs', { loc: 'gym_rigae' }), B('23:30', '23:45', 'travel', 'Drive home', { from: 'gym', to: 'home' }), B('00:30', '00:30', 'sleep', 'Lights out', { loc: 'home' })] };
  const REVIEW = { ppl: { status: 'problem', headline: 'Five of your Set 1s are below the rep minimum, and PPL Coach will never lower them.', going: ['5 sessions since 27 Sep: Push ×2, Pull ×2, Legs ×1.', 'Incline DB press 27.5×8 → 30×6.'],
      mistakes: [{ title: 'Lat pulldown set 2 heavier than Set 1', detail: '40×10 then 45×5 — the 4-set system says set 2 is 92% of Set 1 = 35 kg.' }], changes: [{ what: 'Flat machine press Set 1', from: '90 kg × 5', to: '75 kg', why: '5 reps is under the 8-rep minimum two sessions running; the app keeps 90 kg forever.' }],
      missing: ['No increments set for the leg exercises (all default 2.5 kg).'], better: [{ title: 'Train every day as you said', why: 'PPL Coach inserts Rest after Legs; your rule is a gym slot every day.' }], questions: ['Is the 7 kg increment on the triceps pushdown on purpose?'] },
    nutrition: { status: 'watch', headline: 'Nutrition Coach can’t adjust your calories: no body-fat readings and 1 of 2 days logged.', going: ['Weight 86.4 → 85.7 kg over 3 days.'], missing: ['Body-fat readings — the cut review needs them.'], changes: [], questions: ['Do you have a scale that measures body fat?'] },
    uni: { status: 'watch', headline: '35% of your grade lands between 18 and 21 Oct.', going: ['CE 337 Graded Lab 1 (15%) today at 8:30.'], mistakes: [{ title: 'CE 462 quiz date is a guess', detail: 'Your note says to check the exact day on Moodle.' }], changes: [{ what: 'CE 462 Moodle quiz date', from: '18 Oct (a guess)', to: 'the date on Moodle', why: 'Its prep and reminders are timed from it.' }] } };
  const OPTIONS = { situation: 'You get home at 7:40 and lights out is 9 — 25 minutes of cooking is the squeeze.', pick: 1, why: 'Same protein, no cooking.', options: [
    { title: 'Same dinner, faster', kind: 'faster', how: 'Sweet potato in the microwave (7 min) while the salmon goes in the air fryer.', minutes: 15, meal: 'dinner', today: 'Dinner at 7:55.', costs: 'Nothing.' },
    { title: 'No-cook protein bowl', kind: 'swap', how: 'Greek yogurt, whey, banana and walnuts.', minutes: 5, meal: 'dinner', foods: [{ food: 'greek_yogurt', grams: 300 }, { food: 'whey', grams: 30 }, { food: 'banana', grams: 120 }, { food: 'walnuts', grams: 15 }], today: 'Dinner at 7:45.', costs: 'Less omega-3 than the salmon.' }] };
  let lastAsk = '';
  const sample = function () { return Promise.reject({ code: 'invalid_request', message: 'use json' }); };
  sample.json = async (input, opts) => {
    const t = input[0].content;
    await new Promise(r => setTimeout(r, 120));
    if (opts && opts.onText) opts.onText({ text: '{"blocks":[{"start":', delta: '' });
    if (t.includes('Something got in the way')) return OPTIONS;
    if (t.includes('You plan ONE day')) {
      const m = t.match(/it is now (\d\d):(\d\d)/);
      if (/He chose: "No-cook protein bowl"/.test(t)) {          // the rest of the day around his pick: no cooking for dinner
        const from = m ? +m[1] * 60 + +m[2] : 0, toM = x => +x.slice(0, 2) * 60 + +x.slice(3);
        return { ...MONDAY, summary: 'Same day, protein bowl for dinner — no cooking tonight.', blocks: MONDAY.blocks.filter(b => toM(b.start) >= from && b.title !== 'Cook dinner').map(b => b.title === 'Dinner' ? { ...b, meal: 'dinner' } : b) };
      }
      return m && +m[1] >= 5 ? LATE : MONDAY;
    }
    if (t.includes('He is talking to you')) {
      lastAsk = t.split('HIS MESSAGE: ').pop().split('\n\nReply with ONLY')[0];
      if (/10pm/.test(lastAsk)) return { reply: 'Done — gym at 10pm tonight, just for today. Lights out moves to 12:30am.', remember: [{ kind: 'day', date: t.match(/Today is \w+ (\d{4}-\d\d-\d\d)/)[1], text: 'Not sleeping at 9pm today — gym at 10pm', mustKeep: { gymAt: '22:00' } }], replan: t.match(/Today is \w+ (\d{4}-\d\d-\d\d)/)[1] };
      if (/prefer|always|need|bring/i.test(lastAsk)) return { reply: 'Want me to add that to Personal?', remember: [{ kind: 'rule', strength: /need|always/i.test(lastAsk) ? 'must' : 'prefer', category: /bring/i.test(lastAsk) ? 'university' : 'food', ...( /BIOL/.test(lastAsk) ? { course: 'BIOL 110' } : {}), text: lastAsk.trim() }] };
      return { reply: 'This week: CE 337 Graded Lab 1 today (15%), the BIOL 110 quiz Wednesday, then 35% of your grade between 18 and 21 Oct.' };
    }
    if (t.includes('Analyse ONE')) return t.includes('PPL Coach —') && t.includes('Analyse ONE of his apps — PPL Coach') ? REVIEW.ppl : t.includes('Analyse ONE of his apps — Nutrition Coach') ? REVIEW.nutrition : REVIEW.uni;
    return { headline: 'A thin week of data, but the timetable is clear.', sections: [{ area: 'ppl', title: 'PPL Coach', points: ['5 sessions.'] }], changes: [{ app: 'Uni Planner', what: 'Confirm the CE 462 quiz date', why: 'It is a guess.' }], ideas: [{ title: 'Weigh in daily', why: 'Trends need 4 readings a week.' }] };
  };
  window.claude = { use: async name => name === 'sample' ? sample : null };
})();
