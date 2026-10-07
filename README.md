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
- Daten liegen lokal im Browser (localStorage) und lassen sich als JSON
  exportieren und importieren

Tests der Progressionslogik: `node gym/tests/progression.test.js`
