import { HIS_MEMORY } from './his-memory.js';
// Sample data for the preview and tests. The timetable and deadlines are Salah's (from his own demo file);
// the training, body and food logs are made up but shaped exactly like PPL Coach and Nutrition Coach store them.
import FX from './sample-fixture.js';

const S = (id, date, day, startUTC, mins, entries) => ({ kind: 'session', key: String(id), body: { id, day, date: `${date}T${startUTC}:00.000Z`, _at: Date.parse(`${date}T${startUTC}:00.000Z`) + mins * 60000, entries } });
const sets = (...xs) => ({ sets: xs.map(([w, r]) => ({ w, r })) });
const withWarm = (o, w) => ({ ...o, warm: { w, r: 12 } });

const pplRows = [
  { kind: 'kv', key: 'meta', body: { v: { lastCompleted: 'pull' } } },
  { kind: 'kv', key: 'incs', body: { v: { 'incline-db-press': 2.5, 'lat-pulldown': 5, 'chest-supported-row': 5, 'seated-cable-pushdown': 7, 'cable-lateral-raise': 5 } } },
  S(1, '2026-09-27', 'push', '14:10', 72, { 'incline-db-press': withWarm(sets([27.5, 8], [25, 9], [22.5, 10], [22.5, 9]), 15), 'flat-machine-press': withWarm(sets([90, 5], [75, 8], [70, 8]), 45), 'cable-chest-fly': sets([40, 8], [30, 14], [30, 12]), 'machine-shoulder-press': sets([50, 6], [45, 8], [40, 9]), 'cable-lateral-raise': sets([30, 12], [25, 9], [20, 12], [15, 10]), 'oh-cable-tri-ext': sets([40, 7], [35, 7], [30, 7]), 'seated-cable-pushdown': sets([55, 15], [48, 12], [42, 12]) }),
  S(2, '2026-09-28', 'pull', '14:40', 69, { 'lat-pulldown': withWarm(sets([40, 9], [35, 10], [35, 9], [30, 12]), 20), 'chest-supported-row': sets([70, 5], [60, 8], [60, 8], [55, 9]), 'sa-cable-pulldown': sets([45, 15], [40, 12], [35, 12]), 'sa-rear-delt-fly': sets([10, 12], [10, 12], [10, 12], [5, 15]), 'btb-cable-curl': sets([35, 12], [30, 10], [27.5, 12]), 'cable-hammer-curl': sets([50, 9], [45, 6], [40, 9]) }),
  S(3, '2026-09-29', 'legs', '15:00', 88, { 'hack-squat': sets([100, 10], [90, 10], [85, 10], [80, 11]), 'rdl': sets([80, 8], [75, 8], [70, 8], [65, 9]), 'leg-press': sets([180, 12], [150, 12], [135, 12]), 'leg-extension': sets([60, 13], [50, 14], [45, 15]), 'seated-leg-curl': sets([50, 12], [45, 12], [40, 13], [40, 12]), 'standing-calf-raise': sets([70, 15], [65, 14], [60, 15], [55, 15]) }),
  S(4, '2026-10-03', 'push', '17:25', 67, { 'incline-db-press': withWarm(sets([30, 6], [27.5, 9], [25, 12], [25, 6]), 15), 'flat-machine-press': withWarm(sets([90, 5], [75, 8], [70, 8]), 45), 'cable-chest-fly': sets([40, 8], [30, 14], [30, 12]), 'machine-shoulder-press': sets([50, 6], [45, 8], [40, 9]), 'cable-lateral-raise': sets([30, 12], [25, 9], [20, 12], [15, 10]), 'oh-cable-tri-ext': sets([40, 7], [35, 7], [30, 7]), 'seated-cable-pushdown': sets([55, 15], [48, 12], [42, 12]) }),
  S(5, '2026-10-04', 'pull', '18:42', 71, { 'lat-pulldown': withWarm(sets([40, 10], [45, 5], [35, 11], [30, 12]), 20), 'chest-supported-row': sets([70, 5], [60, 8], [60, 8], [20, 14]), 'sa-cable-pulldown': sets([45, 15], [54.5, 12], [63.5, 9]), 'sa-rear-delt-fly': sets([10, 12], [10, 12], [10, 12], [5, 15]), 'btb-cable-curl': sets([35, 12], [35, 10], [27.5, 15]), 'cable-hammer-curl': sets([50, 9], [45, 6], [40, 9]) })
];

const nutritionRows = [
  { kind: 'profile', id: 'profile', body: { phase: 'cut', calories: 2100, slowStreak: 0, startBodyFat: null, phaseStartDate: '2026-10-03', flag: null, maintenanceObs: [], caloriesReason: 'The cut starts at 2100 kcal: your starting target, about 500 kcal below the initial 2600 kcal maintenance estimate.' } },
  { kind: 'plan_version', id: 'plan_version:1', body: { version: 1, base: true, calories: 2100, protein: 190, carbs: 215, fat: 65, phase: 'cut', why: { protein: 'Protein comes from the starting plan for now. It will be set at 2.2 g per kg once you have 4 weigh-ins in 7 days.' } } },
  { kind: 'measurement', id: 'm1', body: { date: '2026-10-01', weightKg: 86.4, bodyFatPct: null } },
  { kind: 'measurement', id: 'm2', body: { date: '2026-10-03', weightKg: 86.0, bodyFatPct: null } },
  { kind: 'measurement', id: 'm3', body: { date: '2026-10-04', weightKg: 85.7, bodyFatPct: null } },
  { kind: 'food_log', id: 'food_log:2026-10-03', body: { date: '2026-10-03', supps: { creatine: true, vitD3: true }, meals: {
    breakfast: { actual: [{ food: 'eggs', grams: 150 }, { food: 'greek_yogurt', grams: 150 }, { food: 'blueberries', grams: 100 }, { food: 'banana', grams: 120 }] },
    lunch: { actual: [{ food: 'chicken_breast', grams: 150 }, { food: 'rice', grams: 150 }, { food: 'broccoli', grams: 150 }, { food: 'spinach', grams: 100 }, { food: 'olive_oil', grams: 10 }] },
    preworkout: { actual: [{ food: 'greek_yogurt', grams: 150 }, { food: 'banana', grams: 120 }] },
    dinner: { actual: [{ food: 'lean_beef', grams: 95 }, { food: 'liver', grams: 25 }, { food: 'sweet_potato', grams: 190 }, { food: 'cucumber', grams: 100 }, { food: 'red_pepper', grams: 100 }] },
    evening: { actual: [{ food: 'milk', grams: 254 }, { food: 'whey', grams: 25 }, { food: 'strawberries', grams: 150 }, { food: 'walnuts', grams: 15 }] } } } },
  { kind: 'food_log', id: 'food_log:2026-10-04', body: { date: '2026-10-04', supps: {}, meals: {
    breakfast: { actual: [{ food: 'eggs', grams: 150 }, { food: 'greek_yogurt', grams: 150 }, { food: 'blueberries', grams: 100 }, { food: 'banana', grams: 120 }] },
    lunch: { actual: [{ custom: true, name: 'Chicken shawarma wrap', kcal: 620, protein: 32, carbs: 58, fat: 28 }] },
    preworkout: { actual: null }, dinner: { actual: null }, evening: { actual: null } } } }
].map(r => ({ deleted: false, ...r }));

// His goals, habits and rules, in his words (things he has told Claude). Places are sample pins.
const memory = HIS_MEMORY;
const settings = {
  places: { home: { lat: 29.0861, lng: 48.1302, label: 'Home (sample pin)' }, uni: { lat: 29.2987, lng: 48.0853, label: 'American University of the Middle East (sample pin)' }, gym_rigae: { lat: 29.1012, lng: 48.1105, label: 'Oxygen Gym — Rigae (sample pin)' } },
  prefs: { parking: 10, restDays: [], arrivalBuffer: 0 },   // the sample fixtures are timed without the class buffer; tests switch it on
  travel: { ...FX.travelRaw }
};
const plannerSettings = { ...FX.settings, class_leads: [60, 30], day_before_time: '20:00:00', event_kinds: ['gca', 'exam', 'quiz', 'assignment', 'hw', 'lab', 'prelab', 'project'] };

const SAMPLE = { classes: FX.classes, events: FX.events, plannerSettings, pplRows, nutritionRows, memory, settings };
export { SAMPLE };
