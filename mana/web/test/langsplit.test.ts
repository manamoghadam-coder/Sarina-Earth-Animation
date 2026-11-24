import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLang } from '../src/langsplit.ts';
test('splits Persian and English runs', () => {
  const r = splitLang('به سیب می‌گویند Apple. بگو: Apple. یک Apple قرمز.');
  assert.deepEqual(r.filter((x) => x.lang === 'en-US').map((x) => x.text), ['Apple.', 'Apple.', 'Apple']);
  assert.ok(r.every((x) => x.text.trim()));
});
test('English sentence stays together', () => {
  const r = splitLang('جمله‌ی نمونه: My goal is to read one book every month. تمام.');
  assert.equal(r.find((x) => x.lang === 'en-US')!.text, 'My goal is to read one book every month.');
});
test('pure Persian is one run', () => { assert.equal(splitLang('سلام دوست من').length, 1); });
test('digits-only English-free text has no English run', () => { assert.equal(splitLang('۱۲۳ و 456').filter((x) => x.lang === 'en-US').length, 0); });
