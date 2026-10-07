/* Tests für die Progressionslogik. Ausführen mit: node gym/tests/progression.test.js */
'use strict';
const assert = require('assert');
const P = require('../progression.js');

const NOW = new Date('2026-03-10T10:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const session = (n, sets) => ({ date: daysAgo(n), sets: sets.map(([weight, reps, rpe]) => ({ weight, reps, rpe, done: true })) });
const barbell = { repMin: 8, repMax: 12, sets: 3, increment: 2.5, equipment: 'barbell' };
const opts = { unit: 'kg', now: NOW };

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (err) { console.error('✗ ' + name + '\n  ' + err.message); process.exitCode = 1; }
}

test('Keine Historie → Startempfehlung', () => {
  const r = P.recommend(barbell, [], opts);
  assert.strictEqual(r.status, 'start');
  assert.strictEqual(r.weight, null);
  assert.deepStrictEqual(r.repTargets, [8, 8, 8]);
});

test('Alle Sätze am Maximum → eine Stufe erhöhen, Wiederholungen zurück auf Minimum', () => {
  const r = P.recommend(barbell, [session(3, [[60, 12], [60, 12], [60, 12]])], opts);
  assert.strictEqual(r.status, 'increase');
  assert.strictEqual(r.weight, 62.5);
  assert.strictEqual(r.delta, 2.5);
  assert.deepStrictEqual(r.repTargets, [8, 8, 8]);
  assert.ok(r.how.includes('1,25 kg pro Seite'), 'Plattenhinweis fehlt: ' + r.how);
});

test('Deutlich über dem Maximum → zwei Stufen', () => {
  const r = P.recommend(barbell, [session(3, [[60, 14], [60, 14], [60, 15]])], opts);
  assert.strictEqual(r.status, 'increase');
  assert.strictEqual(r.weight, 65);
  assert.strictEqual(r.delta, 5);
});

test('Niedriger RPE am Maximum → zwei Stufen', () => {
  const r = P.recommend(barbell, [session(3, [[60, 12, 6.5], [60, 12, 7], [60, 12, 7]])], opts);
  assert.strictEqual(r.weight, 65);
});

test('Innerhalb des Bereichs → Gewicht halten, Wiederholungsziele +1', () => {
  const r = P.recommend(barbell, [session(3, [[60, 10], [60, 9], [60, 8]])], opts);
  assert.strictEqual(r.status, 'reps');
  assert.strictEqual(r.weight, 60);
  assert.deepStrictEqual(r.repTargets, [11, 10, 9]);
  assert.ok(r.how.includes('Noch 9 Wiederholungen'), r.how);
  assert.ok(Math.abs(r.progress - 3 / 12) < 1e-9, 'progress=' + r.progress);
});

test('Ein Satz unter Minimum (erstmals) → Gewicht halten und erneut versuchen', () => {
  const r = P.recommend(barbell, [session(3, [[60, 8], [60, 8], [60, 6]])], opts);
  assert.strictEqual(r.status, 'retry');
  assert.strictEqual(r.weight, 60);
});

test('Zweimal hintereinander unter Minimum → Deload um ca. 10 %', () => {
  const r = P.recommend(barbell, [
    session(3, [[60, 8], [60, 7], [60, 6]]),
    session(7, [[60, 8], [60, 7], [60, 7]]),
  ], opts);
  assert.strictEqual(r.status, 'deload');
  assert.strictEqual(r.weight, 55);
  assert.strictEqual(r.delta, -5);
});

test('Deload fällt immer unter das alte Gewicht, auch bei kleinen Gewichten', () => {
  const light = { ...barbell, increment: 2.5 };
  const r = P.recommend(light, [
    session(3, [[10, 6], [10, 6], [10, 5]]),
    session(7, [[10, 6], [10, 6], [10, 5]]),
  ], opts);
  assert.strictEqual(r.status, 'deload');
  assert.ok(r.weight < 10 && r.weight >= 0, 'weight=' + r.weight);
});

test('Fehlende Sätze zählen nicht als Erfolg', () => {
  const r = P.recommend(barbell, [session(3, [[60, 12], [60, 12]])], opts);
  assert.strictEqual(r.status, 'retry');
  assert.ok(r.reason.includes('2 von 3'), r.reason);
});

test('Plateau über vier Einheiten → Deload-Empfehlung', () => {
  const hist = [3, 7, 10, 14].map((d) => session(d, [[80, 9], [80, 9], [80, 8]]));
  const r = P.recommend(barbell, hist, opts);
  assert.strictEqual(r.status, 'plateau');
  assert.strictEqual(r.weight, 72.5);
});

test('Kein Plateau, wenn die Wiederholungen steigen', () => {
  const hist = [
    session(3, [[80, 11], [80, 10], [80, 10]]),
    session(7, [[80, 10], [80, 10], [80, 9]]),
    session(10, [[80, 10], [80, 9], [80, 9]]),
    session(14, [[80, 9], [80, 9], [80, 8]]),
  ];
  const r = P.recommend(barbell, hist, opts);
  assert.strictEqual(r.status, 'reps');
});

test('Lange Pause → leichterer Wiedereinstieg', () => {
  const r = P.recommend(barbell, [session(30, [[100, 12], [100, 12], [100, 12]])], opts);
  assert.strictEqual(r.status, 'comeback');
  assert.strictEqual(r.weight, 90);
  const r2 = P.recommend(barbell, [session(50, [[100, 12], [100, 12], [100, 12]])], opts);
  assert.strictEqual(r2.weight, 85);
});

test('Arbeitsgewicht = Gewicht mit den meisten Sätzen (Topsatz + Backoff)', () => {
  const r = P.recommend(barbell, [session(2, [[100, 5], [85, 12], [85, 12], [85, 12]])], opts);
  assert.strictEqual(r.previousWeight, 85);
  assert.strictEqual(r.status, 'increase');
  assert.strictEqual(r.weight, 87.5);
});

test('Aufwärm- und nicht erledigte Sätze werden ignoriert', () => {
  const s = { date: daysAgo(2), sets: [
    { weight: 40, reps: 10, warmup: true, done: true },
    { weight: 60, reps: 12, done: true }, { weight: 60, reps: 12, done: true }, { weight: 60, reps: 12, done: true },
    { weight: 60, reps: 3, done: false },
  ] };
  const r = P.recommend(barbell, [s], opts);
  assert.strictEqual(r.status, 'increase');
  assert.strictEqual(r.weight, 62.5);
});

test('Körpergewicht ohne Zusatzgewicht → Vorschlag: schwieriger machen', () => {
  const bw = { repMin: 6, repMax: 10, sets: 3, increment: 0, equipment: 'bodyweight' };
  const r = P.recommend(bw, [session(2, [[0, 10], [0, 10], [0, 10]])], opts);
  assert.strictEqual(r.status, 'increase');
  assert.strictEqual(r.delta, 0);
  assert.ok(r.how.includes('Zusatzgewicht'), r.how);
});

test('Kurzhanteln runden auf die Hantelstufe', () => {
  const db = { repMin: 8, repMax: 12, sets: 3, increment: 2, equipment: 'dumbbell' };
  const r = P.recommend(db, [session(2, [[14, 12], [14, 12], [14, 12]])], opts);
  assert.strictEqual(r.weight, 16);
  assert.ok(r.how.includes('pro Hand'), r.how);
});

test('Historie in beliebiger Reihenfolge wird korrekt sortiert', () => {
  const r = P.recommend(barbell, [
    session(10, [[60, 12], [60, 12], [60, 12]]),
    session(3, [[62.5, 9], [62.5, 8], [62.5, 8]]),
  ], opts);
  assert.strictEqual(r.status, 'reps');
  assert.strictEqual(r.weight, 62.5);
});

test('Trend wird aus den letzten Einheiten berechnet', () => {
  const up = P.recommend(barbell, [
    session(2, [[70, 10], [70, 10], [70, 10]]),
    session(6, [[60, 10], [60, 10], [60, 10]]),
    session(10, [[60, 10], [60, 10], [60, 10]]),
    session(14, [[60, 10], [60, 10], [60, 10]]),
  ], opts);
  assert.strictEqual(up.trend, 'up');
});

test('e1RM nach Epley', () => {
  assert.strictEqual(P.e1rm(100, 1), 100);
  assert.strictEqual(P.e1rm(100, 10), 100 * (1 + 10 / 30));
  assert.strictEqual(P.e1rm(100, 0), 0);
});

test('Aufwärmsätze liegen unter dem Arbeitsgewicht', () => {
  const plan = P.warmupPlan(barbell, 100);
  assert.deepStrictEqual(plan.map((p) => p.weight), [40, 60, 80]);
  assert.ok(plan.every((p) => p.weight < 100));
  assert.deepStrictEqual(P.warmupPlan(barbell, 0), []);
  const light = P.warmupPlan(barbell, 30);
  assert.deepStrictEqual(light.map((p) => p.weight), [15, 22.5]);
});

console.log('\n' + passed + ' Tests bestanden' + (process.exitCode ? ', es gab Fehler' : ''));
