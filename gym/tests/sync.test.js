/* Tests für Merge-Logik und Sync-Engine. Ausführen mit: node gym/tests/sync.test.js */
'use strict';
const assert = require('assert');
const S = require('../sync.js');

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('✓ ' + name); },
    (err) => { console.error('✗ ' + name + '\n  ' + (err.stack || err.message)); process.exitCode = 1; });
}
const T0 = new Date('2026-03-01T10:00:00Z').getTime();
const at = (min) => new Date(T0 + min * 60000).toISOString();
const ex = (id, name, min) => ({ id, name, muscle: 'Brust', equipment: 'barbell', repMin: 8, repMax: 12, sets: 3, increment: 2.5, createdAt: at(0), updatedAt: at(min) });
const wo = (id, min) => ({ id, name: 'Training', startedAt: at(min - 60), finishedAt: at(min), entries: [], updatedAt: at(min) });
const doc = (o) => Object.assign({ format: S.DOC_FORMAT, version: 2, updatedAt: at(0), device: 'd', profile: { name: 'A', updatedAt: at(0) }, exercises: [], routines: [], workouts: [], tombstones: [] }, o);
const ids = (list) => list.map((e) => e.id).sort();

(async () => {
  await test('Migration ergänzt updatedAt, Tombstones, deviceId und Version', () => {
    const s = S.migrateState({ version: 1, exercises: [{ id: 'a', name: 'X', createdAt: at(1) }], workouts: [{ id: 'w', finishedAt: at(5), entries: [] }] }, T0);
    assert.strictEqual(s.version, 2);
    assert.strictEqual(s.exercises[0].updatedAt, at(1));
    assert.strictEqual(s.workouts[0].updatedAt, at(5));
    assert.deepStrictEqual(s.tombstones, []);
    assert.ok(s.sync.deviceId);
    assert.ok(s.profile.updatedAt);
  });

  await test('Union beim ersten Verbinden: Daten beider Seiten bleiben erhalten', () => {
    const L = doc({ exercises: [ex('a', 'Bank', 1)], workouts: [wo('w1', 10)] });
    const R = doc({ exercises: [ex('b', 'Squat', 2)], workouts: [wo('w2', 20)] });
    const r = S.mergeDocs(L, R);
    assert.deepStrictEqual(ids(r.merged.exercises), ['a', 'b']);
    assert.deepStrictEqual(ids(r.merged.workouts), ['w1', 'w2']);
    assert.ok(r.changedLocal && r.changedRemote);
  });

  await test('Last-Writer-Wins pro Eintrag', () => {
    const L = doc({ exercises: [ex('a', 'Alt', 1)] });
    const R = doc({ exercises: [ex('a', 'Neu', 5)] });
    const r = S.mergeDocs(L, R);
    assert.strictEqual(r.merged.exercises[0].name, 'Neu');
    assert.ok(r.changedLocal); assert.ok(!r.changedRemote);
  });

  await test('Löschmarker verhindert Wiederauferstehung', () => {
    const L = doc({ exercises: [], tombstones: [{ id: 'a', type: 'exercise', deletedAt: at(10) }] });
    const R = doc({ exercises: [ex('a', 'Bank', 1)] });
    const r = S.mergeDocs(L, R);
    assert.deepStrictEqual(r.merged.exercises, []);
    assert.strictEqual(r.merged.tombstones.length, 1);
    assert.ok(r.changedRemote && !r.changedLocal);
  });

  await test('Nach dem Löschen erneut bearbeitet → Eintrag lebt wieder, Marker verschwindet', () => {
    const L = doc({ exercises: [], tombstones: [{ id: 'a', type: 'exercise', deletedAt: at(10) }] });
    const R = doc({ exercises: [ex('a', 'Bank neu', 15)] });
    const r = S.mergeDocs(L, R);
    assert.strictEqual(r.merged.exercises.length, 1);
    assert.strictEqual(r.merged.tombstones.length, 0);
  });

  await test('Löschung eines Trainings wird übertragen', () => {
    const base = doc({ workouts: [wo('w1', 10), wo('w2', 20)] });
    const L = doc({ workouts: [wo('w2', 20)], tombstones: [{ id: 'w1', type: 'workout', deletedAt: at(30) }] });
    const r = S.mergeDocs(L, base);
    assert.deepStrictEqual(ids(r.merged.workouts), ['w2']);
  });

  await test('Merge ist kommutativ und idempotent', () => {
    const A = doc({ exercises: [ex('a', 'A1', 1), ex('c', 'C', 3)], workouts: [wo('w1', 10)], tombstones: [{ id: 'z', type: 'workout', deletedAt: at(2) }] });
    const B = doc({ exercises: [ex('a', 'A2', 1), ex('b', 'B', 2)], workouts: [wo('w2', 20), wo('z', 1)] });
    const ab = S.mergeDocs(A, B).merged, ba = S.mergeDocs(B, A).merged;
    const strip = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.updatedAt; delete c.device; return S.canonical(c); };
    assert.strictEqual(strip(ab), strip(ba));
    const again = S.mergeDocs(ab, B);
    assert.strictEqual(strip(again.merged), strip(ab));
    assert.ok(!again.changedLocal);
  });

  await test('Gleichstand beim updatedAt wird deterministisch aufgelöst', () => {
    const L = doc({ exercises: [ex('a', 'Zebra', 1)] });
    const R = doc({ exercises: [ex('a', 'Apfel', 1)] });
    const n1 = S.mergeDocs(L, R).merged.exercises[0].name;
    const n2 = S.mergeDocs(R, L).merged.exercises[0].name;
    assert.strictEqual(n1, n2);
  });

  await test('Profil: neuere Version gewinnt', () => {
    const L = doc({ profile: { name: 'Alt', unit: 'kg', updatedAt: at(1) } });
    const R = doc({ profile: { name: 'Neu', unit: 'lb', updatedAt: at(2) } });
    assert.strictEqual(S.mergeDocs(L, R).merged.profile.name, 'Neu');
  });

  await test('Unveränderte Seiten melden keine Änderung', () => {
    const L = doc({ exercises: [ex('a', 'Bank', 1)] });
    const r = S.mergeDocs(L, JSON.parse(JSON.stringify(L)));
    assert.ok(!r.changedLocal && !r.changedRemote);
  });

  await test('removeEntity setzt Löschmarker, touch aktualisiert updatedAt', () => {
    const s = S.migrateState({ exercises: [ex('a', 'Bank', 1)] }, T0);
    assert.ok(S.removeEntity(s, 'exercises', 'a', T0 + 1000));
    assert.deepStrictEqual(s.exercises, []);
    assert.strictEqual(s.tombstones[0].type, 'exercise');
    const e = S.touch({ id: 'x' }, T0);
    assert.strictEqual(e.updatedAt, new Date(T0).toISOString());
    // Uhr hängt zurück: Zeitstempel steigt trotzdem
    const late = S.touch({ id: 'y', updatedAt: at(100) }, T0);
    assert.ok(new Date(late.updatedAt) > new Date(at(100)));
    const s2 = S.migrateState({ workouts: [wo('w', 100)] }, T0);
    S.removeEntity(s2, 'workouts', 'w', T0);
    assert.ok(new Date(s2.tombstones[0].deletedAt) > new Date(at(100)), 'Löschmarker muss nach updatedAt liegen');
  });

  await test('Base64 ⇄ UTF-8 mit Umlauten und Emoji', () => {
    const text = 'Kniebeuge – Übung 💪 „test“';
    assert.strictEqual(S.base64ToUtf8(S.utf8ToBase64(text)), text);
    const big = 'ä'.repeat(100000);
    assert.strictEqual(S.base64ToUtf8(S.utf8ToBase64(big)), big);
  });

  /* ---- Engine mit simuliertem GitHub ---- */
  function fakeGitHub(opts) {
    const o = Object.assign({ token: 'tok', file: null, sha: null, fail: null }, opts || {});
    let n = 0;
    const log = [];
    const fetch = async (url, init) => {
      init = init || {};
      log.push((init.method || 'GET') + ' ' + url);
      const auth = init.headers && init.headers.Authorization;
      const res = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
      if (o.fail === 'network') throw new TypeError('Failed to fetch');
      if (auth !== 'Bearer ' + o.token) return res(401, { message: 'Bad credentials' });
      if (o.fail === 403) return res(403, { message: 'Resource not accessible by personal access token' });
      if (/\/repos\/me\/data$/.test(url)) return res(200, { default_branch: 'main', private: true, permissions: { push: o.readonly ? false : true, pull: true } });
      if (/\/repos\/me\/data\/branches\//.test(url)) return res(/\/main$/.test(url) ? 200 : 404, {});
      if (!/\/repos\/me\/data\/contents\//.test(url)) return res(404, { message: 'Not Found' });
      if (!init.method || init.method === 'GET') {
        if (o.file == null) return res(404, { message: 'Not Found' });
        const b64 = Buffer.from(o.file, 'utf8').toString('base64');
        if (init.headers.Accept === 'application/vnd.github.raw+json') return { status: 200, ok: true, text: async () => o.file };
        if (o.large) return res(200, { sha: o.sha, encoding: 'none', content: '', size: 2e6 });
        return res(200, { sha: o.sha, encoding: 'base64', content: b64 });
      }
      const body = JSON.parse(init.body);
      if (o.file != null && body.sha !== o.sha) return res(409, { message: 'is at ' + o.sha + ' but expected ' + body.sha });
      if (o.file == null && body.sha) return res(422, { message: 'sha wasn\'t supplied' });
      o.file = Buffer.from(body.content, 'base64').toString('utf8');
      o.sha = 'sha' + (++n);
      return res(o.file ? 200 : 201, { content: { sha: o.sha } });
    };
    return { o, fetch, log };
  }
  function device(name, gh, data) {
    const state = S.migrateState(Object.assign({ profile: { name }, sync: { enabled: true, provider: 'github', token: 'tok', owner: 'me', repo: 'data', path: 'gym/data.json' } }, data || {}), T0);
    const events = [];
    const engine = S.createEngine({ getState: () => state, persist: () => {}, onChange: (i) => events.push(i), fetch: gh.fetch, debounceMs: 1, now: () => T0 + 1000 });
    return { state, engine, events };
  }

  await test('Erster Push legt die Datei an', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh, { exercises: [ex('a', 'Bank', 1)] });
    assert.strictEqual(await A.engine.run('test'), true);
    assert.ok(gh.o.file && JSON.parse(gh.o.file).exercises.length === 1);
    assert.strictEqual(A.state.sync.lastSha, gh.o.sha);
    assert.strictEqual(A.engine.status().state, 'ok');
  });

  await test('Zweites Gerät übernimmt Daten und ergänzt eigene', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh, { exercises: [ex('a', 'Bank', 1)], workouts: [wo('w1', 10)] });
    await A.engine.run();
    const B = device('B', gh, { exercises: [ex('b', 'Squat', 2)] });
    await B.engine.run();
    assert.deepStrictEqual(ids(B.state.exercises), ['a', 'b']);
    assert.deepStrictEqual(ids(B.state.workouts), ['w1']);
    await A.engine.run();
    assert.deepStrictEqual(ids(A.state.exercises), ['a', 'b']);
    const remote = JSON.parse(gh.o.file);
    assert.deepStrictEqual(ids(remote.exercises), ['a', 'b']);
  });

  await test('Konflikt (veraltetes sha) wird durch erneutes Laden gelöst, nichts geht verloren', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh, { workouts: [wo('w1', 10)] });
    await A.engine.run();
    const B = device('B', gh, { workouts: [wo('w2', 20)] });
    // B lädt, aber bevor B schreibt, schreibt A ein neues Training → sha veraltet
    const origFetch = gh.fetch;
    let injected = false;
    const racing = async (url, init) => {
      if (!injected && init && init.method === 'PUT') {
        injected = true;
        A.state.workouts.push(wo('w3', 30)); S.touch(A.state.workouts[A.state.workouts.length - 1], T0 + 5000);
        await A.engine.run();
      }
      return origFetch(url, init);
    };
    B.engine = S.createEngine({ getState: () => B.state, persist: () => {}, onChange: () => {}, fetch: racing, debounceMs: 1, now: () => T0 + 9000 });
    assert.strictEqual(await B.engine.run(), true);
    const remote = JSON.parse(gh.o.file);
    assert.deepStrictEqual(ids(remote.workouts), ['w1', 'w2', 'w3']);
    assert.deepStrictEqual(ids(B.state.workouts), ['w1', 'w2', 'w3']);
  });

  await test('Löschung auf Gerät A kommt bei Gerät B an', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh, { workouts: [wo('w1', 10), wo('w2', 20)] });
    await A.engine.run();
    const B = device('B', gh);
    await B.engine.run();
    assert.deepStrictEqual(ids(B.state.workouts), ['w1', 'w2']);
    S.removeEntity(A.state, 'workouts', 'w1', T0 + 60000);
    await A.engine.run();
    await B.engine.run();
    assert.deepStrictEqual(ids(B.state.workouts), ['w2']);
  });

  await test('Ungültiger Token → Status error mit verständlicher Meldung', async () => {
    const gh = fakeGitHub({ token: 'other' });
    const A = device('A', gh);
    assert.strictEqual(await A.engine.run(), false);
    assert.strictEqual(A.engine.status().state, 'error');
    assert.ok(/401/.test(A.engine.status().message));
    assert.ok(A.state.sync.lastError);
  });

  await test('Netzwerkfehler → Status offline, Daten unverändert', async () => {
    const gh = fakeGitHub({ fail: 'network' });
    const A = device('A', gh, { workouts: [wo('w1', 10)] });
    assert.strictEqual(await A.engine.run(), false);
    assert.strictEqual(A.engine.status().state, 'offline');
    assert.strictEqual(A.state.workouts.length, 1);
  });

  await test('Große Datei (>1 MB) wird über die Rohfassung geladen', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh, { workouts: [wo('w1', 10)] });
    await A.engine.run();
    gh.o.large = true;
    const B = device('B', gh);
    await B.engine.run();
    assert.deepStrictEqual(ids(B.state.workouts), ['w1']);
    assert.ok(gh.log.some((l) => l.startsWith('GET')));
  });

  await test('Fremde Datei am Pfad wird nicht überschrieben', async () => {
    const gh = fakeGitHub({ file: JSON.stringify({ hello: 'world' }), sha: 'x' });
    const A = device('A', gh, { workouts: [wo('w1', 10)] });
    assert.strictEqual(await A.engine.run(), false);
    assert.strictEqual(JSON.parse(gh.o.file).hello, 'world');
    assert.ok(/Format/.test(A.engine.status().message));
  });

  await test('Sync deaktiviert → run meldet off und ruft GitHub nicht auf', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh);
    A.state.sync.enabled = false;
    assert.strictEqual(await A.engine.run(), false);
    assert.strictEqual(gh.log.length, 0);
  });

  await test('Training, das WÄHREND des Abgleichs beendet wird, geht nicht verloren', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh, { workouts: [wo('w1', 10)] });
    await A.engine.run();
    const B = device('B', gh);
    const origFetch = gh.fetch;
    let injected = false;
    const racing = async (url, init) => {
      const res = await origFetch(url, init);
      if (!injected && (!init || !init.method || init.method === 'GET')) {
        injected = true; // Antwort auf den GET ist da, doch bevor sie verarbeitet wird, wird ein Training beendet
        B.state.workouts.push(wo('w9', 90)); B.engine.schedule();
      }
      return res;
    };
    B.engine = S.createEngine({ getState: () => B.state, persist: () => {}, onChange: () => {}, fetch: racing, debounceMs: 1, now: () => T0 + 9000 });
    await B.engine.run();
    assert.deepStrictEqual(ids(B.state.workouts), ['w1', 'w9']);
    assert.deepStrictEqual(ids(JSON.parse(gh.o.file).workouts), ['w1', 'w9']);
  });

  await test('Änderung während des Hochladens hält "dirty" und löst einen weiteren Lauf aus', async () => {
    const gh = fakeGitHub();
    const B = device('B', gh, { workouts: [wo('w1', 10)] });
    const origFetch = gh.fetch;
    let injected = false;
    const racing = async (url, init) => {
      if (!injected && init && init.method === 'PUT') { injected = true; B.state.workouts.push(wo('w2', 20)); B.engine.schedule(); }
      return origFetch(url, init);
    };
    B.engine = S.createEngine({ getState: () => B.state, persist: () => {}, onChange: () => {}, fetch: racing, debounceMs: 1, now: () => T0 + 9000 });
    await B.engine.run();
    assert.strictEqual(B.state.sync.dirty, true);
    await new Promise((r) => setTimeout(r, 600)); // der nachgelagerte Lauf (500 ms)
    assert.strictEqual(B.state.sync.dirty, false);
    assert.deepStrictEqual(ids(JSON.parse(gh.o.file).workouts), ['w1', 'w2']);
  });

  await test('Gleiches Datum → gleiche kanonische Reihenfolge auf beiden Seiten', () => {
    const a = wo('a', 10), b = wo('b', 10);
    const L = doc({ workouts: [a, b] }), R = doc({ workouts: [b, a] });
    const r = S.mergeDocs(L, R);
    assert.ok(!r.changedLocal && !r.changedRemote);
  });

  await test('422 ohne sha-Bezug ist ein Fehler, kein Konflikt', async () => {
    const gh = fakeGitHub();
    const origFetch = gh.fetch;
    gh.fetch = async (url, init) => (init && init.method === 'PUT') ? { status: 422, ok: false, text: async () => JSON.stringify({ message: 'Validation Failed' }) } : origFetch(url, init);
    const A = device('A', gh, { workouts: [wo('w1', 10)] });
    assert.strictEqual(await A.engine.run(), false);
    assert.strictEqual(A.engine.status().state, 'error');
    assert.ok(/422/.test(A.engine.status().message));
  });

  await test('Vorübergehender Fehler löst Wiederholung mit Backoff aus', async () => {
    const gh = fakeGitHub();
    const origFetch = gh.fetch;
    let calls = 0;
    gh.fetch = async (url, init) => { calls++; if (calls <= 1) return { status: 500, ok: false, text: async () => '{}' }; return origFetch(url, init); };
    const state = S.migrateState({ sync: { enabled: true, provider: 'github', token: 'tok', owner: 'me', repo: 'data', path: 'gym/data.json' }, workouts: [wo('w1', 10)] }, T0);
    const engine = S.createEngine({ getState: () => state, persist: () => {}, onChange: () => {}, fetch: gh.fetch, debounceMs: 1, backoffBaseMs: 20, now: () => T0 + 1000 });
    assert.strictEqual(await engine.run(), false);
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(engine.status().state, 'ok');
    assert.ok(gh.o.file);
  });

  await test('Backup-Import mit Exportdatum lässt gelöschte Einträge gelöscht', () => {
    // Lokal wurde w1 bei Minute 50 gelöscht; ein Backup von Minute 20 enthält w1 ohne updatedAt
    const local = S.migrateState({ workouts: [], tombstones: [{ id: 'w1', type: 'workout', deletedAt: at(50) }] }, T0);
    const backup = S.migrateState({ workouts: [{ id: 'w1', name: 'Alt', startedAt: at(0), finishedAt: at(10), entries: [] }] }, new Date(at(20)).getTime());
    const r = S.mergeDocs(S.buildDoc(local), S.buildDoc(backup));
    assert.deepStrictEqual(r.merged.workouts, []);
  });

  await test('ID "__proto__" geht beim Merge nicht verloren', () => {
    const L = doc({ exercises: [ex('__proto__', 'Seltsam', 1), ex('ok', 'Ok', 1)] });
    const r = S.mergeDocs(L, doc({}));
    assert.deepStrictEqual(ids(r.merged.exercises), ['__proto__', 'ok']);
  });

  await test('Kaputte oder manipulierte Einträge aus der Cloud werden verworfen bzw. typisiert', () => {
    const R = doc({
      workouts: [{ id: 'c', updatedAt: at(99) }, { id: 'ok', name: 42, startedAt: at(0), finishedAt: at(5), updatedAt: at(5), entries: [{ exerciseName: 'a', sets: [{ weight: '60', reps: '<img src=x>' }, { weight: 'x', reps: '8', rpe: '7,5' }] }] }],
      exercises: [{ id: 'e1', name: '<b>x</b>', repMin: '8', repMax: 'abc', sets: 3, updatedAt: at(1) }, { id: null, name: 'ohne id' }, { id: 'e2', updatedAt: at(1) }],
      routines: [{ id: 'r1', name: 'Plan', exerciseIds: 'nicht-array', updatedAt: at(1) }],
      profile: { name: 'Remote', unit: '<img src=x onerror=alert(1)>', restSeconds: 'abc', trackRpe: 'yes', evil: 1, updatedAt: at(50) },
    });
    const L = doc({ profile: { name: 'Lokal', unit: 'lb', restSeconds: 120, updatedAt: at(1) } });
    const r = S.mergeDocs(L, R);
    assert.deepStrictEqual(ids(r.merged.workouts), ['ok']);
    const w = r.merged.workouts[0];
    assert.strictEqual(w.name, '42');
    assert.deepStrictEqual(w.entries[0].sets.map((x) => [x.weight, x.reps, x.rpe]), [[60, 0, undefined], [0, 8, 7.5]]);
    assert.deepStrictEqual(ids(r.merged.exercises), ['e1']);
    assert.strictEqual(r.merged.exercises[0].name, '<b>x</b>'); // Text bleibt Text, die Anzeige escaped
    assert.strictEqual(r.merged.exercises[0].repMin, 8);
    assert.strictEqual('repMax' in r.merged.exercises[0], false);
    assert.deepStrictEqual(r.merged.routines[0].exerciseIds, []);
    assert.strictEqual(r.merged.profile.unit, 'lb');      // ungültige Einheit → lokaler Wert
    assert.strictEqual(r.merged.profile.restSeconds, 120);
    assert.strictEqual(r.merged.profile.trackRpe, true);
    assert.strictEqual('evil' in r.merged.profile, false);
  });

  await test('Saubere Dokumente bleiben durch die Validierung unverändert (kein Dauer-Push)', () => {
    const L = doc({ exercises: [ex('a', 'Bank', 1)], workouts: [{ id: 'w', name: 'T', startedAt: at(0), finishedAt: at(5), updatedAt: at(5), entries: [{ exerciseId: 'a', exerciseName: 'Bank', note: '', sets: [{ weight: 60, reps: 10, rpe: null, warmup: false, done: true }] }] }] });
    const r = S.mergeDocs(L, JSON.parse(JSON.stringify(L)));
    assert.ok(!r.changedLocal && !r.changedRemote);
  });

  await test('Verbindungstest: fehlendes Repository oder fehlendes Schreibrecht werden erkannt', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh);
    await assert.rejects(A.engine.test({ token: 'tok', owner: 'me', repo: 'nope', path: 'x.json' }), /404/);
    gh.o.readonly = true;
    await assert.rejects(A.engine.test({ token: 'tok', owner: 'me', repo: 'data', path: 'x.json' }), /403/);
    gh.o.readonly = false;
    await assert.rejects(A.engine.test({ token: 'tok', owner: 'me', repo: 'data', path: 'x.json', branch: 'nix' }), /Branch/);
    const ok = await A.engine.test({ token: 'tok', owner: 'me', repo: 'data', path: 'x.json', branch: 'main' });
    assert.strictEqual(ok.exists, false);
  });

  await test('Dateipfad mit ".." wird abgelehnt, kein Request außerhalb von /contents/', async () => {
    const gh = fakeGitHub();
    const A = device('A', gh, { workouts: [wo('w1', 10)] });
    A.state.sync.path = '../../user';
    assert.strictEqual(await A.engine.run(), false);
    assert.ok(/Dateipfad/.test(A.engine.status().message), A.engine.status().message);
    assert.ok(gh.log.every((l) => l.includes('/contents/') || /\/repos\/me\/data$/.test(l)) || gh.log.length === 0, gh.log.join('\n'));
  });

  await test('Profil-Edit auf dem Gerät mit zurückhängender Uhr setzt sich durch', () => {
    const remote = doc({ profile: { name: 'Laptop', unit: 'lb', updatedAt: at(10) } });
    const local = S.migrateState({ profile: { name: 'Laptop', unit: 'lb', updatedAt: at(10) } }, T0);
    S.touch(local.profile, new Date(at(5)).getTime()); // lokale Uhr hängt 5 Minuten hinterher
    local.profile.unit = 'kg';
    const r = S.mergeDocs(S.buildDoc(local, T0), remote);
    assert.strictEqual(r.merged.profile.unit, 'kg');
    assert.ok(r.changedRemote && !r.changedLocal);
  });

  console.log('\n' + passed + ' Tests bestanden' + (process.exitCode ? ', es gab Fehler' : ''));
})();
