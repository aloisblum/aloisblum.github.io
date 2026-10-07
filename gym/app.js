/* ===== Gym Tracker – App-Logik (Vanilla JS, keine Abhängigkeiten) ===== */
(function () {
'use strict';

const P = window.Progression;
const STORAGE_KEY = 'gymtracker.v1';
const APP_VERSION = '1.0.0';

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmtNum = (n, digits) => { if (n == null || !Number.isFinite(n)) return '–'; const d = digits == null ? 2 : digits; return (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('de-DE', { maximumFractionDigits: d }); };
const fmtW = (n) => `${fmtNum(n)} ${state.profile.unit}`;
const inputVal = (n) => (n == null || n === '' ? '' : String(n).replace('.', ','));
const fmtDate = (iso, opts) => new Date(iso).toLocaleDateString('de-DE', opts || { weekday: 'short', day: '2-digit', month: 'short' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDuration = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`; };
const fmtMinutes = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const icon = (name, cls) => `<svg class="${cls || ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- Konstanten ---------- */
const MUSCLES = ['Brust', 'Rücken', 'Schultern', 'Beine', 'Arme', 'Core', 'Ganzkörper', 'Sonstiges'];
const EQUIPMENT = {
  barbell:    { label: 'Langhantel',    inc: { kg: 2.5, lb: 5 } },
  dumbbell:   { label: 'Kurzhantel',    inc: { kg: 2,   lb: 5 } },
  machine:    { label: 'Maschine',      inc: { kg: 5,   lb: 10 } },
  cable:      { label: 'Kabelzug',      inc: { kg: 2.5, lb: 5 } },
  bodyweight: { label: 'Körpergewicht', inc: { kg: 2.5, lb: 5 } },
  other:      { label: 'Sonstiges',     inc: { kg: 2.5, lb: 5 } },
};
const eqLabel = (key) => (EQUIPMENT[key] || EQUIPMENT.other).label;
const defaultIncrement = (equipment, unit) => (EQUIPMENT[equipment] || EQUIPMENT.other).inc[unit || 'kg'];

const STARTER_EXERCISES = [
  ['Kniebeuge', 'Beine', 'barbell', 5, 8, 3, 180],
  ['Bankdrücken', 'Brust', 'barbell', 6, 10, 3, 150],
  ['Kreuzheben', 'Rücken', 'barbell', 3, 6, 3, 180],
  ['Schulterdrücken', 'Schultern', 'barbell', 6, 10, 3, 120],
  ['Langhantelrudern', 'Rücken', 'barbell', 8, 12, 3, 120],
  ['Rumänisches Kreuzheben', 'Beine', 'barbell', 8, 12, 3, 120],
  ['Klimmzüge', 'Rücken', 'bodyweight', 6, 10, 3, 120],
  ['Dips', 'Brust', 'bodyweight', 8, 12, 3, 120],
  ['Kurzhantel-Schrägbankdrücken', 'Brust', 'dumbbell', 8, 12, 3, 120],
  ['Beinpresse', 'Beine', 'machine', 10, 15, 3, 120],
  ['Beinbeuger', 'Beine', 'machine', 10, 15, 3, 90],
  ['Wadenheben', 'Beine', 'machine', 12, 15, 3, 60],
  ['Latzug', 'Rücken', 'cable', 10, 12, 3, 90],
  ['Seitheben', 'Schultern', 'dumbbell', 12, 15, 3, 60],
  ['Bizepscurls', 'Arme', 'dumbbell', 10, 12, 3, 60],
  ['Trizepsdrücken am Kabel', 'Arme', 'cable', 10, 15, 3, 60],
  ['Crunch am Kabel', 'Core', 'cable', 12, 15, 3, 60],
];
const STARTER_ROUTINES = [
  ['Push', ['Bankdrücken', 'Schulterdrücken', 'Kurzhantel-Schrägbankdrücken', 'Seitheben', 'Trizepsdrücken am Kabel']],
  ['Pull', ['Kreuzheben', 'Klimmzüge', 'Langhantelrudern', 'Latzug', 'Bizepscurls']],
  ['Beine', ['Kniebeuge', 'Rumänisches Kreuzheben', 'Beinpresse', 'Beinbeuger', 'Wadenheben']],
];
const TREND_ICON = { up: 'trend-up', down: 'trend-down', flat: 'trend-flat' };
const TREND_LABEL = { up: 'Aufwärts', down: 'Abwärts', flat: 'Stabil', none: '–' };
const STATUS_ICON = { start: 'play', increase: 'arrow-up', reps: 'trend-up', retry: 'timer', deload: 'arrow-down', plateau: 'info', comeback: 'history' };

/* ---------- Zustand & Speicherung ---------- */
function defaultState() {
  return {
    version: 1,
    profile: { name: '', unit: 'kg', restSeconds: 90, theme: 'dark', trackRpe: false },
    exercises: [],
    routines: [],
    workouts: [],
    active: null,
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return sanitize(JSON.parse(raw));
  } catch (err) {
    console.warn('Konnte gespeicherte Daten nicht lesen', err);
    return defaultState();
  }
}
function sanitize(data) {
  const base = defaultState();
  const s = Object.assign(base, data || {});
  s.profile = Object.assign(defaultState().profile, (data && data.profile) || {});
  if (!['kg', 'lb'].includes(s.profile.unit)) s.profile.unit = 'kg';
  if (!['dark', 'light'].includes(s.profile.theme)) s.profile.theme = 'dark';
  s.exercises = Array.isArray(s.exercises) ? s.exercises.filter((e) => e && e.id && e.name) : [];
  s.routines = Array.isArray(s.routines) ? s.routines.filter((r) => r && r.id && r.name) : [];
  s.workouts = Array.isArray(s.workouts) ? s.workouts.filter((w) => w && w.id && Array.isArray(w.entries)) : [];
  if (s.active && !Array.isArray(s.active.entries)) s.active = null;
  return s;
}
let state = load();
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { toast('Speichern fehlgeschlagen – Speicher voll?', 'danger'); }
}

const ui = {
  tab: 'train',
  exerciseId: null,
  query: '',
  muscle: '',
  openWorkouts: new Set(),
  chartMetric: {},
  menuEntry: null,
  picker: { selected: [], query: '', muscle: '' },
};

/* ---------- Datenzugriff ---------- */
const exById = (id) => state.exercises.find((e) => e.id === id);
const routineById = (id) => state.routines.find((r) => r.id === id);
const entryName = (entry) => { const ex = exById(entry.exerciseId); return ex ? ex.name : entry.exerciseName || 'Gelöschte Übung'; };

function sessionsFor(exerciseId) {
  const out = [];
  state.workouts.forEach((w) => {
    w.entries.forEach((en) => {
      if (en.exerciseId === exerciseId) out.push({ date: w.finishedAt || w.startedAt, workoutId: w.id, sets: en.sets });
    });
  });
  return out.sort((a, b) => new Date(b.date) - new Date(a.date));
}
const recommendationFor = (ex, sessions) => P.recommend(ex, sessions || sessionsFor(ex.id), { unit: state.profile.unit });

function workoutStats(w) {
  let sets = 0, volume = 0, reps = 0;
  w.entries.forEach((en) => en.sets.forEach((s) => {
    if (s.done === false || s.warmup) return;
    sets++;
    volume += (num(s.weight) || 0) * (num(s.reps) || 0);
    reps += num(s.reps) || 0;
  }));
  const duration = w.finishedAt ? new Date(w.finishedAt) - new Date(w.startedAt) : Date.now() - new Date(w.startedAt);
  return { sets, volume, reps, exercises: w.entries.length, duration };
}

function weekStats(offsetWeeks) {
  const start = startOfWeek(new Date());
  start.setDate(start.getDate() - 7 * (offsetWeeks || 0));
  const end = new Date(start); end.setDate(end.getDate() + 7);
  const ws = state.workouts.filter((w) => { const d = new Date(w.finishedAt || w.startedAt); return d >= start && d < end; });
  return ws.reduce((acc, w) => { const s = workoutStats(w); acc.count++; acc.sets += s.sets; acc.volume += s.volume; return acc; }, { count: 0, sets: 0, volume: 0 });
}

function weekStreak() {
  let streak = 0;
  let cursor = startOfWeek(new Date());
  const keys = new Set(state.workouts.map((w) => startOfWeek(w.finishedAt || w.startedAt).getTime()));
  if (!keys.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 7); // laufende Woche zählt erst, wenn trainiert wurde
  while (keys.has(cursor.getTime())) { streak++; cursor.setDate(cursor.getDate() - 7); }
  return streak;
}

function bestE1rm(sessions) {
  let best = 0;
  sessions.forEach((s) => (s.sets || []).forEach((set) => {
    if (set.warmup || set.done === false) return;
    best = Math.max(best, P.e1rm(num(set.weight) || 0, num(set.reps) || 0));
  }));
  return best;
}

/* ---------- Toast ---------- */
function toast(msg, tone) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast tone-${tone || 'info'}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- Modal ---------- */
let modal = null;
function openModal(def) { modal = def; renderModal(); }
function closeModal() { modal = null; renderModal(); }
function refreshModal() {
  if (!modal) return;
  const body = $('#modal-body'); if (body) body.innerHTML = modal.body();
  const foot = $('#modal-foot'); if (foot && modal.foot) foot.innerHTML = modal.foot();
}
function renderModal() {
  const root = $('#modal-root');
  if (!modal) { root.innerHTML = ''; document.body.classList.remove('modal-open'); return; }
  root.innerHTML = `
    <div class="modal-backdrop" data-action="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">${esc(modal.title)}</h2>
          <button class="btn btn-icon" data-action="modal-close" aria-label="Schließen">${icon('x')}</button>
        </div>
        <div class="modal-body" id="modal-body">${modal.body()}</div>
        ${modal.foot ? `<div class="modal-foot" id="modal-foot">${modal.foot()}</div>` : ''}
      </div>
    </div>`;
  document.body.classList.add('modal-open');
  if (modal.onMount) modal.onMount();
}
function confirmDialog({ title, text, okLabel, danger, onOk }) {
  openModal({
    title,
    body: () => `<p class="modal-text">${esc(text)}</p>`,
    foot: () => `<button class="btn btn-ghost" data-action="modal-close">Abbrechen</button>
                 <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm-ok">${esc(okLabel || 'OK')}</button>`,
    onOk,
  });
}
function promptDialog({ title, label, value, placeholder, okLabel, onOk }) {
  openModal({
    title,
    body: () => `<form data-form="prompt" id="prompt-form"><div class="field"><label for="prompt-input">${esc(label || '')}</label>
      <input class="input" id="prompt-input" name="value" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}" autocomplete="off"></div></form>`,
    foot: () => `<button class="btn btn-ghost" data-action="modal-close">Abbrechen</button>
                 <button class="btn btn-primary" type="submit" form="prompt-form">${esc(okLabel || 'Speichern')}</button>`,
    onMount: () => { const i = $('#prompt-input'); if (i) { i.focus(); i.select(); } },
    onOk,
  });
}

/* ---------- Ruhe-Timer ---------- */
const rest = { endsAt: null, total: 0, timer: null, audio: null };
function ensureAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!rest.audio) rest.audio = new Ctx();
    if (rest.audio.state === 'suspended') rest.audio.resume();
  } catch { /* kein Audio verfügbar */ }
}
function beep() {
  try {
    const ctx = rest.audio;
    if (ctx) {
      [0, 0.22, 0.44].forEach((t) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        o.connect(g); g.connect(ctx.destination);
        const start = ctx.currentTime + t;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        o.start(start); o.stop(start + 0.2);
      });
    }
  } catch { /* ignorieren */ }
  if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200, 100, 400]); } catch { /* ignorieren */ } }
}
function startRest(seconds) {
  if (!seconds || seconds <= 0) return;
  rest.total = seconds;
  rest.endsAt = Date.now() + seconds * 1000;
  clearInterval(rest.timer);
  rest.timer = setInterval(tickRest, 250);
  mountRest();
  tickRest();
}
function stopRest(silent) {
  clearInterval(rest.timer);
  rest.timer = null; rest.endsAt = null;
  const el = $('#rest-timer'); el.hidden = true; el.innerHTML = '';
  if (!silent) { beep(); toast('Pause vorbei – nächster Satz!', 'success'); }
}
function adjustRest(delta) {
  if (!rest.endsAt) return;
  rest.endsAt += delta * 1000;
  rest.total = Math.max(5, rest.total + delta);
  if (rest.endsAt - Date.now() < 0) rest.endsAt = Date.now() + 1000;
  tickRest();
}
function mountRest() {
  const el = $('#rest-timer');
  el.hidden = false;
  el.innerHTML = `
    <div>
      <div class="rest-label">Pause</div>
      <div class="rest-time" id="rest-time">0:00</div>
    </div>
    <div class="grow"><div class="bar"><i id="rest-bar" style="width:100%"></i></div></div>
    <button class="btn btn-sm btn-ghost" data-action="rest-adjust" data-delta="-15">−15</button>
    <button class="btn btn-sm btn-ghost" data-action="rest-adjust" data-delta="30">+30</button>
    <button class="btn btn-sm btn-primary" data-action="rest-skip">Weiter</button>`;
}
function tickRest() {
  if (!rest.endsAt) return;
  const leftMs = rest.endsAt - Date.now();
  const left = Math.max(0, Math.ceil(leftMs / 1000));
  const t = $('#rest-time'); if (t) t.textContent = `${Math.floor(left / 60)}:${pad2(left % 60)}`;
  const b = $('#rest-bar'); if (b) b.style.width = `${Math.max(0, Math.min(100, (leftMs / (rest.total * 1000)) * 100))}%`;
  if (leftMs <= 0) stopRest(false);
}

/* ---------- Trainingsuhr ---------- */
let clockTimer = null;
function syncClock() {
  clearInterval(clockTimer);
  if (!state.active) return;
  clockTimer = setInterval(() => {
    const el = $('#workout-clock');
    if (el) el.textContent = fmtDuration(Date.now() - new Date(state.active.startedAt));
  }, 1000);
}

/* ---------- Übungen ---------- */
function createExercise(data) {
  const ex = {
    id: uid(),
    name: data.name.trim(),
    muscle: MUSCLES.includes(data.muscle) ? data.muscle : 'Sonstiges',
    equipment: EQUIPMENT[data.equipment] ? data.equipment : 'other',
    repMin: Math.max(1, Math.round(num(data.repMin) || 8)),
    repMax: Math.max(1, Math.round(num(data.repMax) || 12)),
    sets: Math.max(1, Math.round(num(data.sets) || 3)),
    increment: Math.max(0, num(data.increment) != null ? num(data.increment) : defaultIncrement(data.equipment, state.profile.unit)),
    restSeconds: num(data.restSeconds) != null ? Math.max(0, Math.round(num(data.restSeconds))) : null,
    notes: (data.notes || '').trim(),
    createdAt: new Date().toISOString(),
  };
  if (ex.repMax < ex.repMin) { const t = ex.repMin; ex.repMin = ex.repMax; ex.repMax = t; }
  return ex;
}
function loadStarter() {
  const byName = new Map(state.exercises.map((e) => [e.name.toLowerCase(), e]));
  let added = 0;
  STARTER_EXERCISES.forEach(([name, muscle, equipment, repMin, repMax, sets, restSeconds]) => {
    if (byName.has(name.toLowerCase())) return;
    const ex = createExercise({ name, muscle, equipment, repMin, repMax, sets, restSeconds, increment: defaultIncrement(equipment, state.profile.unit) });
    if (equipment === 'bodyweight') ex.increment = 0;
    state.exercises.push(ex); byName.set(name.toLowerCase(), ex); added++;
  });
  const routineNames = new Set(state.routines.map((r) => r.name.toLowerCase()));
  STARTER_ROUTINES.forEach(([name, names]) => {
    if (routineNames.has(name.toLowerCase())) return;
    const ids = names.map((n) => byName.get(n.toLowerCase())).filter(Boolean).map((e) => e.id);
    if (ids.length) state.routines.push({ id: uid(), name, exerciseIds: ids, createdAt: new Date().toISOString() });
  });
  save();
  toast(added ? `${plural(added, 'Übung', 'Übungen')} und 3 Pläne hinzugefügt` : 'Starter-Set ist bereits geladen', 'success');
  render();
}

/* ---------- Training ---------- */
function makeSet(rec, index, prev) {
  let weight = '';
  if (rec.weight != null) weight = rec.weight;
  else if (prev && prev.weight !== '') weight = prev.weight;
  const reps = rec.repTargets[index] != null ? rec.repTargets[index] : rec.repMin;
  return { id: uid(), weight, reps, rpe: '', done: false, warmup: false };
}
function addEntry(exerciseId) {
  const ex = exById(exerciseId);
  if (!ex || !state.active) return;
  const rec = recommendationFor(ex);
  const entry = { id: uid(), exerciseId, exerciseName: ex.name, note: '', sets: [] };
  for (let i = 0; i < rec.targetSets; i++) entry.sets.push(makeSet(rec, i));
  state.active.entries.push(entry);
}
function startWorkout({ name, exerciseIds, routineId }) {
  if (state.active) return;
  state.active = { id: uid(), name: name || 'Training', startedAt: new Date().toISOString(), routineId: routineId || null, entries: [] };
  (exerciseIds || []).forEach(addEntry);
  save();
  ui.tab = 'train';
  render();
  syncClock();
  if (!exerciseIds || !exerciseIds.length) openPicker();
}
function findSet(entryId, setId) {
  const entry = state.active && state.active.entries.find((e) => e.id === entryId);
  const set = entry && entry.sets.find((s) => s.id === setId);
  return { entry, set };
}
function restFor(entry) {
  const ex = exById(entry.exerciseId);
  if (ex && ex.restSeconds != null) return ex.restSeconds;
  return state.profile.restSeconds;
}
function toggleSet(entryId, setId) {
  const { entry, set } = findSet(entryId, setId);
  if (!set) return;
  if (!set.done) {
    const ex = exById(entry.exerciseId);
    const reps = num(set.reps); const weight = num(set.weight);
    if (reps == null || reps <= 0) { toast('Bitte Wiederholungen eintragen', 'warning'); return; }
    if (weight == null) {
      if (ex && ex.equipment === 'bodyweight') set.weight = 0;
      else { toast('Bitte Gewicht eintragen', 'warning'); return; }
    }
    set.done = true;
    ensureAudio();
    if (!set.warmup) startRest(restFor(entry)); else startRest(Math.min(60, restFor(entry)));
  } else {
    set.done = false;
  }
  save(); render();
}
function addSet(entryId, warmup) {
  const entry = state.active.entries.find((e) => e.id === entryId);
  if (!entry) return;
  const ex = exById(entry.exerciseId);
  const rec = ex ? recommendationFor(ex) : { repTargets: [], repMin: 8, weight: null };
  const working = entry.sets.filter((s) => !s.warmup);
  const prev = entry.sets[entry.sets.length - 1];
  if (warmup) {
    const workWeight = num(working[0] && working[0].weight) != null ? num(working[0].weight) : rec.weight;
    const plan = ex ? P.warmupPlan(ex, workWeight) : [];
    if (!plan.length) { toast('Trage zuerst ein Arbeitsgewicht ein', 'warning'); return; }
    const existing = entry.sets.filter((s) => s.warmup).length;
    if (existing) { toast('Aufwärmsätze sind bereits eingetragen', 'info'); return; }
    const sets = plan.map((p) => ({ id: uid(), weight: p.weight, reps: p.reps, rpe: '', done: false, warmup: true }));
    entry.sets.unshift(...sets);
    toast(`${plan.length} Aufwärmsätze hinzugefügt`, 'success');
  } else {
    const s = makeSet(rec, working.length, prev);
    if (prev && !prev.warmup) { s.weight = prev.weight; if (rec.repTargets[working.length] == null) s.reps = prev.reps; }
    entry.sets.push(s);
  }
  save(); render();
}
function removeSet(entryId, setId) {
  const entry = state.active.entries.find((e) => e.id === entryId);
  if (!entry) return;
  entry.sets = entry.sets.filter((s) => s.id !== setId);
  save(); render();
}
function removeEntry(entryId) {
  state.active.entries = state.active.entries.filter((e) => e.id !== entryId);
  save(); render();
}
function moveEntry(entryId, dir) {
  const list = state.active.entries;
  const i = list.findIndex((e) => e.id === entryId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  save(); render();
}
function discardWorkout() {
  confirmDialog({
    title: 'Training verwerfen?',
    text: 'Alle Eingaben dieses Trainings gehen verloren.',
    okLabel: 'Verwerfen', danger: true,
    onOk: () => { state.active = null; stopRest(true); save(); closeModal(); render(); },
  });
}
function finishWorkout() {
  const a = state.active;
  if (!a) return;
  const entries = a.entries.map((en) => ({
    id: en.id, exerciseId: en.exerciseId, exerciseName: entryName(en), note: (en.note || '').trim(),
    sets: en.sets.filter((s) => s.done).map((s) => ({ weight: num(s.weight) || 0, reps: num(s.reps) || 0, rpe: num(s.rpe), warmup: !!s.warmup, done: true })),
  })).filter((en) => en.sets.length);
  if (!entries.length) { discardWorkout(); return; }

  // Rekorde vor dem Speichern ermitteln
  const prs = [];
  entries.forEach((en) => {
    const prevSessions = sessionsFor(en.exerciseId);
    if (!prevSessions.length) return;
    const before = bestE1rm(prevSessions);
    const nowBest = Math.max(0, ...en.sets.filter((s) => !s.warmup).map((s) => P.e1rm(s.weight, s.reps)));
    if (nowBest > before + 1e-9 && nowBest > 0) prs.push({ name: en.exerciseName, e1rm: nowBest, before });
  });

  const workout = { id: a.id, name: a.name, startedAt: a.startedAt, finishedAt: new Date().toISOString(), routineId: a.routineId, entries };
  state.workouts.unshift(workout);
  state.active = null;
  stopRest(true);
  clearInterval(clockTimer);
  save();
  render();
  showSummary(workout, prs);
}
function showSummary(workout, prs) {
  const st = workoutStats(workout);
  const next = workout.entries.map((en) => {
    const ex = exById(en.exerciseId);
    if (!ex) return null;
    const rec = recommendationFor(ex);
    return { ex, rec };
  }).filter(Boolean);
  openModal({
    title: 'Training beendet 💪',
    body: () => `
      <div class="tiles mb">
        <div class="tile"><div class="tile-label">Dauer</div><div class="tile-value">${fmtMinutes(st.duration)}</div></div>
        <div class="tile"><div class="tile-label">Volumen</div><div class="tile-value">${fmtNum(st.volume, 0)}<span class="unit">${esc(state.profile.unit)}</span></div></div>
        <div class="tile"><div class="tile-label">Sätze</div><div class="tile-value">${st.sets}</div></div>
        <div class="tile"><div class="tile-label">Übungen</div><div class="tile-value">${st.exercises}</div></div>
      </div>
      ${prs.length ? `<div class="label">Neue Rekorde</div><div class="list pr-list mb">${prs.map((p) => `
        <div class="item"><div class="avatar tone-warning" style="color:var(--warning)">${icon('trophy')}</div>
          <div class="grow"><div class="item-title">${esc(p.name)}</div><div class="item-sub">Geschätztes 1RM: ${fmtW(p.e1rm)} (vorher ${fmtW(p.before)})</div></div></div>`).join('')}</div>` : ''}
      <div class="label">Nächstes Mal</div>
      <div class="list">${next.map(({ ex, rec }) => `
        <div class="rec compact tone-${rec.tone}">
          <div class="rec-icon">${icon(STATUS_ICON[rec.status] || 'info')}</div>
          <div class="rec-body">
            <div class="rec-label">${esc(ex.name)} · ${esc(rec.label)}</div>
            <div class="rec-main">${rec.weight != null ? fmtW(rec.weight) : '–'} × ${rec.repTargets.join('/')}${rec.delta ? `<span class="delta">${rec.delta > 0 ? '+' : ''}${fmtNum(rec.delta)} ${esc(state.profile.unit)}</span>` : ''}</div>
            <div class="rec-text">${esc(rec.reason)}</div>
          </div>
        </div>`).join('')}</div>`,
    foot: () => `<button class="btn btn-primary" data-action="modal-close">Fertig</button>`,
  });
}
function repeatWorkout(workoutId) {
  const w = state.workouts.find((x) => x.id === workoutId);
  if (!w) return;
  const ids = w.entries.map((en) => en.exerciseId).filter((id) => exById(id));
  if (!ids.length) { toast('Die Übungen dieses Trainings existieren nicht mehr', 'warning'); return; }
  startWorkout({ name: w.name, exerciseIds: ids, routineId: w.routineId });
}

/* ---------- Übungsauswahl (Picker) ---------- */
function openPicker() {
  ui.picker = { selected: [], query: '', muscle: '' };
  openModal({
    title: 'Übungen auswählen',
    body: () => `
      <div class="search mb"><svg><use href="#i-search"/></svg><input class="input" id="picker-search" placeholder="Übung suchen …" value="${esc(ui.picker.query)}" autocomplete="off" data-field="picker-query"></div>
      <div class="chips scroll mb">${['', ...MUSCLES].map((m) => `<button class="chip ${ui.picker.muscle === m ? 'active' : ''}" data-action="picker-muscle" data-muscle="${esc(m)}">${m || 'Alle'}</button>`).join('')}</div>
      <div id="picker-list">${pickerList()}</div>`,
    foot: () => `
      <button class="btn btn-ghost" data-action="picker-new">${icon('plus')} Neue Übung</button>
      <button class="btn btn-primary" data-action="picker-confirm" ${ui.picker.selected.length ? '' : 'disabled'}>${ui.picker.selected.length ? `${ui.picker.selected.length} hinzufügen` : 'Auswählen'}</button>`,
  });
}
function pickerList() {
  const q = ui.picker.query.trim().toLowerCase();
  const list = state.exercises
    .filter((e) => (!ui.picker.muscle || e.muscle === ui.picker.muscle) && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!state.exercises.length) return `<div class="empty"><h3>Noch keine Übungen</h3><p>Lege im Profil Übungen an oder lade das Starter-Set.</p><button class="btn btn-primary" data-action="load-starter">Starter-Set laden</button></div>`;
  if (!list.length) return `<div class="empty small">Keine Übung gefunden.</div>`;
  const inWorkout = new Set(state.active ? state.active.entries.map((e) => e.exerciseId) : []);
  return `<div class="list">${list.map((e) => {
    const sel = ui.picker.selected.includes(e.id);
    const last = sessionsFor(e.id)[0];
    const sum = last ? P.summarize(last) : null;
    return `<button class="item ${sel ? 'selected' : ''}" data-action="picker-toggle" data-id="${e.id}">
      <div class="checkbox">${icon('check')}</div>
      <div class="grow"><div class="item-title">${esc(e.name)}${inWorkout.has(e.id) ? ' <span class="badge">im Training</span>' : ''}</div>
      <div class="item-sub">${esc(e.muscle)} · ${esc(eqLabel(e.equipment))}${sum ? ` · zuletzt ${fmtW(sum.workWeight)} × ${sum.workSets.map((s) => s.reps).join('/')}` : ''}</div></div>
    </button>`;
  }).join('')}</div>`;
}

/* ---------- Übungsformular ---------- */
function openExerciseForm(exercise, afterSave) {
  const ex = exercise || null;
  const unit = state.profile.unit;
  const eqOptions = Object.keys(EQUIPMENT).map((k) => `<option value="${k}" ${ex && ex.equipment === k ? 'selected' : ''}>${EQUIPMENT[k].label}</option>`).join('');
  const muscleOptions = MUSCLES.map((m) => `<option value="${m}" ${ex && ex.muscle === m ? 'selected' : ''}>${m}</option>`).join('');
  openModal({
    title: ex ? 'Übung bearbeiten' : 'Neue Übung',
    body: () => `
      <form data-form="exercise" id="exercise-form" data-id="${ex ? ex.id : ''}" data-after="${afterSave ? '1' : ''}">
        <div class="field"><label for="ex-name">Name</label><input class="input" id="ex-name" name="name" required maxlength="60" placeholder="z. B. Bankdrücken" value="${esc(ex ? ex.name : '')}" autocomplete="off"></div>
        <div class="row">
          <div class="field"><label for="ex-muscle">Muskelgruppe</label><select class="input" id="ex-muscle" name="muscle">${muscleOptions}</select></div>
          <div class="field"><label for="ex-eq">Gerät</label><select class="input" id="ex-eq" name="equipment" data-field="ex-equipment">${eqOptions}</select></div>
        </div>
        <div class="row-3">
          <div class="field"><label for="ex-sets">Sätze</label><input class="input" id="ex-sets" name="sets" type="number" inputmode="numeric" min="1" max="10" value="${ex ? ex.sets : 3}"></div>
          <div class="field"><label for="ex-repmin">Wdh. min</label><input class="input" id="ex-repmin" name="repMin" type="number" inputmode="numeric" min="1" max="50" value="${ex ? ex.repMin : 8}"></div>
          <div class="field"><label for="ex-repmax">Wdh. max</label><input class="input" id="ex-repmax" name="repMax" type="number" inputmode="numeric" min="1" max="50" value="${ex ? ex.repMax : 12}"></div>
        </div>
        <div class="row">
          <div class="field"><label for="ex-inc">Gewichtsstufe (${esc(unit)})</label><input class="input" id="ex-inc" name="increment" inputmode="decimal" value="${inputVal(ex ? ex.increment : defaultIncrement('barbell', unit))}" data-touched="${ex ? '1' : ''}" data-field="ex-increment">
            <div class="hint">Um so viel wird gesteigert.</div></div>
          <div class="field"><label for="ex-rest">Pause (Sek.)</label><input class="input" id="ex-rest" name="restSeconds" type="number" inputmode="numeric" min="0" max="900" placeholder="Standard: ${state.profile.restSeconds}" value="${ex && ex.restSeconds != null ? ex.restSeconds : ''}"></div>
        </div>
        <div class="field"><label for="ex-notes">Notizen (optional)</label><textarea class="input" id="ex-notes" name="notes" maxlength="300" placeholder="Griffbreite, Sitzposition, Hinweise …">${esc(ex ? ex.notes : '')}</textarea></div>
        <p class="hint small muted">Wiederholungsbereich: Sobald du in allen Sätzen das Maximum schaffst, empfiehlt der Tracker die nächste Gewichtsstufe.</p>
      </form>`,
    foot: () => `<button class="btn btn-ghost" data-action="modal-close">Abbrechen</button>
                 <button class="btn btn-primary" type="submit" form="exercise-form">${ex ? 'Speichern' : 'Anlegen'}</button>`,
    onMount: () => { if (!ex) { const i = $('#ex-name'); if (i) i.focus(); } },
    afterSave,
  });
}
function saveExerciseForm(form) {
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  if (!data.name || !data.name.trim()) { toast('Bitte einen Namen eingeben', 'warning'); return; }
  const id = form.dataset.id;
  const dup = state.exercises.find((e) => e.name.toLowerCase() === data.name.trim().toLowerCase() && e.id !== id);
  if (dup) { toast('Eine Übung mit diesem Namen gibt es schon', 'warning'); return; }
  if (data.increment === '' || num(data.increment) == null) data.increment = String(defaultIncrement(data.equipment, state.profile.unit));
  let ex;
  if (id) {
    ex = exById(id);
    const fresh = createExercise(data);
    Object.assign(ex, { name: fresh.name, muscle: fresh.muscle, equipment: fresh.equipment, repMin: fresh.repMin, repMax: fresh.repMax, sets: fresh.sets, increment: fresh.increment, restSeconds: fresh.restSeconds, notes: fresh.notes });
    toast('Übung gespeichert', 'success');
  } else {
    ex = createExercise(data);
    state.exercises.push(ex);
    toast(`„${ex.name}“ angelegt`, 'success');
  }
  save();
  const after = modal && modal.afterSave;
  closeModal();
  if (after) after(ex); else render();
}
function deleteExercise(id) {
  const ex = exById(id); if (!ex) return;
  const n = sessionsFor(id).length;
  confirmDialog({
    title: `„${ex.name}“ löschen?`,
    text: n ? `Die Übung wird aus deiner Liste entfernt. Die ${plural(n, 'Einheit', 'Einheiten')} im Verlauf bleiben erhalten.` : 'Die Übung wird entfernt.',
    okLabel: 'Löschen', danger: true,
    onOk: () => {
      state.exercises = state.exercises.filter((e) => e.id !== id);
      state.routines.forEach((r) => { r.exerciseIds = r.exerciseIds.filter((x) => x !== id); });
      if (ui.exerciseId === id) ui.exerciseId = null;
      save(); closeModal(); render();
    },
  });
}

/* ---------- Trainingspläne ---------- */
function openRoutineForm(routine) {
  const draft = { id: routine ? routine.id : null, name: routine ? routine.name : '', exerciseIds: routine ? routine.exerciseIds.filter((id) => exById(id)) : [] };
  openModal({
    title: routine ? 'Plan bearbeiten' : 'Neuer Trainingsplan',
    draft,
    body: () => {
      const available = state.exercises.filter((e) => !draft.exerciseIds.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      return `
      <form data-form="routine" id="routine-form">
        <div class="field"><label for="rt-name">Name</label><input class="input" id="rt-name" name="name" required maxlength="40" placeholder="z. B. Push, Pull, Beine, Ganzkörper A" value="${esc(draft.name)}" data-field="routine-name" autocomplete="off"></div>
        <div class="field"><label>Übungen in Reihenfolge</label>
          <div class="stack" id="routine-list">${draft.exerciseIds.length ? draft.exerciseIds.map((id, i) => `
            <div class="sortable"><span class="muted small tnum">${i + 1}.</span><span class="grow">${esc(exById(id).name)}</span>
              <button type="button" class="btn btn-icon" data-action="routine-move" data-id="${id}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button>
              <button type="button" class="btn btn-icon" data-action="routine-move" data-id="${id}" data-dir="1" aria-label="Nach unten" ${i === draft.exerciseIds.length - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button>
              <button type="button" class="btn btn-icon" data-action="routine-remove" data-id="${id}" aria-label="Entfernen">${icon('x')}</button></div>`).join('')
            : '<div class="empty small">Noch keine Übungen im Plan.</div>'}</div></div>
        <div class="field"><label for="rt-add">Übung hinzufügen</label>
          <select class="input" id="rt-add" data-field="routine-add"><option value="">Übung wählen …</option>${available.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.muscle)})</option>`).join('')}</select>
          ${state.exercises.length ? '' : '<div class="hint">Lege zuerst Übungen an.</div>'}</div>
      </form>`;
    },
    foot: () => `<button class="btn btn-ghost" data-action="modal-close">Abbrechen</button>
                 <button class="btn btn-primary" type="submit" form="routine-form">${routine ? 'Speichern' : 'Plan anlegen'}</button>`,
  });
}
function saveRoutineForm() {
  const draft = modal && modal.draft; if (!draft) return;
  const nameEl = $('#rt-name'); if (nameEl) draft.name = nameEl.value;
  if (!draft.name.trim()) { toast('Bitte einen Namen eingeben', 'warning'); return; }
  if (!draft.exerciseIds.length) { toast('Füge mindestens eine Übung hinzu', 'warning'); return; }
  if (draft.id) {
    const r = routineById(draft.id); if (r) { r.name = draft.name.trim(); r.exerciseIds = draft.exerciseIds.slice(); }
    toast('Plan gespeichert', 'success');
  } else {
    state.routines.push({ id: uid(), name: draft.name.trim(), exerciseIds: draft.exerciseIds.slice(), createdAt: new Date().toISOString() });
    toast('Plan angelegt', 'success');
  }
  save(); closeModal(); render();
}
function deleteRoutine(id) {
  const r = routineById(id); if (!r) return;
  confirmDialog({ title: `Plan „${r.name}“ löschen?`, text: 'Die Übungen selbst bleiben erhalten.', okLabel: 'Löschen', danger: true,
    onOk: () => { state.routines = state.routines.filter((x) => x.id !== id); save(); closeModal(); render(); } });
}

/* ---------- Export / Import ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `gym-tracker-backup-${dayKey(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup wird heruntergeladen', 'success');
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.exercises) || !Array.isArray(data.workouts)) throw new Error('Format');
      const incoming = sanitize(data);
      confirmDialog({
        title: 'Backup importieren?',
        text: `Das Backup enthält ${plural(incoming.exercises.length, 'Übung', 'Übungen')} und ${plural(incoming.workouts.length, 'Training', 'Trainings')}. Deine aktuellen Daten werden ersetzt.`,
        okLabel: 'Importieren', danger: true,
        onOk: () => { state = incoming; save(); closeModal(); applyTheme(); render(); toast('Backup importiert', 'success'); },
      });
    } catch {
      toast('Datei konnte nicht gelesen werden', 'danger');
    }
  };
  reader.readAsText(file);
}

/* ---------- Diagramm ---------- */
const chartData = {};
function niceTicks(lo, hi, count) {
  const span = hi - lo || 1;
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.5; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { ticks, lo: ticks[0], hi: ticks[ticks.length - 1] };
}
function lineChart(id, points, unitLabel) {
  if (points.length < 2) return `<div class="empty small">Ab zwei Einheiten erscheint hier dein Verlauf.</div>`;
  const W = 600, H = 220, padL = 48, padR = 14, padT = 16, padB = 30;
  const xs = points.map((p) => p.t), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const padY = (maxY - minY) * 0.12;
  const { ticks, lo, hi } = niceTicks(Math.max(0, minY - padY), maxY + padY, 4);
  const x = (t) => padL + ((t - minX) / (maxX - minX || 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const coords = points.map((p) => ({ x: x(p.t), y: y(p.y) }));
  chartData[id] = points.map((p, i) => ({ ...p, cx: coords[i].x, cy: coords[i].y }));
  const path = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${path} L${coords[coords.length - 1].x.toFixed(1)},${(H - padB).toFixed(1)} L${coords[0].x.toFixed(1)},${(H - padB).toFixed(1)} Z`;
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return `<div class="chart-wrap">
    <svg class="chart" viewBox="0 0 ${W} ${H}" data-chart="${id}" role="img" aria-label="Verlauf ${esc(unitLabel)}">
      ${ticks.map((t) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${fmtNum(t, 1)}</text>`).join('')}
      <path class="area" d="${area}"/>
      <path class="line" d="${path}"/>
      <line class="cursor" id="${id}-cursor" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
      ${coords.map((c, i) => `<circle class="dot" data-i="${i}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4"/>`).join('')}
      ${labelIdx.map((i) => `<text x="${coords[i].x.toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${esc(fmtDate(points[i].t, { day: '2-digit', month: '2-digit', year: '2-digit' }))}</text>`).join('')}
    </svg>
    <div class="chart-tip" id="${id}-tip" hidden></div>
  </div>`;
}
function bindCharts() {
  $$('svg[data-chart]').forEach((svg) => {
    const id = svg.dataset.chart;
    const pts = chartData[id]; if (!pts) return;
    const tip = $(`#${id}-tip`); const cursor = $(`#${id}-cursor`);
    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const vx = ((clientX - rect.left) / rect.width) * 600;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(p.cx - vx) < Math.abs(pts[best].cx - vx)) best = i; });
      const p = pts[best];
      cursor.setAttribute('x1', p.cx); cursor.setAttribute('x2', p.cx); cursor.setAttribute('visibility', 'visible');
      $$('.dot', svg).forEach((d, i) => d.setAttribute('r', i === best ? 6 : 4));
      tip.hidden = false;
      tip.innerHTML = `${esc(fmtDate(p.t, { day: '2-digit', month: 'short', year: 'numeric' }))}<br><b>${esc(p.label)}</b>`;
      tip.style.left = `${(p.cx / 600) * rect.width}px`;
      tip.style.top = `${(p.cy / 220) * rect.height}px`;
    };
    const hide = () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); $$('.dot', svg).forEach((d) => d.setAttribute('r', 4)); };
    svg.addEventListener('pointermove', (e) => show(e.clientX));
    svg.addEventListener('pointerdown', (e) => show(e.clientX));
    svg.addEventListener('pointerleave', hide);
  });
}

/* ---------- Ansichten ---------- */
function applyTheme() {
  document.documentElement.dataset.theme = state.profile.theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = state.profile.theme === 'light' ? '#f3f4f7' : '#0f1115';
}

function recCard(ex, rec, compact) {
  const weight = rec.weight != null ? fmtW(rec.weight) : (ex.equipment === 'bodyweight' ? 'Körpergewicht' : 'Gewicht wählen');
  const delta = rec.delta ? `<span class="delta">${rec.delta > 0 ? '+' : ''}${fmtNum(rec.delta)} ${esc(state.profile.unit)}</span>` : '';
  const progress = rec.status === 'reps' ? `<div class="bar" title="Fortschritt im Wiederholungsbereich"><i style="width:${Math.round(rec.progress * 100)}%"></i></div>` : '';
  return `<div class="rec ${compact ? 'compact' : ''} tone-${rec.tone}">
    <div class="rec-icon">${icon(STATUS_ICON[rec.status] || 'info')}</div>
    <div class="rec-body">
      <div class="rec-label">Empfehlung · ${esc(rec.label)}</div>
      <div class="rec-main">${esc(weight)} × ${rec.repTargets.join('/')} Wdh.${delta}</div>
      <div class="rec-text">${esc(rec.reason)}</div>
      ${compact ? '' : `<div class="rec-text">${esc(rec.how)}</div>`}
      ${progress}
    </div>
  </div>`;
}

function viewTopbar() {
  const t = ui.tab;
  const back = (label) => `<button class="btn btn-icon" data-action="back" aria-label="Zurück">${icon('chevron-left')}</button><div class="grow"><h1><span class="truncate">${esc(label)}</span></h1></div>`;
  if (t === 'train' && state.active) {
    const st = workoutStats(state.active);
    return `<div class="grow"><h1 class="clickable" data-action="rename-workout" title="Umbenennen"><span class="truncate">${esc(state.active.name)}</span></h1>
      <div class="sub tnum">${icon('timer', 'inline')} <span id="workout-clock">${fmtDuration(Date.now() - new Date(state.active.startedAt))}</span> · ${plural(st.sets, 'Satz', 'Sätze')} · ${fmtNum(st.volume, 0)} ${esc(state.profile.unit)}</div></div>
      <button class="btn btn-sm btn-success" data-action="finish-workout">${icon('check')} Beenden</button>`;
  }
  if (t === 'train') {
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
    return `<div class="grow"><h1>Training</h1><div class="sub">${esc(greet)}${state.profile.name ? `, ${esc(state.profile.name)}` : ''} · ${esc(fmtDate(new Date(), { weekday: 'long', day: '2-digit', month: 'long' }))}</div></div>`;
  }
  if (t === 'history') return `<div class="grow"><h1>Verlauf</h1><div class="sub">${plural(state.workouts.length, 'Training', 'Trainings')} gesamt</div></div>`;
  if (t === 'exercises') {
    if (ui.exerciseId && exById(ui.exerciseId)) {
      const ex = exById(ui.exerciseId);
      return `${back(ex.name)}<button class="btn btn-icon" data-action="edit-exercise" data-id="${ex.id}" aria-label="Bearbeiten">${icon('edit')}</button>`;
    }
    return `<div class="grow"><h1>Übungen</h1><div class="sub">${plural(state.exercises.length, 'Übung', 'Übungen')} angelegt</div></div>
      <button class="btn btn-sm btn-primary" data-action="new-exercise">${icon('plus')} Neu</button>`;
  }
  return `<div class="grow"><h1>Profil</h1><div class="sub">Einstellungen, Übungen und Pläne</div></div>`;
}

function viewTrainHome() {
  const week = weekStats(0);
  const last = state.workouts[0];
  const parts = [];

  if (!state.exercises.length) {
    parts.push(`<div class="card hero">
      <h2>Willkommen im Gym Tracker</h2>
      <p>Lege zuerst deine Übungen an – mit eigenem Namen, Wiederholungsbereich und Gewichtsstufe. Oder starte mit dem Starter-Set und benenne die Übungen später um.</p>
      <div class="btn-row"><button class="btn btn-primary" data-action="load-starter">Starter-Set laden</button><button class="btn btn-ghost" data-action="new-exercise">Übung anlegen</button></div>
    </div>`);
  } else {
    parts.push(`<div class="card hero">
      <h2>Bereit für dein Training?</h2>
      <p>Starte leer und wähle Übungen unterwegs, oder nimm einen deiner Pläne.</p>
      <button class="btn btn-primary btn-block" data-action="start-empty">${icon('play')} Training starten</button>
    </div>`);
  }

  if (state.routines.length) {
    parts.push(`<div class="section-title"><span>Trainingspläne</span><button class="link" data-action="new-routine">${icon('plus')} Plan</button></div>
      <div class="list">${state.routines.map((r) => {
        const lastRun = state.workouts.find((w) => w.routineId === r.id);
        return `<button class="item" data-action="start-routine" data-id="${r.id}">
          <div class="avatar">${esc(r.name.slice(0, 2).toUpperCase())}</div>
          <div class="grow"><div class="item-title">${esc(r.name)}</div><div class="item-sub">${plural(r.exerciseIds.filter((id) => exById(id)).length, 'Übung', 'Übungen')}${lastRun ? ` · zuletzt ${esc(fmtDate(lastRun.finishedAt))}` : ''}</div></div>
          ${icon('play', 'muted')}
        </button>`;
      }).join('')}</div>`);
  } else if (state.exercises.length) {
    parts.push(`<div class="card between wrap"><div><div class="item-title">Trainingspläne</div><div class="item-sub">Fasse Übungen zu Push, Pull, Beine … zusammen.</div></div><button class="btn btn-sm btn-ghost" data-action="new-routine">${icon('plus')} Plan anlegen</button></div>`);
  }

  parts.push(`<div class="card"><div class="card-title">Diese Woche <span class="meta">${weekStreak() ? `${icon('flame')} ${plural(weekStreak(), 'Woche', 'Wochen')} in Folge` : ''}</span></div>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Trainings</div><div class="tile-value">${week.count}</div></div>
      <div class="tile"><div class="tile-label">Sätze</div><div class="tile-value">${week.sets}</div></div>
      <div class="tile"><div class="tile-label">Volumen</div><div class="tile-value">${fmtNum(week.volume, 0)}<span class="unit">${esc(state.profile.unit)}</span></div></div>
    </div></div>`);

  if (last) {
    const st = workoutStats(last);
    parts.push(`<div class="card"><div class="card-title">Letztes Training <span class="meta">${esc(fmtDate(last.finishedAt))}</span></div>
      <div class="item-title">${esc(last.name)}</div>
      <div class="item-sub">${plural(st.exercises, 'Übung', 'Übungen')} · ${plural(st.sets, 'Satz', 'Sätze')} · ${fmtNum(st.volume, 0)} ${esc(state.profile.unit)} · ${fmtMinutes(st.duration)}</div>
      <div class="sets-summary mt-sm">${last.entries.map((en) => `<span class="pill">${esc(entryName(en))}</span>`).join('')}</div>
      <div class="btn-row mt"><button class="btn btn-ghost" data-action="repeat-workout" data-id="${last.id}">${icon('history')} Wiederholen</button><button class="btn btn-ghost" data-action="tab" data-tab="history">Verlauf</button></div>
    </div>`);
  }
  return parts.join('');
}

function viewActiveWorkout() {
  const a = state.active;
  const withRpe = state.profile.trackRpe;
  const cards = a.entries.map((entry, idx) => {
    const ex = exById(entry.exerciseId);
    const sessions = ex ? sessionsFor(ex.id) : [];
    const rec = ex ? recommendationFor(ex, sessions) : null;
    const lastSession = sessions[0];
    const prevSets = lastSession ? lastSession.sets.filter((s) => !s.warmup) : [];
    let workIdx = 0;
    const rows = entry.sets.map((s) => {
      const isWarm = s.warmup;
      const i = isWarm ? null : workIdx++;
      const prev = !isWarm && prevSets[i] ? `${fmtNum(prevSets[i].weight)}×${prevSets[i].reps}` : (isWarm ? 'Aufwärmen' : '–');
      return `<div class="set-row ${s.done ? 'done' : ''}" data-entry="${entry.id}" data-set="${s.id}">
        <div class="set-num ${isWarm ? 'warmup' : ''}">${isWarm ? 'W' : i + 1}</div>
        <div class="set-prev">${esc(prev)}</div>
        <input class="set-input" inputmode="decimal" enterkeyhint="next" aria-label="Gewicht" placeholder="${ex && ex.equipment === 'bodyweight' ? '0' : '–'}" value="${esc(inputVal(s.weight))}" data-field="weight" data-entry="${entry.id}" data-set="${s.id}">
        <input class="set-input" inputmode="numeric" enterkeyhint="done" aria-label="Wiederholungen" placeholder="${rec && !isWarm && rec.repTargets[i] != null ? rec.repTargets[i] : '–'}" value="${esc(inputVal(s.reps))}" data-field="reps" data-entry="${entry.id}" data-set="${s.id}">
        ${withRpe ? `<input class="set-input" inputmode="decimal" aria-label="RPE" placeholder="RPE" value="${esc(inputVal(s.rpe))}" data-field="rpe" data-entry="${entry.id}" data-set="${s.id}">` : ''}
        <button class="set-done ${s.done ? 'on' : ''}" data-action="toggle-set" data-entry="${entry.id}" data-set="${s.id}" aria-label="${s.done ? 'Satz zurücksetzen' : 'Satz abschließen'}" aria-pressed="${s.done}">${icon('check')}</button>
      </div>`;
    }).join('');
    const menuOpen = ui.menuEntry === entry.id;
    return `<div class="card exercise-card" id="entry-${entry.id}">
      <div class="exercise-head">
        <div class="grow"><h3>${esc(entryName(entry))}</h3><div class="meta">${ex ? `${esc(ex.muscle)} · ${esc(eqLabel(ex.equipment))} · Ziel ${ex.sets} × ${ex.repMin}–${ex.repMax}` : 'Übung wurde gelöscht'}</div></div>
        <div class="menu-wrap">
          <button class="btn btn-icon" data-action="entry-menu" data-id="${entry.id}" aria-label="Optionen" aria-expanded="${menuOpen}">${icon('more')}</button>
          ${menuOpen ? `<div class="menu">
            <button data-action="add-warmup" data-id="${entry.id}">${icon('flame')} Aufwärmsätze vorschlagen</button>
            <button data-action="entry-note" data-id="${entry.id}">${icon('edit')} Notiz ${entry.note ? 'bearbeiten' : 'hinzufügen'}</button>
            ${ex ? `<button data-action="open-exercise" data-id="${ex.id}">${icon('history')} Verlauf der Übung</button>` : ''}
            <button data-action="move-entry" data-id="${entry.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>${icon('arrow-up')} Nach oben</button>
            <button data-action="move-entry" data-id="${entry.id}" data-dir="1" ${idx === a.entries.length - 1 ? 'disabled' : ''}>${icon('arrow-down')} Nach unten</button>
            <button class="danger" data-action="remove-entry" data-id="${entry.id}">${icon('trash')} Übung entfernen</button>
          </div>` : ''}
        </div>
      </div>
      ${rec ? recCard(ex, rec, true) : ''}
      ${entry.note ? `<div class="small muted mt-sm">📝 ${esc(entry.note)}</div>` : ''}
      <div class="sets ${withRpe ? 'with-rpe' : ''}">
        <div class="sets-head"><span>Satz</span><span>Zuletzt</span><span>${esc(state.profile.unit)}</span><span>Wdh.</span>${withRpe ? '<span>RPE</span>' : ''}<span></span></div>
        ${rows}
      </div>
      <div class="set-actions">
        <button class="btn btn-sm btn-ghost" data-action="add-set" data-id="${entry.id}">${icon('plus')} Satz</button>
        ${entry.sets.length ? `<button class="btn btn-sm btn-ghost" data-action="remove-last-set" data-id="${entry.id}">${icon('x')} Letzten Satz entfernen</button>` : ''}
      </div>
    </div>`;
  }).join('');

  return `${cards || `<div class="empty">${icon('dumbbell')}<h3>Noch keine Übung im Training</h3><p>Wähle aus deinen angelegten Übungen.</p></div>`}
    <button class="btn btn-primary btn-block" data-action="open-picker">${icon('plus')} Übung hinzufügen</button>
    <div class="btn-row"><button class="btn btn-success" data-action="finish-workout">${icon('check')} Training beenden</button><button class="btn btn-danger" data-action="discard-workout">Verwerfen</button></div>`;
}

function viewHistory() {
  if (!state.workouts.length) {
    return `<div class="card"><div class="empty">${icon('history')}<h3>Noch kein Training gespeichert</h3><p>Dein erstes abgeschlossenes Training erscheint hier mit allen Sätzen.</p><button class="btn btn-primary" data-action="tab" data-tab="train">Zum Training</button></div></div>`;
  }
  const month = state.workouts.filter((w) => { const d = new Date(w.finishedAt); const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); });
  const total = state.workouts.reduce((acc, w) => acc + workoutStats(w).volume, 0);
  const groups = [];
  state.workouts.forEach((w) => {
    const key = new Date(w.finishedAt).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
    g.items.push(w);
  });
  return `<div class="card"><div class="card-title">Überblick</div>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Diesen Monat</div><div class="tile-value">${month.length}</div></div>
      <div class="tile"><div class="tile-label">Serie</div><div class="tile-value">${weekStreak()}<span class="unit">Wo.</span></div></div>
      <div class="tile"><div class="tile-label">Gesamtvolumen</div><div class="tile-value">${fmtNum(total >= 10000 ? total / 1000 : total, total >= 10000 ? 1 : 0)}<span class="unit">${total >= 10000 ? 't' : esc(state.profile.unit)}</span></div></div>
    </div>
    <div class="mt">${heatmap()}</div>
  </div>
  ${groups.map((g) => `<div class="section-title"><span>${esc(g.key)}</span><span>${plural(g.items.length, 'Training', 'Trainings')}</span></div>
    <div class="list">${g.items.map(workoutCard).join('')}</div>`).join('')}`;
}
function workoutCard(w) {
  const st = workoutStats(w);
  const open = ui.openWorkouts.has(w.id);
  return `<div class="card workout-card">
    <button class="item" style="padding:0;border:0;background:none" data-action="history-toggle" data-id="${w.id}" aria-expanded="${open}">
      <div class="grow"><div class="item-title">${esc(w.name)}</div>
        <div class="item-sub">${esc(fmtDate(w.finishedAt))} · ${esc(fmtTime(w.startedAt))} · ${fmtMinutes(st.duration)}</div>
        <div class="item-sub">${plural(st.exercises, 'Übung', 'Übungen')} · ${plural(st.sets, 'Satz', 'Sätze')} · ${fmtNum(st.volume, 0)} ${esc(state.profile.unit)}</div></div>
      ${icon('chevron-down', `chev ${open ? 'open' : ''}`)}
    </button>
    ${open ? `<div class="mt">${w.entries.map((en) => `<div class="workout-entry">
        <div class="name">${esc(entryName(en))}</div>
        <div class="sets-summary">${en.sets.map((s) => `<span class="pill ${s.warmup ? 'warm' : ''}">${fmtNum(s.weight)} × ${s.reps}${s.rpe ? ` @${fmtNum(s.rpe, 1)}` : ''}</span>`).join('')}</div>
        ${en.note ? `<div class="small muted mt-sm">📝 ${esc(en.note)}</div>` : ''}
      </div>`).join('')}
      <div class="btn-row mt"><button class="btn btn-sm btn-ghost" data-action="repeat-workout" data-id="${w.id}">${icon('history')} Wiederholen</button><button class="btn btn-sm btn-danger" data-action="delete-workout" data-id="${w.id}">${icon('trash')} Löschen</button></div>
    </div>` : ''}
  </div>`;
}
function heatmap() {
  const counts = {};
  state.workouts.forEach((w) => { const k = dayKey(w.finishedAt); counts[k] = (counts[k] || 0) + 1; });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = startOfWeek(today); start.setDate(start.getDate() - 7 * 11);
  const cells = [];
  for (let i = 0; i < 84; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dayKey(d);
    const c = counts[k] || 0;
    const future = d > today;
    cells.push(`<div class="hm-cell ${c >= 2 ? 'l2' : c === 1 ? 'l1' : ''} ${k === dayKey(today) ? 'today' : ''}" style="${future ? 'opacity:.25' : ''}" title="${esc(fmtDate(d, { day: '2-digit', month: '2-digit', year: 'numeric' }))}: ${plural(c, 'Training', 'Trainings')}"></div>`);
  }
  return `<div class="label">Letzte 12 Wochen</div><div class="heatmap">${cells.join('')}</div>
    <div class="hm-legend">weniger <span class="hm-cell"></span><span class="hm-cell l1"></span><span class="hm-cell l2"></span> mehr</div>`;
}

function viewExercises() {
  if (ui.exerciseId && exById(ui.exerciseId)) return viewExerciseDetail(exById(ui.exerciseId));
  if (!state.exercises.length) {
    return `<div class="card"><div class="empty">${icon('list')}<h3>Noch keine Übungen</h3><p>Lege Übungen mit eigenem Namen an. Du kannst sie später jederzeit umbenennen.</p>
      <div class="btn-row"><button class="btn btn-primary" data-action="new-exercise">${icon('plus')} Übung anlegen</button><button class="btn btn-ghost" data-action="load-starter">Starter-Set</button></div></div></div>`;
  }
  const q = ui.query.trim().toLowerCase();
  const list = state.exercises
    .filter((e) => (!ui.muscle || e.muscle === ui.muscle) && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return `<div class="search"><svg><use href="#i-search"/></svg><input class="input" placeholder="Übung suchen …" value="${esc(ui.query)}" data-field="query" autocomplete="off"></div>
    <div class="chips scroll">${['', ...MUSCLES].map((m) => `<button class="chip ${ui.muscle === m ? 'active' : ''}" data-action="filter-muscle" data-muscle="${esc(m)}">${m || 'Alle'}</button>`).join('')}</div>
    ${list.length ? `<div class="list">${list.map((e) => {
      const sessions = sessionsFor(e.id);
      const rec = recommendationFor(e, sessions);
      const sum = sessions[0] ? P.summarize(sessions[0]) : null;
      return `<button class="item" data-action="open-exercise" data-id="${e.id}">
        <div class="avatar">${esc(e.name.slice(0, 2).toUpperCase())}</div>
        <div class="grow"><div class="item-title">${esc(e.name)}</div>
          <div class="item-sub">${esc(e.muscle)} · ${esc(eqLabel(e.equipment))} · <span class="nowrap">${e.sets} × ${e.repMin}–${e.repMax}</span>${sum ? ` · zuletzt ${fmtW(sum.workWeight)} × ${sum.workSets.map((s) => s.reps).join('/')}` : ''}</div></div>
        <div class="right">${rec.trend !== 'none' ? `<span class="badge tone-${rec.trend === 'up' ? 'success' : rec.trend === 'down' ? 'danger' : 'info'}">${icon(TREND_ICON[rec.trend])} ${TREND_LABEL[rec.trend]}</span>` : `<span class="badge">${plural(sessions.length, 'Einheit', 'Einheiten')}</span>`}</div>
      </button>`;
    }).join('')}</div>` : `<div class="empty small">Keine Übung gefunden.</div>`}`;
}

function viewExerciseDetail(ex) {
  const sessions = sessionsFor(ex.id);
  const rec = recommendationFor(ex, sessions);
  const summaries = sessions.map((s) => ({ s, sum: P.summarize(s) })).filter((x) => x.sum);
  const isBodyweight = ex.equipment === 'bodyweight' && summaries.every((x) => x.sum.workWeight === 0);
  const metric = ui.chartMetric[ex.id] || (isBodyweight ? 'reps' : 'e1rm');
  const metrics = { e1rm: '1RM', top: 'Gewicht', volume: 'Volumen', reps: 'Wdh.' };
  const metricNames = { e1rm: 'Geschätztes Einwiederholungsmaximum', top: 'Arbeitsgewicht', volume: 'Volumen', reps: 'Wiederholungen' };
  const points = summaries.slice().reverse().map(({ s, sum }) => {
    const y = metric === 'e1rm' ? sum.e1rm : metric === 'top' ? sum.workWeight : metric === 'volume' ? sum.volume : sum.totalReps;
    const label = metric === 'reps' ? `${y} Wdh.` : `${fmtNum(y, metric === 'volume' ? 0 : 1)} ${state.profile.unit}`;
    return { t: new Date(s.date).getTime(), y, label };
  });
  const best = summaries.length ? Math.max(...summaries.map((x) => x.sum.e1rm)) : null;
  const top = summaries.length ? Math.max(...summaries.map((x) => x.sum.topWeight)) : null;
  return `${recCard(ex, rec, false)}
    <div class="tiles tiles-4">
      <div class="tile"><div class="tile-label">Bestes 1RM</div><div class="tile-value">${best != null ? fmtNum(best, 1) : '–'}<span class="unit">${esc(state.profile.unit)}</span></div><div class="tile-sub">geschätzt</div></div>
      <div class="tile"><div class="tile-label">Topgewicht</div><div class="tile-value">${top != null ? fmtNum(top) : '–'}<span class="unit">${esc(state.profile.unit)}</span></div></div>
      <div class="tile"><div class="tile-label">Einheiten</div><div class="tile-value">${sessions.length}</div><div class="tile-sub">${sessions[0] ? `zuletzt ${esc(fmtDate(sessions[0].date, { day: '2-digit', month: '2-digit' }))}` : ''}</div></div>
      <div class="tile"><div class="tile-label">Trend</div><div class="tile-value">${rec.trend !== 'none' ? icon(TREND_ICON[rec.trend]) : ''} ${TREND_LABEL[rec.trend]}</div><div class="tile-sub">letzte Einheiten</div></div>
    </div>
    <div class="card">
      <div class="card-title">Verlauf</div>
      <div class="seg">${Object.keys(metrics).map((k) => `<button class="${metric === k ? 'active' : ''}" data-action="chart-metric" data-id="${ex.id}" data-metric="${k}">${metrics[k]}</button>`).join('')}</div>
      <div class="small muted mt-sm">${esc(metricNames[metric])}</div>
      ${lineChart(`chart-${ex.id.replace(/[^a-z0-9]/gi, '')}`, points, metricNames[metric])}
    </div>
    <div class="card">
      <div class="card-title">Einstellungen</div>
      <div class="chips"><span class="chip static">${esc(ex.muscle)}</span><span class="chip static">${esc(eqLabel(ex.equipment))}</span><span class="chip static">${ex.sets} Sätze</span><span class="chip static">${ex.repMin}–${ex.repMax} Wdh.</span><span class="chip static">+${fmtNum(ex.increment)} ${esc(state.profile.unit)}</span><span class="chip static">Pause ${ex.restSeconds != null ? ex.restSeconds : state.profile.restSeconds} s</span></div>
      ${ex.notes ? `<p class="small muted mt">${esc(ex.notes)}</p>` : ''}
      <div class="btn-row mt"><button class="btn btn-ghost" data-action="edit-exercise" data-id="${ex.id}">${icon('edit')} Bearbeiten</button><button class="btn btn-danger" data-action="delete-exercise" data-id="${ex.id}">${icon('trash')} Löschen</button></div>
    </div>
    <div class="section-title"><span>Einheiten</span><span>${sessions.length}</span></div>
    ${summaries.length ? `<div class="list">${summaries.map(({ s, sum }) => `<div class="card workout-card">
      <div class="between"><div class="item-title">${esc(fmtDate(s.date, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }))}</div><div class="right small muted tnum">e1RM ${fmtNum(sum.e1rm, 1)} · Vol. ${fmtNum(sum.volume, 0)}</div></div>
      <div class="sets-summary">${s.sets.map((set) => `<span class="pill ${set.warmup ? 'warm' : ''}">${fmtNum(set.weight)} × ${set.reps}${set.rpe ? ` @${fmtNum(set.rpe, 1)}` : ''}</span>`).join('')}</div>
    </div>`).join('')}</div>` : `<div class="card"><div class="empty small">Noch keine Einheiten – füge die Übung beim nächsten Training hinzu.</div></div>`}`;
}

function viewProfile() {
  const p = state.profile;
  const totalVolume = state.workouts.reduce((acc, w) => acc + workoutStats(w).volume, 0);
  const totalSets = state.workouts.reduce((acc, w) => acc + workoutStats(w).sets, 0);
  return `
  <div class="card">
    <div class="card-title">Profil</div>
    <div class="field"><label for="pf-name">Name</label><input class="input" id="pf-name" placeholder="Wie sollen wir dich nennen?" value="${esc(p.name)}" data-field="profile-name" maxlength="40" autocomplete="given-name"></div>
    <div class="row">
      <div class="field"><label for="pf-unit">Einheit</label><select class="input" id="pf-unit" data-field="profile-unit"><option value="kg" ${p.unit === 'kg' ? 'selected' : ''}>Kilogramm (kg)</option><option value="lb" ${p.unit === 'lb' ? 'selected' : ''}>Pfund (lb)</option></select></div>
      <div class="field"><label for="pf-rest">Pause (Sek.)</label><input class="input" id="pf-rest" type="number" inputmode="numeric" min="0" max="900" value="${p.restSeconds}" data-field="profile-rest"></div>
    </div>
    <div class="switch"><div><div class="switch-text">RPE erfassen</div><div class="switch-sub">Anstrengung pro Satz (6–10) eintragen, verfeinert die Empfehlung</div></div><button class="toggle ${p.trackRpe ? 'on' : ''}" data-action="toggle-rpe" role="switch" aria-checked="${p.trackRpe}" aria-label="RPE erfassen"></button></div>
    <div class="switch"><div><div class="switch-text">Dunkles Design</div><div class="switch-sub">Schont die Augen im Studio</div></div><button class="toggle ${p.theme === 'dark' ? 'on' : ''}" data-action="toggle-theme" role="switch" aria-checked="${p.theme === 'dark'}" aria-label="Dunkles Design"></button></div>
  </div>

  <div class="card">
    <div class="card-title">Meine Übungen <span class="meta">${plural(state.exercises.length, 'Übung', 'Übungen')}</span></div>
    <p class="small muted mb">Lege hier Übungen mit eigenem Namen, Wiederholungsbereich und Gewichtsstufe an. Im Training wählst du sie dann einfach aus.</p>
    <div class="btn-row"><button class="btn btn-primary" data-action="new-exercise">${icon('plus')} Übung anlegen</button><button class="btn btn-ghost" data-action="tab" data-tab="exercises">Alle anzeigen</button></div>
    ${state.exercises.length ? '' : `<button class="btn btn-ghost btn-block mt" data-action="load-starter">Starter-Set mit 17 Übungen laden</button>`}
  </div>

  <div class="card">
    <div class="card-title">Trainingspläne <span class="meta">${plural(state.routines.length, 'Plan', 'Pläne')}</span></div>
    ${state.routines.length ? `<div class="list mb">${state.routines.map((r) => `<div class="item">
      <div class="grow"><div class="item-title">${esc(r.name)}</div><div class="item-sub">${r.exerciseIds.filter((id) => exById(id)).map((id) => esc(exById(id).name)).join(' · ') || 'keine Übungen'}</div></div>
      <button class="btn btn-icon" data-action="edit-routine" data-id="${r.id}" aria-label="Bearbeiten">${icon('edit')}</button>
      <button class="btn btn-icon" data-action="delete-routine" data-id="${r.id}" aria-label="Löschen">${icon('trash')}</button>
    </div>`).join('')}</div>` : `<p class="small muted mb">Ein Plan ist eine feste Übungsabfolge (z. B. Push, Pull, Beine), die du mit einem Tipp startest.</p>`}
    <button class="btn btn-ghost btn-block" data-action="new-routine">${icon('plus')} Plan anlegen</button>
  </div>

  <div class="card">
    <div class="card-title">Statistik</div>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Trainings</div><div class="tile-value">${state.workouts.length}</div></div>
      <div class="tile"><div class="tile-label">Sätze</div><div class="tile-value">${totalSets}</div></div>
      <div class="tile"><div class="tile-label">Volumen</div><div class="tile-value">${fmtNum(totalVolume >= 10000 ? totalVolume / 1000 : totalVolume, totalVolume >= 10000 ? 1 : 0)}<span class="unit">${totalVolume >= 10000 ? 't' : esc(p.unit)}</span></div></div>
      <div class="tile"><div class="tile-label">Serie</div><div class="tile-value">${weekStreak()}<span class="unit">Wo.</span></div></div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">So funktioniert die Progression</div>
    <ol class="rules">
      <li><b>Wiederholungsbereich:</b> Jede Übung hat ein Ziel wie 3 × 8–12. Du bleibst beim Gewicht und baust Wiederholungen auf.</li>
      <li><b>Steigern:</b> Schaffst du in allen Sätzen das Maximum, empfiehlt der Tracker die nächste Gewichtsstufe (z. B. +2,5 kg) und du startest wieder am unteren Ende. Bei viel Reserve (2+ Wdh. über dem Ziel oder RPE ≤ 7) sind es zwei Stufen.</li>
      <li><b>Halten:</b> Liegt ein Satz unter dem Minimum, bleibt das Gewicht gleich und du versuchst es erneut.</li>
      <li><b>Deload:</b> Klappt es zweimal hintereinander nicht, geht das Gewicht um ca. 10 % runter. Dasselbe gilt bei einem Plateau über vier Einheiten.</li>
      <li><b>Wiedereinstieg:</b> Nach 3+ Wochen Pause wird ein leichterer Einstieg (−10 bis −15 %) empfohlen.</li>
      <li><b>Wie steigern:</b> Die Empfehlung sagt dir konkret, was aufzulegen ist: Scheiben pro Seite, nächste Kurzhantel oder Steckgewicht-Stufe.</li>
    </ol>
  </div>

  <div class="card">
    <div class="card-title">Daten</div>
    <p class="small muted mb">Alle Daten liegen nur in diesem Browser. Sichere sie regelmäßig als Datei, z. B. vor einem Gerätewechsel.</p>
    <div class="btn-row"><button class="btn btn-ghost" data-action="export">${icon('download')} Exportieren</button><label class="btn btn-ghost" for="import-file">${icon('upload')} Importieren</label></div>
    <input type="file" id="import-file" accept="application/json,.json" hidden data-field="import">
    <div class="btn-row mt"><button class="btn btn-ghost" data-action="load-starter">Starter-Set laden</button><button class="btn btn-danger" data-action="reset-all">${icon('trash')} Alles löschen</button></div>
  </div>
  <div class="version">Gym Tracker ${APP_VERSION} · funktioniert offline · Zum Homescreen hinzufügen für die App-Ansicht</div>`;
}

function viewTabbar() {
  const tabs = [
    ['train', 'dumbbell', 'Training'],
    ['history', 'history', 'Verlauf'],
    ['exercises', 'list', 'Übungen'],
    ['profile', 'user', 'Profil'],
  ];
  return tabs.map(([key, ic, label]) => `<button class="tab ${ui.tab === key ? 'active' : ''}" data-action="tab" data-tab="${key}" aria-current="${ui.tab === key ? 'page' : 'false'}">${icon(ic)}<span>${label}</span>${key === 'train' && state.active ? '<span class="dot" aria-label="Training läuft"></span>' : ''}</button>`).join('');
}

function render() {
  applyTheme();
  $('#topbar').innerHTML = viewTopbar();
  const view = $('#view');
  const scrollY = window.scrollY;
  if (ui.tab === 'train') view.innerHTML = state.active ? viewActiveWorkout() : viewTrainHome();
  else if (ui.tab === 'history') view.innerHTML = viewHistory();
  else if (ui.tab === 'exercises') view.innerHTML = viewExercises();
  else view.innerHTML = viewProfile();
  $('#tabbar').innerHTML = viewTabbar();
  bindCharts();
  if (ui.keepScroll) { window.scrollTo(0, scrollY); ui.keepScroll = false; } else window.scrollTo(0, 0);
}

/* ---------- Ereignisse ---------- */
function setTab(tab) {
  ui.tab = tab;
  ui.keepScroll = false;
  if (tab !== 'exercises') ui.exerciseId = null;
  ui.menuEntry = null;
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  // Menü schließen bei Klick außerhalb
  if (ui.menuEntry && !e.target.closest('.menu') && !(el && el.dataset.action === 'entry-menu')) { ui.menuEntry = null; ui.keepScroll = true; render(); }
  if (!el) return;
  const a = el.dataset.action; const id = el.dataset.id;
  ui.keepScroll = true;
  switch (a) {
    case 'tab': setTab(el.dataset.tab); break;
    case 'back': ui.exerciseId = null; ui.keepScroll = false; render(); break;
    case 'modal-close': closeModal(); break;
    case 'modal-backdrop': if (e.target === el) closeModal(); break;
    case 'confirm-ok': if (modal && modal.onOk) modal.onOk(); break;

    case 'load-starter': if (modal) closeModal(); loadStarter(); break;
    case 'start-empty': startWorkout({ name: 'Training' }); break;
    case 'start-routine': { const r = routineById(id); if (r) startWorkout({ name: r.name, exerciseIds: r.exerciseIds.filter((x) => exById(x)), routineId: r.id }); break; }
    case 'repeat-workout': repeatWorkout(id); break;
    case 'rename-workout': promptDialog({ title: 'Training umbenennen', label: 'Name', value: state.active.name, onOk: (v) => { if (v.trim()) { state.active.name = v.trim(); save(); } closeModal(); render(); } }); break;
    case 'finish-workout': finishWorkout(); break;
    case 'discard-workout': discardWorkout(); break;
    case 'open-picker': openPicker(); break;
    case 'picker-toggle': { const sel = ui.picker.selected; const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id); refreshModal(); break; }
    case 'picker-muscle': ui.picker.muscle = el.dataset.muscle; refreshModal(); break;
    case 'picker-confirm': { const ids = ui.picker.selected.slice(); closeModal(); ids.forEach(addEntry); save(); render(); toast(`${plural(ids.length, 'Übung', 'Übungen')} hinzugefügt`, 'success'); break; }
    case 'picker-new': openExerciseForm(null, (ex) => { addEntry(ex.id); save(); render(); }); break;
    case 'toggle-set': toggleSet(el.dataset.entry, el.dataset.set); break;
    case 'add-set': addSet(id, false); break;
    case 'add-warmup': ui.menuEntry = null; addSet(id, true); break;
    case 'remove-last-set': { const en = state.active.entries.find((x) => x.id === id); if (en && en.sets.length) removeSet(id, en.sets[en.sets.length - 1].id); break; }
    case 'remove-entry': ui.menuEntry = null; removeEntry(id); break;
    case 'move-entry': ui.menuEntry = null; moveEntry(id, Number(el.dataset.dir)); break;
    case 'entry-menu': ui.menuEntry = ui.menuEntry === id ? null : id; render(); break;
    case 'entry-note': { ui.menuEntry = null; const en = state.active.entries.find((x) => x.id === id); promptDialog({ title: 'Notiz', label: entryName(en), value: en.note, placeholder: 'z. B. Griff enger, Sitz auf 4', onOk: (v) => { en.note = v.trim(); save(); closeModal(); render(); } }); break; }
    case 'rest-adjust': adjustRest(Number(el.dataset.delta)); break;
    case 'rest-skip': stopRest(true); break;

    case 'open-exercise': ui.menuEntry = null; ui.tab = 'exercises'; ui.exerciseId = id; ui.keepScroll = false; render(); break;
    case 'new-exercise': openExerciseForm(null); break;
    case 'edit-exercise': openExerciseForm(exById(id)); break;
    case 'delete-exercise': deleteExercise(id); break;
    case 'filter-muscle': ui.muscle = el.dataset.muscle; render(); break;
    case 'chart-metric': ui.chartMetric[id] = el.dataset.metric; render(); break;
    case 'history-toggle': if (ui.openWorkouts.has(id)) ui.openWorkouts.delete(id); else ui.openWorkouts.add(id); render(); break;
    case 'delete-workout': { const w = state.workouts.find((x) => x.id === id); if (!w) break; confirmDialog({ title: 'Training löschen?', text: `„${w.name}“ vom ${fmtDate(w.finishedAt)} wird unwiderruflich gelöscht.`, okLabel: 'Löschen', danger: true, onOk: () => { state.workouts = state.workouts.filter((x) => x.id !== id); save(); closeModal(); render(); } }); break; }

    case 'new-routine': openRoutineForm(null); break;
    case 'edit-routine': openRoutineForm(routineById(id)); break;
    case 'delete-routine': deleteRoutine(id); break;
    case 'routine-move': { const d = modal.draft; const i = d.exerciseIds.indexOf(id); const j = i + Number(el.dataset.dir); if (i >= 0 && j >= 0 && j < d.exerciseIds.length) { [d.exerciseIds[i], d.exerciseIds[j]] = [d.exerciseIds[j], d.exerciseIds[i]]; } d.name = $('#rt-name').value; refreshModal(); break; }
    case 'routine-remove': { const d = modal.draft; d.exerciseIds = d.exerciseIds.filter((x) => x !== id); d.name = $('#rt-name').value; refreshModal(); break; }

    case 'toggle-rpe': state.profile.trackRpe = !state.profile.trackRpe; save(); render(); break;
    case 'toggle-theme': state.profile.theme = state.profile.theme === 'dark' ? 'light' : 'dark'; save(); render(); break;
    case 'export': exportData(); break;
    case 'reset-all': confirmDialog({ title: 'Wirklich alles löschen?', text: 'Übungen, Pläne und der komplette Verlauf werden entfernt. Exportiere vorher ein Backup, falls du die Daten behalten willst.', okLabel: 'Alles löschen', danger: true, onOk: () => { state = defaultState(); save(); stopRest(true); closeModal(); applyTheme(); render(); toast('Alle Daten gelöscht', 'info'); } }); break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  const field = el.dataset && el.dataset.field;
  if (!field) return;
  switch (field) {
    case 'weight': case 'reps': case 'rpe': {
      const { set } = findSet(el.dataset.entry, el.dataset.set);
      if (set) { set[field] = el.value; save(); }
      break;
    }
    case 'query': { ui.query = el.value; const pos = el.selectionStart; ui.keepScroll = true; render(); const again = $('[data-field="query"]'); if (again) { again.focus(); again.setSelectionRange(pos, pos); } break; }
    case 'picker-query': ui.picker.query = el.value; { const list = $('#picker-list'); if (list) list.innerHTML = pickerList(); } break;
    case 'profile-name': state.profile.name = el.value.trim(); save(); break;
    case 'profile-rest': { const n = num(el.value); if (n != null && n >= 0) { state.profile.restSeconds = Math.round(n); save(); } break; }
    case 'routine-name': if (modal && modal.draft) modal.draft.name = el.value; break;
    case 'ex-increment': el.dataset.touched = '1'; break;
    default: break;
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const field = el.dataset && el.dataset.field;
  if (!field) return;
  switch (field) {
    case 'profile-unit': {
      const unit = el.value;
      if (unit === state.profile.unit) break;
      state.profile.unit = unit; save();
      toast('Einheit geändert – bestehende Gewichte werden nicht umgerechnet', 'info');
      render(); break;
    }
    case 'ex-equipment': {
      const inc = $('#ex-inc');
      if (inc && !inc.dataset.touched) inc.value = inputVal(el.value === 'bodyweight' ? 0 : defaultIncrement(el.value, state.profile.unit));
      break;
    }
    case 'routine-add': {
      if (el.value && modal && modal.draft) { modal.draft.exerciseIds.push(el.value); modal.draft.name = $('#rt-name').value; refreshModal(); }
      break;
    }
    case 'import': if (el.files && el.files[0]) { importData(el.files[0]); el.value = ''; } break;
    case 'weight': case 'reps': case 'rpe': {
      // Werte beim Verlassen normalisieren (z. B. "60,0" → "60")
      const { set } = findSet(el.dataset.entry, el.dataset.set);
      if (set) { const n = num(el.value); if (n != null) { set[field] = field === 'reps' ? Math.max(0, Math.round(n)) : n; el.value = inputVal(set[field]); save(); } }
      break;
    }
    default: break;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  if (kind === 'exercise') saveExerciseForm(form);
  else if (kind === 'routine') saveRoutineForm();
  else if (kind === 'prompt') { const v = $('#prompt-input').value; if (modal && modal.onOk) modal.onOk(v); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal) closeModal();
  // Enter in Satz-Eingaben: zum nächsten Feld springen
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('set-input')) {
    e.preventDefault();
    const inputs = $$('.set-input');
    const i = inputs.indexOf(e.target);
    if (i >= 0 && inputs[i + 1]) inputs[i + 1].focus(); else e.target.blur();
  }
});

// Hintergrund-Tab: Ruhe-Timer nachholen, falls das Gerät geschlafen hat
document.addEventListener('visibilitychange', () => { if (!document.hidden && rest.endsAt) tickRest(); });

/* ---------- Start ---------- */
applyTheme();
render();
syncClock();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline-Modus optional */ }); });
}
})();
