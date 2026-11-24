// Idempotent starter content: motivational quotes and fixed Iranian solar-calendar occasions (Mana can edit/delete/add in the app).
import fs from 'node:fs';
import path from 'node:path';
import { sys } from '../src/db.ts';
const dir = path.resolve(import.meta.dirname, '../content');
export async function seedContent() {
  const quotes = JSON.parse(fs.readFileSync(path.join(dir, 'quotes.json'), 'utf8')) as Record<string, string[]>;
  for (const [g, list] of Object.entries(quotes)) for (const t of list) await sys(`INSERT INTO quotes (age_group,text) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [g, t]);
  const facts = JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8')) as Record<string, { topic: string; title: string; body: string }[]>;
  for (const [g, list] of Object.entries(facts)) for (const f of list) await sys(`INSERT INTO facts (age_group,topic,title,body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [g, f.topic, f.title, f.body]);
  const lessons = JSON.parse(fs.readFileSync(path.join(dir, 'lessons.json'), 'utf8')) as Record<string, { title: string; body: string; question: string; options: string[]; correct: number }[]>;
  for (const [g, list] of Object.entries(lessons)) for (const [i, l] of list.entries()) await sys(`INSERT INTO lessons (age_group,position,title,body,question,options,correct) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [g, i, l.title, l.body, l.question, l.options, l.correct]);
  const [{ n }] = await sys<{ n: number }>(`SELECT count(*)::int n FROM occasions`);
  if (n === 0) for (const o of JSON.parse(fs.readFileSync(path.join(dir, 'occasions.json'), 'utf8')))
    await sys(`INSERT INTO occasions (title,kind,jm,jd,icon,audience) VALUES ($1,$2,$3,$4,$5,'all')`, [o.title, o.kind, o.jm, o.jd, o.icon]);
}
