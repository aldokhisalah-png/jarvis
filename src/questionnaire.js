// =====================================================================
// THE QUESTIONNAIRE — everything Jarvis needs to know about how Salah lives, asked once, properly.
// Every answer turns into something Jarvis plans by: a rule in the Personal tab (with a category, and a course for
// per-class answers) or a setting (parking, minutes early for class, priorities, warning time). Questions about each
// class come from his timetable. Re-answering replaces what that question saved before (rules carry the question id).
// Pure functions, so the app, the preview and the tests all use the same logic.
// =====================================================================
import { G_BODY, G_GRADES } from './his-memory.js';

const OLD = { sleep: '9a1f0c2e-0201-4b6a-9c11-5a1a00000201', gym6: '9a1f0c2e-0202-4b6a-9c11-5a1a00000202', priority: '9a1f0c2e-0208-4b6a-9c11-5a1a00000208' };
const hm = t => { const [h, m] = String(t || '').split(':').map(Number); if (!isFinite(h)) return t; const ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`; };
const list = xs => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const rule = (category, text, o = {}) => ({ kind: 'rule', strength: o.must ? 'must' : 'prefer', category, text, serves: o.serves || [], ...(o.course ? { course: o.course } : {}) });

/** ctx = { courses: ['BIOL 110', …], prefs: day_settings.prefs, gymMinutes?: number } */
function buildQuestions(ctx = {}) {
  const P = ctx.prefs || {}, courses = (ctx.courses || []).slice().sort();
  const Q = [
    // ---------- sleep and mornings ----------
    { id: 's_sleep', section: 'Sleep and mornings', q: 'On a night before classes, when do you want lights out, and when do you get up?', why: 'Every day is planned backwards from these two times.', type: 'times', fields: [['bed', 'Lights out', '21:00'], ['wake', 'Up at', '05:00']],
      save: a => ({ add: [rule('sleep', `On school nights I sleep from ${hm(a.bed)} to ${hm(a.wake)}.`)], remove: [OLD.sleep] }) },
    { id: 's_min', section: 'Sleep and mornings', q: 'What is the least sleep you still function well on before a class day?', why: 'When a day gets squeezed (late gym, traffic, a deadline), Jarvis won\'t go below this.', type: 'choice', options: ['6 hours', '6.5 hours', '7 hours', '7.5 hours', '8 hours'],
      save: a => ({ add: [rule('sleep', `Never plan less than ${a} of sleep before a class day.`, { must: true, serves: [G_GRADES, G_BODY] })] }) },
    { id: 's_weekend', section: 'Sleep and mornings', q: 'On days without classes (Fridays, Saturdays, breaks), how do you sleep?', why: 'So free days are planned around how you actually live.', type: 'choice', options: ['Same times as school days', 'About an hour later', 'About two hours later', 'No fixed times — let me sleep'],
      save: a => ({ add: [rule('sleep', `On days without classes: ${a.toLowerCase()}.`)] }) },
    { id: 's_ready', section: 'Sleep and mornings', q: 'From waking up to walking out the door, how long do you need just to get ready (no breakfast, no cooking)?', why: 'So mornings aren\'t planned tighter than you can move.', type: 'number', unit: 'min', min: 5, max: 90, placeholder: '25',
      save: a => ({ add: [rule('sleep', `Getting ready in the morning takes me about ${a} minutes, not counting breakfast.`)] }) },
    { id: 's_shower', section: 'Sleep and mornings', q: 'When do you usually shower?', why: 'A shower is 10–20 minutes Jarvis has to place.', type: 'choice', options: ['In the morning', 'In the evening', 'After the gym', 'Morning and after the gym'],
      save: a => ({ add: [rule('sleep', `I shower ${a.toLowerCase().replace('in the ', 'in the ')}.`)] }) },
    { id: 's_wind', section: 'Sleep and mornings', q: 'How long do you need to wind down (no screens, no work) before lights out?', why: 'Jarvis keeps this time free every night.', type: 'choice', options: ['15 min', '30 min', '45 min', '60 min'],
      save: a => ({ add: [rule('sleep', `I need ${a} to wind down before lights out — keep it free.`)] }) },

    // ---------- university ----------
    { id: 'u_early', section: 'University', q: 'How many minutes before class do you want to be in the room?', why: 'Every drive to uni gets this margin on top of traffic and parking, and the checker enforces it.', type: 'number', unit: 'min', min: 0, max: 30, prefill: P.arrivalBuffer ?? 5,
      save: a => ({ prefs: { arrivalBuffer: +a }, add: [rule('travel', `Be in the room ${a} minutes before every class.`, { must: true, serves: [G_GRADES] })] }) },
    { id: 'u_place', section: 'University', q: 'Where do you actually get good work done?', why: 'Jarvis only puts study blocks where you can focus.', type: 'multi', options: ['At home', 'Uni library', 'Between classes on campus', 'A café', 'In the car (reading only)'],
      save: a => ({ add: [rule('study', `I study well: ${list(a.map(x => x.toLowerCase()))}.`, { serves: [G_GRADES] })] }) },
    { id: 'u_best', section: 'University', q: 'When is your head clearest for hard studying?', why: 'The hardest work goes in your best hours.', type: 'choice', options: ['Early morning (before 8am)', 'Late morning', 'Afternoon', 'Evening'],
      save: a => ({ add: [rule('study', `My best time for hard studying is ${a.toLowerCase()}.`, { serves: [G_GRADES] })] }) },
    { id: 'u_block', section: 'University', q: 'How long can you focus before you need a break, and how long a break?', why: 'Study blocks are cut to your real attention span.', type: 'times2', fields: [['focus', 'Focus (min)', '50'], ['rest', 'Break (min)', '10']],
      save: a => ({ add: [rule('study', `I study in blocks of about ${a.focus} minutes with ${a.rest}-minute breaks.`, { serves: [G_GRADES] })] }) },
    { id: 'u_gca', section: 'University', q: 'How many days before a GCA do you want to start preparing?', why: 'Your 2–4 hours of GCA prep get spread over these days (plus your 1-hour block the day before).', type: 'choice', options: ['2 days', '3 days', '5 days', '7 days'],
      save: a => ({ add: [rule('study', `Start preparing for a GCA ${a} before it.`, { serves: [G_GRADES] })] }) },
    { id: 'u_exam', section: 'University', q: 'How many days before a midterm or final do you want to start?', why: 'Exams take you 4–10 hours; this sets how far it\'s spread.', type: 'choice', options: ['5 days', '7 days', '10 days', '14 days'],
      save: a => ({ add: [rule('study', `Start preparing for a midterm or final ${a} before it.`, { serves: [G_GRADES] })] }) },
    { id: 'u_quiz', section: 'University', q: 'How long do you need for a quiz?', why: 'You told me assignments, GCAs, exams and labs — not quizzes.', type: 'choice', options: ['30 min', '1 hour', '2 hours'],
      save: a => ({ add: [rule('study', `A quiz takes me about ${a} to prepare.`, { serves: [G_GRADES] })] }) },
    { id: 'u_review', section: 'University', q: 'Do you want a short review of each lecture the same day?', why: 'Reviewing the same day is one of the cheapest ways to raise grades; Jarvis would fit it in gaps.', type: 'choice', options: ['Yes — 10 minutes', 'Yes — 20 minutes', 'Only for my hardest courses', 'No'],
      save: a => a === 'No' ? { add: [] } : ({ add: [rule('study', a.startsWith('Only') ? 'Review the day\'s lecture the same day, for my hardest courses only.' : `Review each lecture the same day for about ${a.replace('Yes — ', '')}.`, { serves: [G_GRADES] })] }) },

    // ---------- each class ----------
    ...courses.flatMap(c => [
      { id: `c_bring_${c}`, section: `Your classes — ${c}`, q: `What do you bring to ${c}?`, why: 'It goes on your "Take with you" list every day you have this class.', type: 'multi', other: true,
        options: ['Laptop and charger', 'Calculator', 'Notebook and pen', 'Textbook', 'Lab coat', 'Safety goggles', 'Printed lab sheet / pre-lab', 'USB / project files'],
        save: a => ({ add: a.length ? [rule('university', `For ${c}, bring: ${list(a.map(x => x.toLowerCase()))}.`, { must: true, course: c, serves: [G_GRADES] })] : [] }) },
      { id: `c_hard_${c}`, section: `Your classes — ${c}`, q: `How hard is ${c} for you right now?`, why: 'Harder courses get more of your study time and earlier starts.', type: 'choice', options: ['1 — easy', '2', '3 — average', '4', '5 — hardest'],
        save: a => ({ add: [rule('university', `${c} is ${a.split(' ')[0]}/5 hard for me${+a[0] >= 4 ? ' — give it more study time and start earlier' : +a[0] <= 2 ? ' — it needs less study time' : ''}.`, { course: c, serves: [G_GRADES] })] }) }
    ]),

    // ---------- gym ----------
    { id: 'g_time', section: 'Gym', q: 'When do you prefer to train, and what is the latest you\'ll start a session?', why: 'Preferred time when it fits; never later than the latest.', type: 'times', fields: [['pref', 'Preferred', '18:00'], ['latest', 'Latest start', '20:00']],
      save: a => ({ add: [rule('gym', `Gym at ${hm(a.pref)} if possible.`, { serves: [G_BODY] }), rule('gym', `Never start the gym after ${hm(a.latest)}.`, { must: true, serves: [G_BODY] })], remove: [OLD.gym6] }) },
    { id: 'g_length', section: 'Gym', q: 'Door to door at the gym — changing, training, shower if you take one — how long?', why: 'PPL Coach only measures the workout itself.', type: 'number', unit: 'min', min: 30, max: 180, placeholder: String((ctx.gymMinutes || 70) + 15),
      save: a => ({ add: [rule('gym', `A gym visit takes me about ${a} minutes door to door.`, { serves: [G_BODY] })] }) },
    { id: 'g_pre', section: 'Gym', q: 'How long before training do you take your pre-workout?', why: 'So it\'s timed right and kept away from bedtime.', type: 'choice', options: ['15 min', '30 min', '45 min', '60 min'],
      save: a => ({ add: [rule('food', `Pre-workout ${a} before training.`, { serves: [G_BODY] })] }) },
    { id: 'g_caffeine', section: 'Gym', q: 'How close to bedtime can you have caffeine and still sleep?', why: 'Your pre-workout has 200 mg; late sessions may need it skipped.', type: 'choice', options: ['4 hours', '6 hours', '8 hours', '10 hours'],
      save: a => ({ add: [rule('sleep', `No caffeine within ${a} of lights out.`, { must: true, serves: [G_BODY] })] }) },
    { id: 'g_rest', section: 'Gym', q: 'You train every day and pick rest days yourself. When should Jarvis suggest one?', why: 'Jarvis never plans a rest day on its own — this only decides when it offers one.', type: 'choice', options: ['Never — I\'ll tell it', 'Only when a day truly can\'t fit the gym', 'Also when my lifts stall or I\'ve trained many days straight'],
      save: a => ({ add: [rule('gym', a.startsWith('Never') ? 'Never suggest a rest day — I decide when I rest.' : a.startsWith('Only') ? 'Suggest a rest day only when a day truly can\'t fit the gym.' : 'Suggest a rest day when a day can\'t fit the gym, or when my lifts stall or I\'ve trained many days straight.', { serves: [G_BODY] })] }) },
    { id: 'g_between', section: 'Gym', q: 'Is it OK to train in a gap between classes and go back to uni?', why: 'It\'s what made Tuesday work — but it means a shower and a bag.', type: 'choice', options: ['Yes', 'Only if the gap is at least 2.5 hours', 'No — after classes only'],
      save: a => ({ add: [rule('gym', a === 'Yes' ? 'Training between classes and going back to uni is fine.' : a.startsWith('Only') ? 'Train between classes only if the gap is at least 2.5 hours.' : 'Don\'t plan the gym between classes — after classes only.', { serves: [G_BODY] })] }) },

    // ---------- food ----------
    { id: 'f_who', section: 'Food and cooking', q: 'Who cooks each meal by default?', why: 'Your own cooking takes your time; your maid\'s doesn\'t (6am–9pm).', type: 'perItem', items: ['Breakfast', 'Lunch', 'Dinner'], options: ['Me', 'The maid', 'Either'],
      save: a => ({ add: [rule('food', `By default: ${Object.entries(a).map(([m, w]) => `${m.toLowerCase()} — ${w === 'Me' ? 'I cook' : w === 'The maid' ? 'the maid cooks' : 'either of us'}`).join('; ')}.`, { serves: [G_BODY] })] }) },
    { id: 'f_own', section: 'Food and cooking', q: 'When you cook breakfast yourself, how long does it take?', why: 'A starting number; Jarvis then learns the real one from your Start/Done taps.', type: 'number', unit: 'min', min: 3, max: 60, placeholder: '15',
      save: a => ({ add: [rule('food', `Cooking breakfast myself takes about ${a} minutes.`)] }) },
    { id: 'f_eat', section: 'Food and cooking', q: 'How long do you take to eat a meal?', why: 'Meals get real time, not 5 minutes.', type: 'choice', options: ['10 min', '15 min', '20 min', '30 min'],
      save: a => ({ add: [rule('food', `I take about ${a} to eat a meal.`)] }) },
    { id: 'f_dinner', section: 'Food and cooking', q: 'How long before lights out should dinner be finished?', why: 'Digestion and sleep — your cut needs both.', type: 'choice', options: ['1 hour', '1.5 hours', '2 hours', '3 hours'],
      save: a => ({ add: [rule('food', `Finish dinner at least ${a} before lights out.`, { serves: [G_BODY] })] }) },
    { id: 'f_uni', section: 'Food and cooking', q: 'Can you keep food cold or heat it at uni?', why: 'A packed lunch in Kuwait heat needs a plan.', type: 'choice', options: ['Fridge and microwave', 'Fridge only', 'Microwave only', 'Neither — ice pack only'],
      save: a => ({ add: [rule('food', `At uni I have: ${a.toLowerCase()}.`)] }) },
    { id: 'f_no', section: 'Food and cooking', q: 'Anything you won\'t eat, can\'t get easily, or always have at home?', why: 'So swaps and shopping are realistic.', type: 'text', placeholder: 'e.g. always have eggs and yogurt; salmon only from one shop', optional: true,
      save: a => ({ add: a ? [rule('food', `Food notes: ${a}`)] : [] }) },
    { id: 'f_shop_day', section: 'Food and cooking', q: 'Which day do you want as your weekly grocery day?', why: 'Jarvis plans the shop with the full list for the coming week (the same list as Nutrition Coach\'s Grocery tab).', type: 'choice', options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Let Jarvis pick the first day without classes'],
      save: a => ({ prefs: { groceryDay: a.startsWith('Let') ? null : a }, add: [rule('food', a.startsWith('Let') ? 'Grocery shopping once a week, on the first day without classes.' : `My grocery day is ${a}.`, { serves: [G_BODY] })] }) },
    { id: 'f_shop', section: 'Food and cooking', q: 'Where do you buy groceries, and how long does a quick stop take?', why: 'Jarvis adds shop stops to drives when you\'re out of something.', type: 'textNum', placeholder: 'e.g. Lulu near uni', unit: 'min',
      save: a => ({ add: [rule('travel', `I shop at ${a.text || 'the supermarket'}; a quick stop takes about ${a.num || 20} minutes.`)] }) },

    // ---------- travel ----------
    { id: 't_park', section: 'Travel', q: 'From parking at uni to sitting in the room, how many minutes?', why: 'Added to every drive to uni.', type: 'number', unit: 'min', min: 0, max: 30, prefill: P.parking ?? 10,
      save: a => ({ prefs: { parking: +a } }) },
    { id: 't_notes', section: 'Travel', q: 'Any roads or times you avoid, or routes that are always slow?', why: 'Live traffic covers most of it; local knowledge covers the rest.', type: 'text', optional: true, placeholder: 'e.g. 6th Ring Road is jammed 7–8am',
      save: a => ({ add: a ? [rule('travel', `Traffic notes: ${a}`)] : [] }) },
    { id: 't_lead', section: 'Travel', q: 'How long before you have to leave should Jarvis warn you?', why: 'The "Leave at…" notification.', type: 'choice', options: ['5 min', '10 min', '15 min', '20 min'],
      save: a => ({ prefs: { notify: { ...(P.notify || {}), lead: parseInt(a, 10) } } }) },

    // ---------- priorities and commitments ----------
    { id: 'p_rank', section: 'Priorities and commitments', q: 'When time runs out, what gets protected first? Order them.', why: 'Traffic, late classes and long days take time from the bottom of this list first.', type: 'rank', items: ['university', 'gym', 'nutrition', 'sleep'], prefill: P.priorities || ['university', 'gym', 'nutrition', 'sleep'],
      save: a => ({ prefs: { priorities: a }, add: [rule('travel', `Never be late. When traffic or time forces changes, protect in this order: ${a.join(', then ')}.`, { must: true, serves: [G_GRADES, G_BODY] })], remove: [OLD.priority] }) },
    { id: 'p_never', section: 'Priorities and commitments', q: 'What should Jarvis never drop, whatever happens?', why: 'These survive every re-plan.', type: 'multi', options: ['Classes', 'Graded deadlines', 'A gym session', 'My minimum sleep', 'Every meal', 'Evening shake and supplements'],
      save: a => ({ add: a.length ? [rule('other', `Never drop: ${list(a.map(x => x.toLowerCase()))}.`, { must: true, serves: [G_GRADES, G_BODY] })] : [] }) },
    { id: 'p_trade', section: 'Priorities and commitments', q: 'Do you trade during the week? If so, when?', why: 'Market hours are fixed time Jarvis must plan around.', type: 'text', optional: true, placeholder: 'e.g. NY open 4:30–6pm Mon–Thu, not on class days',
      save: a => ({ add: a ? [rule('other', `Trading time: ${a}`, { must: true })] : [] }) },
    { id: 'p_fixed', section: 'Priorities and commitments', q: 'Any other fixed weekly commitments (family, work, appointments)?', why: 'Anything Jarvis must never plan over.', type: 'text', optional: true, placeholder: 'one per line, e.g. Thu 8pm family dinner',
      save: a => ({ add: a ? a.split(/\n|;/).map(x => x.trim()).filter(Boolean).slice(0, 8).map(x => rule('other', `Fixed commitment: ${x}`, { must: true })) : [] }) },

    // ---------- goals ----------
    { id: 'goal_grades', section: 'Your goals', q: 'Is there a specific grade or GPA you\'re aiming for this semester?', why: '"Highest possible" works; a number lets Jarvis tell you when a course is at risk.', type: 'text', optional: true, placeholder: 'e.g. A in every course, or a 3.7 GPA',
      save: a => ({ add: a ? [rule('university', `Grade target this semester: ${a}`, { serves: [G_GRADES] })] : [] }) }
  ];
  return Q;
}

const SECTIONS = Q => [...new Set(Q.map(q => q.section))];
const answered = (q, a) => a != null && a !== '' && !(Array.isArray(a) && !a.length) && !(typeof a === 'object' && !Array.isArray(a) && !Object.values(a).some(v => v !== '' && v != null));

/** What saving the answers will do: rules to add (each tagged with its question), old rules to remove, settings, goal updates. */
function answersToChanges(Q, answers, memory = []) {
  const out = { add: [], remove: new Set(), prefs: {}, updates: [], answeredCount: 0 };
  for (const q of Q) {
    const a = answers[q.id];
    if (!answered(q, a)) continue;
    out.answeredCount++;
    const r = q.save(a) || {};
    for (const row of r.add || []) out.add.push({ ...row, qid: q.id, source: 'app' });
    for (const id of r.remove || []) if (memory.some(m => String(m.id) === id)) out.remove.add(id);
    for (const m of memory.filter(m => m.qid === q.id)) out.remove.add(String(m.id));        // re-answering replaces the last answer
    Object.assign(out.prefs, r.prefs || {});
    out.updates.push(...(r.updates || []));
  }
  return { ...out, remove: [...out.remove] };
}

export { buildQuestions, answersToChanges, SECTIONS, answered };
