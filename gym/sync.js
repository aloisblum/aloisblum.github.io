/*
 * sync.js — Datensicherung & Synchronisation des Gym Trackers
 *
 * Zwei Teile:
 *  1. Reine Funktionen (auch in Node testbar): Migration, Zusammenführen
 *     zweier Datenstände (Merge), Dokumentaufbau, Base64/UTF-8.
 *  2. Sync-Engine für den Browser: hält EINE JSON-Datei in einem privaten
 *     GitHub-Repository des Nutzers auf dem Stand aller Geräte.
 *
 * Merge-Prinzip: Jede Übung, jeder Plan und jedes Training trägt ein
 * updatedAt. Beim Zusammenführen gewinnt pro Eintrag die neuere Version
 * (Last-Writer-Wins). Löschungen hinterlassen einen Löschmarker (Tombstone),
 * damit ein anderes Gerät den Eintrag nicht wieder "auferstehen" lässt.
 * Gleichstände werden deterministisch aufgelöst, damit alle Geräte auf
 * denselben Stand konvergieren.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Sync = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DOC_FORMAT = 'gym-tracker-sync';
  var DOC_VERSION = 2;
  var ENTITY_TYPES = ['exercises', 'routines', 'workouts'];
  var LOCAL_PROFILE_KEYS = ['theme']; // Geräteeinstellungen, die nicht synchronisiert werden
  var TYPE_OF = { exercises: 'exercise', routines: 'routine', workouts: 'workout' };

  /* ---------- Hilfsfunktionen ---------- */

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // Kanonische JSON-Darstellung (sortierte Schlüssel) für stabile Vergleiche
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (isObject(value)) {
      return '{' + Object.keys(value).sort().map(function (k) {
        return JSON.stringify(k) + ':' + canonical(value[k]);
      }).join(',') + '}';
    }
    return value === undefined ? 'null' : JSON.stringify(value);
  }

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function ts(v) {
    var t = v ? new Date(v).getTime() : NaN;
    return isNaN(t) ? 0 : t;
  }

  function nowIso(now) { return new Date(now || Date.now()).toISOString(); }

  function randomId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
  }

  // UTF-8 ⇄ Base64 (btoa/atob verarbeiten nur Latin-1, deshalb der Umweg über Bytes)
  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    var bin = atob(String(b64).replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- Migration ---------- */

  // Hebt einen Datenstand auf Version 2: updatedAt pro Eintrag, Tombstones, Metadaten.
  function migrateState(state, now) {
    var s = state || {};
    var stamp = nowIso(now);
    s.version = 2;
    s.profile = isObject(s.profile) ? s.profile : {};
    if (!s.profile.updatedAt) s.profile.updatedAt = stamp;
    ENTITY_TYPES.forEach(function (type) {
      if (!Array.isArray(s[type])) s[type] = [];
      s[type] = s[type].filter(function (e) { return isObject(e) && e.id; });
      s[type].forEach(function (e) {
        if (!e.updatedAt) e.updatedAt = e.finishedAt || e.createdAt || stamp;
      });
    });
    if (!Array.isArray(s.tombstones)) s.tombstones = [];
    s.tombstones = s.tombstones.filter(function (t) { return isObject(t) && t.id && t.type && t.deletedAt; });
    if (!isObject(s.sync)) s.sync = {};
    if (!s.sync.deviceId) s.sync.deviceId = randomId();
    return s;
  }

  /* ---------- Dokument (das, was synchronisiert wird) ---------- */

  function buildDoc(state, now) {
    return {
      format: DOC_FORMAT,
      version: DOC_VERSION,
      updatedAt: nowIso(now),
      device: state.sync && state.sync.deviceId || null,
      profile: (function () {
        var p = clone(state.profile) || {};
        LOCAL_PROFILE_KEYS.forEach(function (k) { delete p[k]; });
        return p;
      }()),
      exercises: clone(state.exercises) || [],
      routines: clone(state.routines) || [],
      workouts: clone(state.workouts) || [],
      tombstones: clone(state.tombstones) || [],
    };
  }

  function isDoc(doc) {
    return isObject(doc) && doc.format === DOC_FORMAT && ENTITY_TYPES.every(function (t) { return Array.isArray(doc[t]); });
  }

  // Übernimmt die synchronisierten Teile eines Dokuments in den lokalen Zustand
  function applyDoc(state, doc) {
    var incoming = clone(doc.profile) || {};
    LOCAL_PROFILE_KEYS.forEach(function (k) { delete incoming[k]; });
    state.profile = Object.assign({}, state.profile || {}, incoming);
    ENTITY_TYPES.forEach(function (t) { state[t] = clone(doc[t]) || []; });
    state.tombstones = clone(doc.tombstones) || [];
    return state;
  }

  /* ---------- Merge ---------- */

  function indexById(list) {
    var map = {};
    (list || []).forEach(function (e) { if (e && e.id) map[e.id] = e; });
    return map;
  }

  // Deterministischer Gewinner bei gleichem updatedAt: die "größere" kanonische Form
  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    var ta = ts(a.updatedAt), tb = ts(b.updatedAt);
    if (ta !== tb) return ta > tb ? a : b;
    return canonical(a) >= canonical(b) ? a : b;
  }

  function sortEntities(type, list) {
    if (type === 'workouts') {
      return list.sort(function (a, b) { return ts(b.finishedAt || b.startedAt) - ts(a.finishedAt || a.startedAt); });
    }
    return list.sort(function (a, b) { return ts(a.createdAt) - ts(b.createdAt) || String(a.id).localeCompare(String(b.id)); });
  }

  /**
   * Führt zwei Dokumente zusammen.
   * @returns {{ merged, changedLocal, changedRemote }}
   *   changedLocal  – der lokale Stand muss aktualisiert werden
   *   changedRemote – der entfernte Stand muss aktualisiert werden (Push nötig)
   */
  function mergeDocs(local, remote) {
    var L = local || buildDoc({}), R = remote || buildDoc({});
    var merged = { format: DOC_FORMAT, version: DOC_VERSION, updatedAt: null, device: null, tombstones: [] };

    // Löschmarker: pro (typ,id) der späteste
    var tomb = {};
    [].concat(L.tombstones || [], R.tombstones || []).forEach(function (t) {
      if (!t || !t.id || !t.type) return;
      var key = t.type + ':' + t.id;
      if (!tomb[key] || ts(t.deletedAt) > ts(tomb[key].deletedAt)) tomb[key] = clone(t);
    });

    ENTITY_TYPES.forEach(function (type) {
      var li = indexById(L[type]), ri = indexById(R[type]);
      var ids = {};
      Object.keys(li).forEach(function (id) { ids[id] = true; });
      Object.keys(ri).forEach(function (id) { ids[id] = true; });
      var out = [];
      Object.keys(ids).forEach(function (id) {
        var winner = pickNewer(li[id], ri[id]);
        var key = TYPE_OF[type] + ':' + id;
        var t = tomb[key];
        if (t && ts(t.deletedAt) >= ts(winner.updatedAt)) return;          // gelöscht bleibt gelöscht
        if (t) delete tomb[key];                                            // nach dem Löschen erneut bearbeitet → lebt wieder
        out.push(clone(winner));
      });
      merged[type] = sortEntities(type, out);
    });

    merged.tombstones = Object.keys(tomb).map(function (k) { return tomb[k]; }).sort(function (a, b) {
      return ts(a.deletedAt) - ts(b.deletedAt) || (a.type + a.id).localeCompare(b.type + b.id);
    });
    merged.profile = clone(pickNewer(L.profile || {}, R.profile || {})) || {};

    var sameAs = function (doc) {
      return ENTITY_TYPES.every(function (t) { return canonical(merged[t]) === canonical(doc[t] || []); }) &&
        canonical(merged.tombstones) === canonical(doc.tombstones || []) &&
        canonical(merged.profile) === canonical(doc.profile || {});
    };
    var changedLocal = !sameAs(L);
    var changedRemote = !sameAs(R);
    merged.updatedAt = changedRemote ? null : R.updatedAt || null; // wird beim Push gesetzt
    merged.device = L.device || R.device || null;
    return { merged: merged, changedLocal: changedLocal, changedRemote: changedRemote };
  }

  /* ---------- Löschen mit Marker ---------- */

  // Zeitstempel steigen immer streng an – auch wenn die Geräteuhr zurückhängt
  function monotonic(previous, now) {
    var t = now || Date.now();
    var prev = ts(previous);
    return new Date(t > prev ? t : prev + 1).toISOString();
  }

  function removeEntity(state, type, id, now) {
    var list = state[type] || [];
    var entity = list.filter(function (e) { return e.id === id; })[0];
    state[type] = list.filter(function (e) { return e.id !== id; });
    if (!Array.isArray(state.tombstones)) state.tombstones = [];
    state.tombstones = state.tombstones.filter(function (t) { return !(t.type === TYPE_OF[type] && t.id === id); });
    state.tombstones.push({ id: id, type: TYPE_OF[type], deletedAt: monotonic(entity && entity.updatedAt, now) });
    return !!entity;
  }

  function touch(entity, now) { entity.updatedAt = monotonic(entity.updatedAt, now); return entity; }

  /* ---------- GitHub-Anbieter ---------- */

  function githubProvider(cfg, fetchImpl) {
    var f = fetchImpl || (typeof fetch === 'function' ? fetch.bind(self) : null);
    var API = 'https://api.github.com';
    function url() {
      var path = String(cfg.path || 'gym-tracker/data.json').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
      return API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/' + path;
    }
    function headers(accept) {
      return {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
    }
    function err(status, message, body) {
      var e = new Error(message);
      e.status = status;
      e.body = body;
      return e;
    }
    function describe(status, body) {
      if (status === 401) return 'Token ungültig oder abgelaufen (401).';
      if (status === 403) {
        var msg = body && body.message ? String(body.message) : '';
        if (/rate limit/i.test(msg)) return 'GitHub-Limit erreicht, bitte später erneut versuchen (403).';
        return 'Keine Berechtigung – der Token braucht „Contents: Read and write“ für dieses Repository (403).';
      }
      if (status === 404) return 'Repository oder Branch nicht gefunden, oder der Token hat keinen Zugriff (404).';
      if (status === 409 || status === 422) return 'Konflikt mit einem anderen Gerät, wird erneut versucht.';
      return 'GitHub antwortete mit Status ' + status + '.';
    }
    async function parse(res) {
      var text = await res.text();
      try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
    }
    return {
      name: 'github',
      // Liefert { exists, sha, doc }
      load: async function () {
        var q = cfg.branch ? '?ref=' + encodeURIComponent(cfg.branch) : '';
        var res = await f(url() + q, { headers: headers(), cache: 'no-store' });
        if (res.status === 404) return { exists: false, sha: null, doc: null };
        var body = await parse(res);
        if (!res.ok) throw err(res.status, describe(res.status, body), body);
        var text;
        if (body && body.encoding === 'base64' && typeof body.content === 'string') {
          text = base64ToUtf8(body.content);
        } else {
          // Dateien über 1 MB liefern keinen Inhalt inline → Rohfassung anfordern
          var raw = await f(url() + q, { headers: headers('application/vnd.github.raw+json'), cache: 'no-store' });
          if (!raw.ok) throw err(raw.status, describe(raw.status, null), null);
          text = await raw.text();
        }
        var doc;
        try { doc = JSON.parse(text); } catch { throw err(0, 'Die Datei im Repository ist kein gültiges JSON.'); }
        return { exists: true, sha: body.sha, doc: doc };
      },
      // Schreibt das Dokument; sha = letzter bekannter Stand (null beim Anlegen). Liefert neues sha.
      save: async function (doc, sha, message) {
        var payload = { message: message || 'Gym Tracker Sync', content: utf8ToBase64(JSON.stringify(doc)) };
        if (sha) payload.sha = sha;
        if (cfg.branch) payload.branch = cfg.branch;
        var res = await f(url(), { method: 'PUT', headers: Object.assign(headers(), { 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
        var body = await parse(res);
        if (res.status === 409 || res.status === 422) { var c = err(res.status, describe(res.status, body), body); c.conflict = true; throw c; }
        if (!res.ok) throw err(res.status, describe(res.status, body), body);
        return body && body.content && body.content.sha || null;
      },
    };
  }

  /* ---------- Sync-Engine ---------- */

  /**
   * createEngine({
   *   getState: () => state,                  // aktueller lokaler Zustand (wird direkt verändert)
   *   persist: () => void,                    // lokalen Zustand speichern (ohne erneut sync anzustoßen)
   *   onChange: (info) => void,               // Status-/Datenänderung → UI aktualisieren
   *   fetch: optional fetch-Implementierung,  // für Tests
   *   now: optional () => number,
   * })
   */
  function createEngine(opts) {
    var getState = opts.getState;
    var persist = opts.persist || function () {};
    var onChange = opts.onChange || function () {};
    var now = opts.now || function () { return Date.now(); };
    var fetchImpl = opts.fetch;
    var status = { state: 'off', message: '', lastSyncAt: null, pending: false };
    var timer = null, running = null, queued = false;
    var DEBOUNCE_MS = opts.debounceMs != null ? opts.debounceMs : 4000;
    var MAX_RETRIES = 3;

    function cfg() { var s = getState(); return s.sync || {}; }
    function enabled() { var c = cfg(); return !!(c.enabled && c.provider === 'github' && c.token && c.owner && c.repo); }
    function provider() { return githubProvider(cfg(), fetchImpl); }
    function setStatus(state, message) {
      status.state = state; status.message = message || '';
      onChange({ status: status });
    }
    function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

    // Ein kompletter Abgleich: laden → zusammenführen → lokal übernehmen → bei Bedarf hochladen
    async function syncOnce(reason) {
      var s = getState();
      var p = provider();
      var local = buildDoc(s, now());
      var remote = await p.load();
      var res = mergeDocs(local, remote.exists && isDoc(remote.doc) ? remote.doc : null);
      if (remote.exists && !isDoc(remote.doc)) {
        var e = new Error('Die Datei im Repository hat ein unbekanntes Format. Bitte einen anderen Dateipfad wählen.');
        e.status = 0; throw e;
      }
      var dataChanged = false;
      if (res.changedLocal) { applyDoc(s, res.merged); dataChanged = true; }
      var sha = remote.sha;
      if (res.changedRemote || !remote.exists) {
        var doc = res.merged; doc.updatedAt = nowIso(now()); doc.device = s.sync.deviceId;
        sha = await p.save(doc, remote.sha, 'Gym Tracker: Sync (' + (reason || 'auto') + ')');
      }
      s.sync.lastSha = sha;
      s.sync.lastSyncAt = nowIso(now());
      s.sync.lastError = null;
      s.sync.dirty = false;
      persist();
      return dataChanged;
    }

    async function run(reason) {
      if (!enabled()) { setStatus('off'); return false; }
      if (running) { queued = true; return running; }
      if (!online()) { setStatus('offline', 'Offline – wird synchronisiert, sobald Verbindung besteht.'); return false; }
      setStatus('syncing', 'Synchronisiere …');
      running = (async function () {
        var attempt = 0, dataChanged = false;
        while (true) {
          try {
            dataChanged = await syncOnce(reason);
            break;
          } catch (e) {
            if (e && e.conflict && attempt < MAX_RETRIES) { attempt++; continue; }
            getState().sync.lastError = e && e.message || String(e);
            persist();
            if (e && (e.status === 401 || e.status === 403 || e.status === 404)) setStatus('error', e.message);
            else if (!online() || (e && e.name === 'TypeError')) setStatus('offline', 'Keine Verbindung zu GitHub – wird später erneut versucht.');
            else setStatus('error', (e && e.message) || 'Synchronisation fehlgeschlagen.');
            return false;
          }
        }
        status.lastSyncAt = getState().sync.lastSyncAt;
        setStatus('ok', '');
        onChange({ status: status, dataChanged: dataChanged });
        return true;
      })();
      try { return await running; }
      finally {
        running = null;
        if (queued) { queued = false; schedule(500); }
      }
    }

    function schedule(ms) {
      if (!enabled()) return;
      var s = getState(); s.sync.dirty = true;
      clearTimeout(timer);
      timer = setTimeout(function () { run('change'); }, ms != null ? ms : DEBOUNCE_MS);
    }

    return {
      run: run,
      schedule: schedule,
      status: function () { return status; },
      enabled: enabled,
      // Verbindung prüfen (ohne lokale Daten zu verändern)
      test: async function (c) {
        var p = githubProvider(c, fetchImpl);
        var r = await p.load();
        return { exists: r.exists, valid: !r.exists || isDoc(r.doc), workouts: r.exists && isDoc(r.doc) ? r.doc.workouts.length : 0 };
      },
      flush: async function (reason) { clearTimeout(timer); return run(reason || 'manual'); },
    };
  }

  return {
    DOC_FORMAT: DOC_FORMAT,
    DOC_VERSION: DOC_VERSION,
    canonical: canonical,
    migrateState: migrateState,
    buildDoc: buildDoc,
    isDoc: isDoc,
    applyDoc: applyDoc,
    mergeDocs: mergeDocs,
    removeEntity: removeEntity,
    touch: touch,
    utf8ToBase64: utf8ToBase64,
    base64ToUtf8: base64ToUtf8,
    githubProvider: githubProvider,
    createEngine: createEngine,
  };
}));
