// What Salah has told Claude, as Jarvis's starting memory — in three levels:
//   goal  → a big-picture outcome (everything else exists to reach it)
//   habit → a small-picture goal he set to reach a big goal (serves: goal ids; track: how Jarvis measures it)
//   rule  → an approximate rule or preference: how long things take, when he likes to do them (serves: goal ids, optional;
//           category: which part of the Personal tab it lives in — study, university, gym, food, sleep, travel, home, other; course for per-class rules)
// Shared by the preview, the tests and the seed SQL, so every copy says the same thing. He can change any of it in the app.
const G_BODY = '9a1f0c2e-0001-4b6a-9c11-5a1a00000001', G_GRADES = '9a1f0c2e-0002-4b6a-9c11-5a1a00000002';
const HIS_MEMORY = [
  { id: G_BODY, kind: 'goal', text: 'Get to 80 kg at 12% body fat, as fast as possible.', track: 'body', target: { weightKg: 80, bodyFatPct: 12, by: 'asap' } },
  { id: G_GRADES, kind: 'goal', text: 'Get the highest grade possible this semester.', track: 'grades', target: { term: 'Fall 2026' } },

  { id: '9a1f0c2e-0101-4b6a-9c11-5a1a00000101', kind: 'habit', strength: 'must', serves: [G_BODY], track: 'gym_daily', text: 'Go to the gym every day. Rest days are rare and random — I pick them myself (sometimes one a week, sometimes one a month). When PPL Coach shows Rest, I carry on with Push.' },
  { id: '9a1f0c2e-0102-4b6a-9c11-5a1a00000102', kind: 'habit', strength: 'must', serves: [G_BODY], track: 'progressive_overload', text: 'Train right: progressive overload.' },
  { id: '9a1f0c2e-0103-4b6a-9c11-5a1a00000103', kind: 'habit', strength: 'must', serves: [G_BODY], track: 'macros', text: 'Eat the correct macros for each phase.' },
  { id: '9a1f0c2e-0104-4b6a-9c11-5a1a00000104', kind: 'habit', strength: 'must', serves: [G_GRADES], track: 'classes_on_time', text: 'Go to classes on time.' },
  { id: '9a1f0c2e-0105-4b6a-9c11-5a1a00000105', kind: 'habit', strength: 'must', serves: [G_GRADES], track: 'assignments_on_time', text: 'Do my assignments on time.' },
  { id: '9a1f0c2e-0106-4b6a-9c11-5a1a00000106', kind: 'habit', strength: 'must', serves: [G_GRADES], track: 'study_on_time', text: 'Study for tests and exams on time.' },

  { id: '9a1f0c2e-0201-4b6a-9c11-5a1a00000201', kind: 'rule', category: 'sleep', strength: 'prefer', serves: [], text: 'I sleep from 9pm to 5am.' },
  { id: '9a1f0c2e-0202-4b6a-9c11-5a1a00000202', kind: 'rule', category: 'gym', strength: 'prefer', serves: [G_BODY], text: 'Gym at 6pm if possible.' },
  { id: '9a1f0c2e-0203-4b6a-9c11-5a1a00000203', kind: 'rule', category: 'study', strength: 'prefer', serves: [G_GRADES], text: 'An assignment takes me about 1 hour (2 hours max). Studying for a test or GCA takes 2–4 hours. An exam takes 4–10 hours spread over a few days.' },
  { id: '9a1f0c2e-0204-4b6a-9c11-5a1a00000204', kind: 'rule', category: 'study', strength: 'prefer', serves: [G_GRADES], text: 'Preparing for a graded lab takes me about 30 minutes, sometimes none.' },
  { id: '9a1f0c2e-0205-4b6a-9c11-5a1a00000205', kind: 'rule', category: 'study', strength: 'prefer', serves: [G_GRADES], text: 'I do assignments as soon as they open.' },
  { id: '9a1f0c2e-0206-4b6a-9c11-5a1a00000206', kind: 'rule', category: 'study', strength: 'must', serves: [G_GRADES], text: 'I need a 1-hour study block the day before every GCA.' },
  { id: '9a1f0c2e-0207-4b6a-9c11-5a1a00000207', kind: 'rule', category: 'food', strength: 'prefer', serves: [G_BODY], text: 'My maid can cook for me between 6am and 9pm: I text her what I want and when I want it by. Sometimes I like to cook myself, like breakfast. She or I can cook the next day’s meals ahead if needed.' },
  { id: '9a1f0c2e-0209-4b6a-9c11-5a1a00000209', kind: 'rule', category: 'university', course: 'CE 400', strength: 'must', serves: [G_GRADES], text: 'CE 400 (Grad Project I, Dr. Mutaz Al-Tarawneh): reports go through Turnitin in APA style; a late submission loses 40% within 24 hours and 60% within 48 hours, then it is a zero; attendance is 5% of the grade; the syllabus expects about 15 hours a week of project work outside class.' },
  { id: '9a1f0c2e-0210-4b6a-9c11-5a1a00000210', kind: 'rule', category: 'home', strength: 'prefer', serves: [G_GRADES], text: 'My grandmother’s home is about 15 minutes from the university and almost never has traffic, but none of my things are there. On a break between classes, if going home isn’t worth it (e.g. a 2-hour break: about 45 min uni→home and 30 min back leaves only 45 min at home), go to my grandmother’s to relax or eat a packed meal instead.' },
  { id: '9a1f0c2e-0211-4b6a-9c11-5a1a00000211', kind: 'rule', category: 'gym', strength: 'prefer', serves: [G_BODY], text: 'My gym membership covers several Oxygen Gym branches — Rigae, Mahboula and Sabah Al-Salem. Pick the branch for each session, at the emptiest time if possible.' },
  { id: '9a1f0c2e-0212-4b6a-9c11-5a1a00000212', kind: 'rule', category: 'gym', strength: 'prefer', serves: [G_BODY], text: 'Oxygen Gym is at its busiest from 2pm to 9pm; before 2pm is quieter. Weigh this against my 6pm preference, classes and bedtime with common sense.' },
  { id: '9a1f0c2e-0208-4b6a-9c11-5a1a00000208', kind: 'rule', category: 'travel', strength: 'must', serves: [G_GRADES, G_BODY], text: 'Never be late. When traffic or time forces changes, protect in this order: university first, then gym, then nutrition, then sleep.' }
];
// Settings that go with it (day_settings.prefs): maid hours, priority order, minutes early for class, parking.
const HIS_PREFS = { parking: 10, arrivalBuffer: 5, maidHours: { from: '06:00', to: '21:00' }, priorities: ['university', 'gym', 'nutrition', 'sleep'] };
export { HIS_MEMORY, HIS_PREFS, G_BODY, G_GRADES };
