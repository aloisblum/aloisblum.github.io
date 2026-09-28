# Stellensuche fortsetzen

Die erste Runde am 28.09.2026 endete nach dem Websuche-Limit von 200 Suchen pro Sitzung. Von 67 geplanten Suchaufträgen sind 2 erledigt, 12 teilweise und 53 noch offen (`batches.json`, Feld `status`).

## 1. Umgebung vorbereiten (einmalig, in den Einstellungen der Cloud-Umgebung)

Menü der Cloud-Umgebung in der Titelleiste der Sitzung → **Edit**:

1. **Umgebungsvariable** `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION=3000` setzen. Die offenen Aufträge brauchen etwa 40 Suchen pro Auftrag, zusammen also rund 2'500.
2. **Optional, aber sehr hilfreich: Network access** erweitern, damit Stellen direkt geprüft und ganze Karriereportale ausgelesen werden können. Mindestens diese Domains erlauben:
   `jobs.ch`, `www.jobs.ch`, `www.jobup.ch`, `*.myworkdayjobs.com`, `boards-api.greenhouse.io`, `api.lever.co`, `api.smartrecruiters.com`, `jobs.ubs.com`, `krb-sjobs.brassring.com`, `careers.partnersgroup.com`, `jobs.partnersgroup.com`, `www.efinancialcareers.ch`, `ch.indeed.com`.

Die Änderungen gelten ab der nächsten neuen Sitzung.

## 2. Neue Sitzung auf diesem Repository und Branch starten, mit diesem Prompt

> Setze die Stellensuche aus `jobsuche/fortsetzung/ANLEITUNG.md` fort (Abschnitt 3). Branch: `claude/zurich-job-listings-finance-tech-te9jsb`.

## 3. Arbeitsschritte (für Claude)

1. `jobsuche/fortsetzung/batches.json` lesen und alle Aufträge mit `status` ≠ `erledigt` sammeln.
2. Den Workflow `jobsuche/fortsetzung/sweep-workflow.js` gruppenweise ausführen: `Workflow({scriptPath, args: {group, batches}})` mit den offenen Aufträgen der jeweiligen Gruppe. Vorher mit einer Test-Suche prüfen, ob das Suchlimit wirklich erhöht ist. Die Meldung „used its web search budget (200 of 200)“ heisst: Das Limit ist nicht aktiv.
   - Pro Workflow laufen nur `Anzahl CPUs − 2` Agenten parallel. Mehrere Gruppen-Workflows gleichzeitig starten.
   - Sind Job-Domains freigeschaltet, zuerst die Bewerbungssysteme direkt auslesen. Das ist vollständiger als die Websuche. Beispiele: Workday `POST https://<tenant>.wdN.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` mit `{"searchText":"Zurich","limit":20,"offset":0}`, Greenhouse `https://boards-api.greenhouse.io/v1/boards/<board>/jobs`.
3. Ergebnisse aus den `journal.jsonl` der Workflows einsammeln (Zeilen mit `"type":"result"`). Jede gemeldete URL gegen die tatsächlichen Suchtreffer im Agenten-Transkript prüfen und nicht belegte URLs verwerfen.
4. Mit `jobsuche/daten/stellen.json` zusammenführen. Duplikate erkennt man an LinkedIn-ID, UBS-`jobid`, jobs.ch-Detail-ID oder normalisiertem Titel pro Arbeitgeber. Firmen-Website vor Aggregator bevorzugen.
5. Status neu bewerten (Regeln im Blatt „Methodik“ der Excel-Datei). Mit Netzwerkzugang zusätzlich jede Stelle mit „Offen? (prüfen)“ abrufen und prüfen, ob sie noch online ist.
6. `stellenliste-zuerich.xlsx`, `stellenliste-zuerich.csv`, `README.md` und `daten/*.json` neu erzeugen. Die Hilfsskripte liegen in `fortsetzung/tools/`; die Pfade am Skriptanfang an die neue Sitzung anpassen. Danach committen und auf den Branch pushen.
