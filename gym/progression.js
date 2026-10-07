/*
 * progression.js — Progressionslogik des Gym Trackers
 *
 * Reine Funktionen ohne DOM-Zugriff, damit die Logik sowohl im Browser
 * (window.Progression) als auch in Node (require) läuft und testbar ist.
 *
 * Grundprinzip: "Doppelte Progression"
 *   1. Pro Übung gibt es einen Wiederholungsbereich (z. B. 8–12), eine
 *      Satzanzahl (z. B. 3) und eine Gewichtsstufe (z. B. 2,5 kg).
 *   2. Solange nicht alle Sätze das obere Ende erreichen, bleibt das Gewicht
 *      gleich und die Wiederholungen werden aufgebaut.
 *   3. Erreichen alle Sätze das obere Ende, wird das Gewicht um eine Stufe
 *      erhöht (bei viel Reserve um zwei Stufen) und wieder am unteren Ende
 *      des Bereichs gestartet.
 *   4. Fällt ein Satz zweimal hintereinander unter das Minimum, wird das
 *      Gewicht um ca. 10 % reduziert (Deload).
 *   5. Stagnieren die Wiederholungen über vier Einheiten beim gleichen
 *      Gewicht, wird ein Plateau erkannt und ebenfalls ein Deload empfohlen.
 *   6. Nach längerer Pause (≥ 21 Tage) wird ein leichterer Wiedereinstieg
 *      empfohlen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Progression = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 86400000;

  function roundToStep(value, step) {
    if (!step || step <= 0) return Math.round(value * 100) / 100;
    var n = Math.round(value / step) * step;
    return Math.round(n * 1000) / 1000;
  }

  // Geschätztes Einwiederholungsmaximum nach Epley
  function e1rm(weight, reps) {
    if (!reps || reps <= 0) return 0;
    if (reps === 1) return weight;
    return weight * (1 + reps / 30);
  }

  function fmt(n, unit) {
    if (n == null || !isFinite(n)) return '–';
    var rounded = Math.round(n * 100) / 100;
    var s = String(rounded).replace('.', ',');
    return unit ? s + ' ' + unit : s;
  }

  function fill(n, value) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(value);
    return out;
  }

  // Alle gültigen Arbeitssätze einer Einheit (keine Aufwärmsätze, nur erledigte)
  function workingSets(session) {
    return (session.sets || [])
      .filter(function (s) {
        return s && s.done !== false && !s.warmup && Number(s.reps) > 0;
      })
      .map(function (s) {
        var rpe = (s.rpe === null || s.rpe === undefined || s.rpe === '') ? null : Number(s.rpe);
        return {
          weight: Number(s.weight) || 0,
          reps: Number(s.reps) || 0,
          rpe: (rpe !== null && isFinite(rpe) && rpe > 0) ? rpe : null
        };
      });
  }

  // Kennzahlen einer Einheit. Das "Arbeitsgewicht" ist das Gewicht, mit dem
  // die meisten Sätze gemacht wurden (bei Gleichstand das schwerere).
  function summarize(session) {
    var sets = workingSets(session);
    if (!sets.length) return null;

    var counts = {};
    sets.forEach(function (s) { counts[s.weight] = (counts[s.weight] || 0) + 1; });
    var workWeight = sets[0].weight;
    var best = 0;
    Object.keys(counts).forEach(function (key) {
      var w = Number(key);
      var c = counts[key];
      if (c > best || (c === best && w > workWeight)) { best = c; workWeight = w; }
    });

    var workSets = sets.filter(function (s) { return s.weight === workWeight; });
    var rpes = workSets.filter(function (s) { return s.rpe !== null; }).map(function (s) { return s.rpe; });

    return {
      date: session.date,
      sets: sets,
      workWeight: workWeight,
      workSets: workSets,
      topWeight: Math.max.apply(null, sets.map(function (s) { return s.weight; })),
      e1rm: Math.max.apply(null, sets.map(function (s) { return e1rm(s.weight, s.reps); })),
      volume: sets.reduce(function (a, s) { return a + s.weight * s.reps; }, 0),
      totalReps: sets.reduce(function (a, s) { return a + s.reps; }, 0),
      avgRpe: rpes.length ? rpes.reduce(function (a, b) { return a + b; }, 0) / rpes.length : null
    };
  }

  function normalize(ex) {
    var repMin = Math.max(1, Math.round(Number(ex.repMin) || 8));
    var repMax = Math.max(repMin, Math.round(Number(ex.repMax) || repMin));
    return {
      repMin: repMin,
      repMax: repMax,
      sets: Math.max(1, Math.round(Number(ex.sets) || 3)),
      increment: Math.max(0, Number(ex.increment) || 0),
      equipment: ex.equipment || 'other'
    };
  }

  // Bewertung einer Einheit gegen die Zielvorgaben der Übung
  function evaluate(summary, ex) {
    var considered = summary.workSets.slice(0, ex.sets);
    var complete = considered.length >= ex.sets;
    return {
      considered: considered,
      complete: complete,
      allAtMax: complete && considered.every(function (s) { return s.reps >= ex.repMax; }),
      allAtMin: complete && considered.every(function (s) { return s.reps >= ex.repMin; }),
      anyBelowMin: considered.some(function (s) { return s.reps < ex.repMin; }),
      bigMargin: complete && considered.every(function (s) { return s.reps >= ex.repMax + 2; }),
      reps: considered.map(function (s) { return s.reps; })
    };
  }

  function consideredReps(summary, ex) {
    return summary.workSets.slice(0, ex.sets).reduce(function (a, s) { return a + s.reps; }, 0);
  }

  // Fortschritt innerhalb des Wiederholungsbereichs (0 = alle Sätze am Minimum, 1 = alle am Maximum)
  function progressWithinRange(ev, ex) {
    if (ex.repMax === ex.repMin) return ev.allAtMax ? 1 : 0;
    var span = ex.sets * (ex.repMax - ex.repMin);
    var gained = 0;
    for (var i = 0; i < ex.sets; i++) {
      var reps = ev.considered[i] ? ev.considered[i].reps : 0;
      gained += Math.max(0, Math.min(ex.repMax, reps) - ex.repMin);
    }
    return Math.max(0, Math.min(1, gained / span));
  }

  // Stellt sicher, dass ein reduziertes Gewicht wirklich unter dem alten liegt
  function strictlyLower(oldWeight, candidate, inc) {
    var w = candidate;
    if (w >= oldWeight) w = roundToStep(oldWeight - (inc || 2.5), inc);
    if (w < 0) w = 0;
    return w;
  }

  function trendOf(history) {
    if (history.length < 3) return 'none';
    var last = history[0].e1rm;
    var ref = history.slice(1, 4);
    var avg = ref.reduce(function (a, h) { return a + h.e1rm; }, 0) / ref.length;
    if (!avg) return 'none';
    var change = (last - avg) / avg;
    if (change > 0.02) return 'up';
    if (change < -0.02) return 'down';
    return 'flat';
  }

  // Erklärt, wie die Steigerung praktisch umgesetzt wird
  function howToIncrease(ex, delta, newWeight, oldWeight, unit) {
    var text;
    switch (ex.equipment) {
      case 'barbell':
        text = fmt(delta, unit) + ' mehr auf der Stange = ' + fmt(delta / 2, unit) + ' pro Seite auflegen → ' + fmt(newWeight, unit) + '.';
        break;
      case 'dumbbell':
        text = 'Nimm die nächstschwereren Kurzhanteln: ' + fmt(newWeight, unit) + ' pro Hand (+' + fmt(delta, unit) + ').';
        break;
      case 'machine':
      case 'cable':
        text = 'Steckgewicht eine Stufe höher: ' + fmt(newWeight, unit) + ' (+' + fmt(delta, unit) + ').';
        break;
      case 'bodyweight':
        text = 'Zusatzgewicht (Gürtel oder Weste) auf ' + fmt(newWeight, unit) + ' erhöhen (+' + fmt(delta, unit) + ').';
        break;
      default:
        text = 'Auf ' + fmt(newWeight, unit) + ' erhöhen (+' + fmt(delta, unit) + ').';
    }
    if (oldWeight > 0 && delta / oldWeight > 0.1) {
      text += ' Hinweis: Der Sprung ist größer als 10 % – falls es zu schwer wird, bleib beim alten Gewicht und baue erst mehr Wiederholungen auf.';
    }
    return text;
  }

  /**
   * Empfehlung für die nächste Einheit.
   *
   * @param {Object} exercise  { repMin, repMax, sets, increment, equipment }
   * @param {Array}  sessions  [{ date, sets: [{ weight, reps, rpe, done, warmup }] }] – beliebige Reihenfolge
   * @param {Object} [opts]    { unit: 'kg'|'lb', now: Date|number }
   */
  function recommend(exercise, sessions, opts) {
    opts = opts || {};
    var unit = opts.unit || 'kg';
    var now = opts.now ? new Date(opts.now).getTime() : Date.now();
    var ex = normalize(exercise);
    var inc = ex.increment;

    var history = (sessions || []).map(summarize).filter(Boolean).sort(function (a, b) {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    var base = {
      unit: unit,
      repMin: ex.repMin,
      repMax: ex.repMax,
      targetSets: ex.sets,
      increment: inc,
      sessions: history.length,
      e1rm: null,
      bestE1rm: null,
      trend: 'none',
      progress: 0,
      lastReps: [],
      previousWeight: null
    };

    if (!history.length) {
      return Object.assign(base, {
        status: 'start',
        tone: 'info',
        label: 'Erstes Training',
        weight: null,
        delta: 0,
        repTargets: fill(ex.sets, ex.repMin),
        reason: 'Noch keine Daten für diese Übung. Wähle ein Gewicht, mit dem du ' + ex.repMin +
          ' saubere Wiederholungen schaffst und noch 2–3 in Reserve hast.',
        how: 'Ab der zweiten Einheit berechnet der Tracker automatisch, wann und wie du steigern solltest.'
      });
    }

    var last = history[0];
    var ev = evaluate(last, ex);
    var w = last.workWeight;
    var bestE1rm = Math.max.apply(null, history.map(function (h) { return h.e1rm; }));
    var daysSince = Math.floor((now - new Date(last.date).getTime()) / DAY_MS);

    Object.assign(base, {
      e1rm: last.e1rm,
      bestE1rm: bestE1rm,
      trend: trendOf(history),
      progress: progressWithinRange(ev, ex),
      lastReps: ev.reps,
      previousWeight: w,
      daysSince: daysSince,
      avgRpe: last.avgRpe
    });

    // 1) Wiedereinstieg nach langer Pause
    if (daysSince >= 21 && w > 0 && inc > 0) {
      var factor = daysSince >= 42 ? 0.85 : 0.9;
      var comebackWeight = strictlyLower(w, roundToStep(w * factor, inc), inc);
      return Object.assign(base, {
        status: 'comeback',
        tone: 'warning',
        label: 'Wiedereinstieg',
        weight: comebackWeight,
        delta: roundToStep(comebackWeight - w, inc),
        repTargets: fill(ex.sets, ex.repMin),
        reason: 'Deine letzte Einheit ist ' + daysSince + ' Tage her. Starte etwa ' +
          Math.round((1 - factor) * 100) + ' % leichter (' + fmt(comebackWeight, unit) + ' statt ' + fmt(w, unit) +
          ') und arbeite dich in 1–2 Einheiten zurück.',
        how: 'Wenn sich die Sätze leicht anfühlen, kannst du beim nächsten Mal direkt wieder auf ' + fmt(w, unit) + ' gehen.'
      });
    }

    // 2) Alle Sätze am oberen Ende des Bereichs → Gewicht erhöhen
    if (ev.allAtMax) {
      var steps = 1;
      if (ev.bigMargin || (last.avgRpe !== null && last.avgRpe <= 7)) steps = 2;

      if (inc <= 0) {
        return Object.assign(base, {
          status: 'increase',
          tone: 'success',
          label: 'Schwieriger machen',
          weight: w,
          delta: 0,
          repTargets: fill(ex.sets, ex.repMin + 2),
          reason: 'Alle ' + ex.sets + ' Sätze haben ' + ex.repMax + ' Wdh. erreicht (' + ev.reps.join('/') + ').',
          how: 'Füge Zusatzgewicht hinzu (Gürtel, Weste oder Hantel zwischen den Füßen), wähle eine schwerere Variante ' +
            'oder hebe den Wiederholungsbereich auf ' + (ex.repMin + 2) + '–' + (ex.repMax + 2) + ' an.'
        });
      }

      var delta = inc * steps;
      var newWeight = roundToStep(w + delta, inc);
      var reason = steps === 2
        ? 'Alle ' + ex.sets + ' Sätze lagen deutlich über dem Ziel von ' + ex.repMax + ' Wdh. (' + ev.reps.join('/') +
          (last.avgRpe !== null && last.avgRpe <= 7 ? ', RPE ' + fmt(last.avgRpe) : '') +
          ') – du hattest viel Reserve, deshalb ein größerer Sprung.'
        : 'Alle ' + ex.sets + ' Sätze haben das Ziel von ' + ex.repMax + ' Wdh. erreicht (' + ev.reps.join('/') + ').';
      var how = howToIncrease(ex, delta, newWeight, w, unit) +
        ' Starte wieder bei ' + ex.repMin + ' Wdh. pro Satz und baue von dort auf.';
      if (last.avgRpe !== null && last.avgRpe >= 9.5) {
        how += ' Dein RPE war sehr hoch (' + fmt(last.avgRpe) + ') – falls der erste Satz nicht klappt, bleib beim alten Gewicht.';
      }
      return Object.assign(base, {
        status: 'increase',
        tone: 'success',
        label: 'Gewicht erhöhen',
        weight: newWeight,
        delta: delta,
        repTargets: fill(ex.sets, ex.repMin),
        reason: reason,
        how: how
      });
    }

    // 3) Sätze fehlen oder liegen unter dem Minimum
    if (ev.anyBelowMin || !ev.complete) {
      var fails = 0;
      for (var i = 0; i < history.length; i++) {
        if (history[i].workWeight !== w) break;
        var e = evaluate(history[i], ex);
        if (e.anyBelowMin || !e.complete) fails++; else break;
      }

      if (fails >= 2 && inc > 0 && w > 0) {
        var deloadWeight = strictlyLower(w, roundToStep(w * 0.9, inc), inc);
        return Object.assign(base, {
          status: 'deload',
          tone: 'danger',
          label: 'Gewicht reduzieren',
          weight: deloadWeight,
          delta: roundToStep(deloadWeight - w, inc),
          repTargets: fill(ex.sets, ex.repMin),
          reason: fails + '× hintereinander nicht alle ' + ex.sets + ' Sätze mit mindestens ' + ex.repMin +
            ' Wdh. bei ' + fmt(w, unit) + ' geschafft (zuletzt ' + ev.reps.join('/') + ').',
          how: 'Reduziere um ca. 10 % auf ' + fmt(deloadWeight, unit) + ', baue die Wiederholungen neu auf und ' +
            'steigere dann wieder Schritt für Schritt. Das ist kein Rückschritt, sondern Teil des Plans.'
        });
      }

      var retryReason = !ev.complete
        ? 'Nur ' + ev.considered.length + ' von ' + ex.sets + ' Sätzen bei ' + fmt(w, unit) + ' absolviert.'
        : 'Mindestens ein Satz lag unter ' + ex.repMin + ' Wdh. (' + ev.reps.join('/') + ').';
      return Object.assign(base, {
        status: 'retry',
        tone: 'warning',
        label: 'Gewicht halten',
        weight: w,
        delta: 0,
        repTargets: fill(ex.sets, ex.repMin),
        reason: retryReason + ' Gleiches Gewicht noch einmal – Ziel: alle ' + ex.sets + ' Sätze mit mindestens ' +
          ex.repMin + ' Wdh. Klappt es wieder nicht, wird das Gewicht reduziert.',
        how: 'Achte auf 2–3 Minuten Pause zwischen den Sätzen, saubere Technik, genug Schlaf und ausreichend Essen.'
      });
    }

    // 4) Plateau: ≥ 4 Einheiten beim gleichen Gewicht ohne mehr Wiederholungen
    var sameWeight = [];
    for (var j = 0; j < history.length; j++) {
      if (history[j].workWeight !== w) break;
      sameWeight.push(history[j]);
    }
    if (sameWeight.length >= 4 && inc > 0 && w > 0) {
      var repsNow = consideredReps(sameWeight[0], ex);
      var repsThen = consideredReps(sameWeight[3], ex);
      if (repsNow <= repsThen) {
        var plateauWeight = strictlyLower(w, roundToStep(w * 0.9, inc), inc);
        return Object.assign(base, {
          status: 'plateau',
          tone: 'danger',
          label: 'Plateau erkannt',
          weight: plateauWeight,
          delta: roundToStep(plateauWeight - w, inc),
          repTargets: fill(ex.sets, ex.repMin),
          reason: 'Seit ' + sameWeight.length + ' Einheiten bei ' + fmt(w, unit) + ' ohne mehr Wiederholungen (' +
            repsThen + ' → ' + repsNow + ' Wdh. gesamt).',
          how: 'Kurzer Deload auf ' + fmt(plateauWeight, unit) + ' und neuer Anlauf. Alternativ den Wiederholungsbereich ' +
            'ändern (z. B. 5–8 statt 8–12) oder die Übungsvariante wechseln.'
        });
      }
    }

    // 5) Wiederholungen aufbauen
    var repTargets = ev.considered.map(function (s) { return Math.min(ex.repMax, s.reps + 1); });
    while (repTargets.length < ex.sets) repTargets.push(ex.repMin);
    var missing = 0;
    for (var k = 0; k < ex.sets; k++) {
      var r = ev.considered[k] ? ev.considered[k].reps : 0;
      missing += Math.max(0, ex.repMax - r);
    }
    return Object.assign(base, {
      status: 'reps',
      tone: 'info',
      label: 'Wiederholungen steigern',
      weight: w,
      delta: 0,
      repTargets: repTargets,
      reason: 'Gewicht halten und Wiederholungen aufbauen: zuletzt ' + ev.reps.join('/') + ', heute Ziel ' +
        repTargets.join('/') + '.',
      how: 'Noch ' + missing + ' Wiederholung' + (missing === 1 ? '' : 'en') + ' bis zur nächsten Steigerung. Sobald alle ' +
        ex.sets + ' Sätze ' + ex.repMax + ' Wdh. erreichen, geht das Gewicht um ' + fmt(inc, unit) + ' hoch.'
    });
  }

  // Aufwärmsätze auf Basis des Arbeitsgewichts
  function warmupPlan(exercise, workWeight) {
    var ex = normalize(exercise);
    if (!workWeight || workWeight <= 0) return [];
    var inc = ex.increment > 0 ? ex.increment : 2.5;
    var steps = workWeight >= 60 ? [[0.4, 8], [0.6, 5], [0.8, 3]] : [[0.5, 8], [0.75, 4]];
    var plan = [];
    steps.forEach(function (st) {
      var w = roundToStep(workWeight * st[0], inc);
      if (w > 0 && w < workWeight && !plan.some(function (p) { return p.weight === w; })) {
        plan.push({ weight: w, reps: st[1] });
      }
    });
    return plan;
  }

  return {
    recommend: recommend,
    summarize: summarize,
    warmupPlan: warmupPlan,
    e1rm: e1rm,
    roundToStep: roundToStep,
    fmt: fmt
  };
}));
