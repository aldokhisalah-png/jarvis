// Run the scheduler on a saved copy of the real data and print each day.
import fs from 'node:fs';
import * as S from '../src/scheduler.js';
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const from = process.argv[3] || '2026-10-09', n = +(process.argv[4] || 7);
const dowDrive = {}; // per weekday profile
const drive = (a, b, t) => S.makeDrive({ profile: j.travel.profiles[0].data, freeFlow: j.travel })(a, b, t);
const known = ['home', 'uni', 'gym_rigae', 'gym_mahboula', 'gym_sabah'];
const r = S.planDays({ from, n, today: '2026-10-08', classes: j.classes, events: j.events, ppl: S.pplFromRows(j.ppl), nutrition: S.nutritionFromRows(j.nut),
  drive, known, changes: {}, prevBedAbs: -60 });
for (const d of r.days) {
  console.log(`\n=== ${S.dlong(d.date)} — gym: ${d.gym ? d.gym.at + ' ' + S.t12(d.gym.start) + ' (' + d.gym.crowd + ')' : '—'} · walk ${d.walk} · bed ${S.t12(d.bed)}`);
  for (const b of d.blocks) console.log(`${S.t12(b.start).padStart(7)}${b.end !== b.start ? '–' + S.t12(b.end).padEnd(7) : '        '} ${b.check ? '☐' : ' '} [${b.type}] ${b.title}${b.walk ? ` 🚶${b.walk}` : ''}${b.loc && b.type !== 'drive' ? ' @' + b.loc : ''} — ${b.detail || ''}${b.bring && b.bring.length ? ' | BRING: ' + b.bring.join('; ') : ''}`);
  for (const w of d.warnings) console.log('  ! ' + w);
  for (const w of d.notes) console.log('  · ' + w);
}
const m = r.days.flatMap(d => d.blocks).find(b => b.type === 'maid'); if (m) console.log('\nMAID MESSAGE:\n' + m.message);
