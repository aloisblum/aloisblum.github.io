# aloisblum.github.io
Master thesis research project

## Gym Tracker

Unter [`/gym/`](gym/) liegt ein Trainingstagebuch als installierbare Web-App
(ohne Build-Schritt, ohne Abhängigkeiten). Nach dem Deployment auf GitHub Pages
ist sie unter `https://aloisblum.github.io/gym/` erreichbar.

- Eigene Übungen mit Name, Muskelgruppe, Gerät, Satzanzahl, Wiederholungsbereich
  und Gewichtsstufe anlegen (im Profil) und im Training auswählen
- Sätze mit Gewicht, Wiederholungen und optional RPE protokollieren, Ruhe-Timer,
  Aufwärmsatz-Vorschlag, Trainingspläne, Verlauf und Fortschrittsdiagramme
- Progressionsalgorithmus (`gym/progression.js`): doppelte Progression mit
  Steigerungs-, Halte-, Deload-, Plateau- und Wiedereinstiegsregeln, inklusive
  konkreter Anleitung, wie gesteigert wird (Scheiben pro Seite, nächste
  Kurzhantel, Steckgewicht)
- Speicherung: jede Eingabe wird sofort lokal gesichert (localStorage mit
  IndexedDB-Spiegel), Backup als JSON exportier- und importierbar
- Cloud-Sync (`gym/sync.js`): optionaler Abgleich über eine JSON-Datei in
  einem privaten GitHub-Repository des Nutzers (Fine-grained Token, nur
  „Contents: Read and write“ für dieses eine Repository). Zusammenführung pro
  Eintrag nach Zeitstempel mit Löschmarkern, Konfliktauflösung über das
  Datei-SHA, Abgleich beim Start, beim Zurückkehren in die App, bei
  Netzverbindung und periodisch. Token, laufendes Training und Design bleiben
  gerätelokal und landen weder in der Cloud noch im Backup.
- Installation als App: Profil → „Auf dem Handy installieren“ (iOS: Safari →
  Teilen → Zum Home-Bildschirm; Android: Chrome → Menü → App installieren)

Tests: `node gym/tests/progression.test.js` und `node gym/tests/sync.test.js`
