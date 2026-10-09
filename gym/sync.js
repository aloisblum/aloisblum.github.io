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

  /* ---------- Validierung: nur typkorrekte Daten gelangen in die App ---------- */
  var TOMB_TYPES = { exercise: true, routine: true, workout: true };
  function str(v) { return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)); }
  function numOr(v, fallback) {
    var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
    return isFinite(n) ? n : fallback;
  }
  function cleanId(v) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null;
  }
  // Koerziert vorhandene Felder, fügt keine hinzu (damit saubere Daten unverändert bleiben)
  function coerce(out, src, key, kind) {
    if (!(key in src)) return;
    var v = src[key];
    if (kind === 'str') out[key] = str(v);
    else if (kind === 'num') { var n = numOr(v, null); if (n === null) delete out[key]; else out[key] = n; }
    else if (kind === 'numOrNull') { out[key] = (v === null || v === undefined || v === '') ? null : numOr(v, null); }
    else if (kind === 'bool') out[key] = !!v;
    else if (kind === 'id') { var id = cleanId(v); out[key] = id; }
  }
  function cleanSet(set) {
    if (!isObject(set)) return null;
    var out = Object.assign({}, set);
    out.weight = numOr(set.weight, 0);
    out.reps = Math.max(0, Math.round(numOr(set.reps, 0)));
    coerce(out, set, 'rpe', 'numOrNull');
    coerce(out, set, 'warmup', 'bool');
    coerce(out, set, 'done', 'bool');
    return out;
  }
  function cleanEntity(type, e) {
    if (!isObject(e)) return null;
    var id = cleanId(e.id);
    if (!id) return null;
    var out = Object.assign({}, e, { id: id });
    ['createdAt', 'updatedAt'].forEach(function (k) { coerce(out, e, k, 'str'); });
    if (type === 'exercises') {
      out.name = str(e.name).slice(0, 120);
      if (!out.name) return null;
      ['muscle', 'equipment', 'notes'].forEach(function (k) { coerce(out, e, k, 'str'); });
      ['repMin', 'repMax', 'sets', 'increment'].forEach(function (k) { coerce(out, e, k, 'num'); });
      coerce(out, e, 'restSeconds', 'numOrNull');
    } else if (type === 'routines') {
      out.name = str(e.name).slice(0, 120);
      if (!out.name) return null;
      out.exerciseIds = Array.isArray(e.exerciseIds) ? e.exerciseIds.map(cleanId).filter(Boolean) : [];
    } else {
      out.name = str(e.name).slice(0, 120) || 'Training';
      ['startedAt', 'finishedAt'].forEach(function (k) { coerce(out, e, k, 'str'); });
      coerce(out, e, 'routineId', 'id');
      if (!Array.isArray(e.entries)) return null;
      out.entries = e.entries.filter(isObject).map(function (en) {
        var o = Object.assign({}, en);
        coerce(o, en, 'id', 'id');
        coerce(o, en, 'exerciseId', 'id');
        ['exerciseName', 'note'].forEach(function (k) { coerce(o, en, k, 'str'); });
        o.sets = Array.isArray(en.sets) ? en.sets.map(cleanSet).filter(Boolean) : [];
        return o;
      });
    }
    return out;
  }
  function cleanList(type, list) {
    return (Array.isArray(list) ? list : []).map(function (e) { return cleanEntity(type, e); }).filter(Boolean);
  }
  function cleanTombstones(list) {
    return (Array.isArray(list) ? list : []).filter(function (t) {
      return isObject(t) && cleanId(t.id) && TOMB_TYPES[t.type] && str(t.deletedAt);
    }).map(function (t) { return { id: cleanId(t.id), type: t.type, deletedAt: str(t.deletedAt) }; });
  }
  // Profil: nur bekannte Felder, ungültige Werte werden durch den bisherigen Wert ersetzt
  function cleanProfile(p, current) {
    var cur = isObject(current) ? current : {};
    var src = isObject(p) ? p : {};
    var out = {};
    if ('name' in src) out.name = str(src.name).slice(0, 80);
    if ('unit' in src) out.unit = (src.unit === 'kg' || src.unit === 'lb') ? src.unit : (cur.unit === 'lb' ? 'lb' : 'kg');
    if ('restSeconds' in src) { var r = numOr(src.restSeconds, null); out.restSeconds = (r !== null && r >= 0) ? Math.round(r) : (numOr(cur.restSeconds, 90)); }
    if ('trackRpe' in src) out.trackRpe = !!src.trackRpe;
    if ('theme' in src) out.theme = src.theme === 'light' ? 'light' : 'dark';
    if ('updatedAt' in src) out.updatedAt = str(src.updatedAt);
    return out;
  }
  function cleanDoc(doc, currentProfile) {
    var d = isObject(doc) ? doc : {};
    var out = Object.assign({}, d);
    ENTITY_TYPES.forEach(function (t) { out[t] = cleanList(t, d[t]); });
    out.tombstones = cleanTombstones(d.tombstones);
    out.profile = cleanProfile(d.profile, currentProfile);
    return out;
  }

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
    s.profile = cleanProfile(s.profile, {});
    if (!s.profile.updatedAt) s.profile.updatedAt = stamp;
    ENTITY_TYPES.forEach(function (type) {
      s[type] = cleanList(type, s[type]);
      s[type].forEach(function (e) {
        if (!e.updatedAt) e.updatedAt = e.finishedAt || e.createdAt || stamp;
      });
    });
    s.tombstones = cleanTombstones(s.tombstones);
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
    var incoming = cleanProfile(doc.profile, state.profile);
    LOCAL_PROFILE_KEYS.forEach(function (k) { delete incoming[k]; });
    state.profile = Object.assign({}, state.profile || {}, incoming);
    ENTITY_TYPES.forEach(function (t) { state[t] = cleanList(t, clone(doc[t])); });
    state.tombstones = cleanTombstones(clone(doc.tombstones));
    return state;
  }

  /* ---------- Merge ---------- */

  function indexById(list) {
    var map = Object.create(null); // prototypfrei: auch eine ID "__proto__" ist ein normaler Schlüssel
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
      return list.sort(function (a, b) {
        return ts(b.finishedAt || b.startedAt) - ts(a.finishedAt || a.startedAt) || String(a.id).localeCompare(String(b.id));
      });
    }
    return list.sort(function (a, b) { return ts(a.createdAt) - ts(b.createdAt) || String(a.id).localeCompare(String(b.id)); });
  }

  /**
   * Führt zwei Dokumente zusammen.
   * @returns {{ merged, changedLocal, changedRemote }}
   *   changedLocal  – der lokale Stand muss aktualisiert werden
   *   changedRemote – der entfernte Stand muss aktualisiert werden (Push nötig)
   */
  function sortTombstones(list) {
    return clone(list || []).sort(function (a, b) {
      return ts(a.deletedAt) - ts(b.deletedAt) || (a.type + a.id).localeCompare(b.type + b.id);
    });
  }

  function mergeDocs(local, remote) {
    var L = cleanDoc(local || buildDoc({}), {});
    var R = cleanDoc(remote || buildDoc({}), L.profile);
    var merged = { format: DOC_FORMAT, version: DOC_VERSION, updatedAt: null, device: null, tombstones: [] };

    // Löschmarker: pro (typ,id) der späteste
    var tomb = Object.create(null);
    [].concat(L.tombstones || [], R.tombstones || []).forEach(function (t) {
      if (!t || !t.id || !t.type) return;
      var key = t.type + ':' + t.id;
      if (!tomb[key] || ts(t.deletedAt) > ts(tomb[key].deletedAt)) tomb[key] = clone(t);
    });

    ENTITY_TYPES.forEach(function (type) {
      var li = indexById(L[type]), ri = indexById(R[type]);
      var ids = Object.create(null);
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

    merged.tombstones = sortTombstones(Object.keys(tomb).map(function (k) { return tomb[k]; }));
    merged.profile = clone(pickNewer(L.profile || {}, R.profile || {})) || {};

    // Vergleich unabhängig von der Reihenfolge der Listen
    var sameAs = function (doc) {
      return ENTITY_TYPES.every(function (t) { return canonical(merged[t]) === canonical(sortEntities(t, clone(doc[t] || []))); }) &&
        canonical(merged.tombstones) === canonical(sortTombstones(doc.tombstones)) &&
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
    function repoUrl() {
      return API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);
    }
    function url() {
      var segments = String(cfg.path || 'gym-tracker/data.json').replace(/^\/+/, '').split('/');
      if (segments.some(function (seg) { return !seg || seg === '.' || seg === '..'; })) {
        var bad = new Error('Ungültiger Dateipfad: „' + cfg.path + '“.'); bad.status = 0; throw bad;
      }
      return repoUrl() + '/contents/' + segments.map(encodeURIComponent).join('/');
    }
    function headers(accept) {
      // Kein X-GitHub-Api-Version-Header: er ist nicht in GitHubs dokumentierten
      // CORS-Allow-Headers; ohne ihn gilt die Standardversion 2022-11-28.
      return {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': accept || 'application/vnd.github+json',
      };
    }
    function err(status, message, body) {
      var e = new Error(message);
      e.status = status;
      e.body = body;
      return e;
    }
    function describe(status, body) {
      var msg = body && body.message ? String(body.message) : '';
      if (status === 401) return 'Token ungültig oder abgelaufen (401) – in den Sync-Einstellungen einen neuen Token eintragen.';
      if (status === 403) {
        if (/rate limit/i.test(msg)) return 'GitHub-Limit erreicht, bitte später erneut versuchen (403).';
        return 'Keine Berechtigung – der Token braucht „Contents: Read and write“ für dieses Repository (403).';
      }
      if (status === 404) return 'Repository oder Branch nicht gefunden, oder der Token hat keinen Zugriff (404).';
      if (status === 409) return 'Konflikt mit einem anderen Gerät, wird erneut versucht.';
      if (status === 422) return /sha/i.test(msg) ? 'Konflikt mit einem anderen Gerät, wird erneut versucht.' : 'GitHub hat die Anfrage abgelehnt (422): ' + (msg || 'ungültige Daten') + '.';
      if (status === 429) return 'GitHub-Limit erreicht, bitte später erneut versuchen (429).';
      return 'GitHub antwortete mit Status ' + status + '.';
    }
    async function parse(res) {
      var text = await res.text();
      try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
    }
    return {
      name: 'github',
      // Prüft Repository, Branch und Schreibrecht (404 beim Dateipfad allein ist mehrdeutig)
      check: async function () {
        var res = await f(repoUrl(), { headers: headers(), cache: 'no-store' });
        var body = await parse(res);
        if (res.status === 404) throw err(404, 'Repository nicht gefunden oder der Token hat keinen Zugriff darauf (404). Prüfe Besitzer/Name und die Repository-Auswahl des Tokens.', body);
        if (!res.ok) throw err(res.status, describe(res.status, body), body);
        if (body && body.permissions && body.permissions.push === false) throw err(403, 'Der Token darf in diesem Repository nicht schreiben – „Contents: Read and write“ fehlt (403).', body);
        if (cfg.branch) {
          var b = await f(repoUrl() + '/branches/' + encodeURIComponent(cfg.branch), { headers: headers(), cache: 'no-store' });
          if (b.status === 404) throw err(404, 'Branch „' + cfg.branch + '“ nicht gefunden (404).', null);
          if (!b.ok) throw err(b.status, describe(b.status, await parse(b)), null);
        }
        return { defaultBranch: body && body.default_branch || null, isPrivate: !!(body && body.private) };
      },
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
        var bodyText = JSON.stringify(payload);
        var init = { method: 'PUT', headers: Object.assign(headers(), { 'Content-Type': 'application/json' }), body: bodyText };
        if (bodyText.length < 60000) init.keepalive = true; // überlebt das Schließen der Seite (Limit 64 KiB)
        var res = await f(url(), init);
        var body = await parse(res);
        var isConflict = res.status === 409 || (res.status === 422 && /sha/i.test(body && body.message ? String(body.message) : ''));
        if (isConflict) { var c = err(res.status, describe(res.status, body), body); c.conflict = true; throw c; }
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
    var timer = null, running = null, queued = false, failures = 0;
    var DEBOUNCE_MS = opts.debounceMs != null ? opts.debounceMs : 4000;
    var MAX_RETRIES = 3;
    var BACKOFF_BASE_MS = opts.backoffBaseMs != null ? opts.backoffBaseMs : 5000;
    var BACKOFF_MAX_MS = 5 * 60 * 1000;

    function cfg() { var s = getState(); return s.sync || {}; }
    function enabled() { var c = cfg(); return !!(c.enabled && c.provider === 'github' && c.token && c.owner && c.repo); }
    function provider() { return githubProvider(cfg(), fetchImpl); }
    function setStatus(state, message) {
      status.state = state; status.message = message || '';
      onChange({ status: status });
    }
    function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

    // Ein kompletter Abgleich: laden → zusammenführen → lokal übernehmen → bei Bedarf hochladen.
    // Der lokale Stand wird ERST NACH dem Laden gelesen, damit Änderungen während der
    // Wartezeit (z. B. ein gerade beendetes Training) nicht überschrieben werden.
    async function syncOnce(reason) {
      var s = getState();
      var p = provider();
      var remote = await p.load();
      if (remote.exists && !isDoc(remote.doc)) {
        var e = new Error('Die Datei im Repository hat ein unbekanntes Format. Bitte einen anderen Dateipfad wählen.');
        e.status = 0; throw e;
      }
      var revAtBuild = s.sync.rev || 0;                 // Stand der lokalen Daten, der jetzt verarbeitet wird
      var local = buildDoc(s, now());
      var res = mergeDocs(local, remote.exists ? remote.doc : null);
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
      // Kamen während des Hochladens neue Änderungen hinzu, bleibt "dirty" und ein weiterer Lauf folgt
      var changedMeanwhile = (s.sync.rev || 0) !== revAtBuild;
      s.sync.dirty = changedMeanwhile;
      persist();
      if (changedMeanwhile) queued = true;
      return dataChanged;
    }

    function transient(e) {
      if (!e) return true;
      if (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 422 || e.status === 0) return false;
      return true; // Netzwerkfehler, 5xx, 429, Konflikte nach Retries
    }
    function armRetry() {
      failures++;
      var delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, failures - 1));
      delay += Math.floor(Math.random() * delay * 0.25);
      timerRun(delay);
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
            if (e && (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 422)) setStatus('error', e.message);
            else if (!online() || (e && e.name === 'TypeError')) setStatus('offline', 'Keine Verbindung zu GitHub – wird später erneut versucht.');
            else setStatus('error', (e && e.message) || 'Synchronisation fehlgeschlagen.');
            if (transient(e)) armRetry();
            return false;
          }
        }
        failures = 0;
        status.lastSyncAt = getState().sync.lastSyncAt;
        setStatus('ok', '');
        onChange({ status: status, dataChanged: dataChanged });
        return true;
      })();
      try { return await running; }
      finally {
        running = null;
        if (queued) { queued = false; timerRun(500); }
      }
    }

    function timerRun(ms) {
      clearTimeout(timer);
      timer = setTimeout(function () { run('change'); }, ms);
      if (timer && typeof timer.unref === 'function') timer.unref(); // hält Node-Prozesse (Tests) nicht am Leben
    }

    // Vom App-Code aufgerufen, wenn sich synchronisierte Daten geändert haben
    function schedule(ms) {
      var s = getState();
      s.sync.rev = (s.sync.rev || 0) + 1;
      if (!enabled()) return;
      s.sync.dirty = true;
      timerRun(ms != null ? ms : DEBOUNCE_MS);
    }

    return {
      run: run,
      schedule: schedule,
      status: function () { return status; },
      enabled: enabled,
      // Verbindung prüfen (ohne lokale Daten zu verändern)
      test: async function (c) {
        var p = githubProvider(c, fetchImpl);
        var info = await p.check();
        var r = await p.load();
        return { exists: r.exists, valid: !r.exists || isDoc(r.doc), workouts: r.exists && isDoc(r.doc) ? r.doc.workouts.length : 0, isPrivate: info.isPrivate };
      },
      flush: async function (reason) { clearTimeout(timer); return run(reason || 'manual'); },
      stop: function () { clearTimeout(timer); timer = null; failures = 0; },
    };
  }

  return {
    DOC_FORMAT: DOC_FORMAT,
    DOC_VERSION: DOC_VERSION,
    canonical: canonical,
    cleanDoc: cleanDoc,
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
