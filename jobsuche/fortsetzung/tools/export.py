"""Write XLSX + Markdown deliverables from out/stellen.json."""
import json, os
from collections import Counter, defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
rows = json.load(open(os.path.join(OUT, 'stellen.json')))
cov = json.load(open(os.path.join(OUT, 'arbeitgeber_geprueft.json')))
groups = json.load(open(os.path.join(HERE, 'cont', 'batches.json')))
STAND = '28.09.2026'

# ---------- XLSX ----------
wb = Workbook()
ws = wb.active
ws.title = 'Stellen'
cols = ['Status', 'Fit', 'Sektor', 'Arbeitgeber', 'Stelle', 'Stufe', 'Funktion', 'Ort', 'Kanton', 'Quelle', 'Link',
        'Weitere Links', 'Datum / Frist', 'Hinweise', 'Aktualitäts-Indiz', 'Konfidenz', 'Mein Status', 'Notizen']
widths = [22, 8, 26, 30, 60, 22, 22, 18, 8, 16, 14, 14, 22, 50, 40, 10, 16, 30]
ws.append(cols)
FILL = {'Wahrscheinlich offen': 'D8EFD9', 'Offen? (prüfen)': 'FFF1C7', 'Wahrscheinlich abgelaufen': 'E6E6E6'}
for r in rows:
    ws.append([r.get(c, '') if c not in ('Link', 'Mein Status', 'Notizen') else '' for c in cols])
    i = ws.max_row
    link = ws.cell(i, cols.index('Link') + 1)
    link.value = 'öffnen'
    link.hyperlink = r['Link']
    link.font = Font(color='1F4E9E', underline='single')
    ws.cell(i, 1).fill = PatternFill('solid', fgColor=FILL[r['Status']])
for c, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(c)].width = w
for cell in ws[1]:
    cell.font = Font(bold=True, color='FFFFFF')
    cell.fill = PatternFill('solid', fgColor='1F3B57')
    cell.alignment = Alignment(vertical='center')
ws.freeze_panes = 'E2'
ws.auto_filter.ref = ws.dimensions

ws2 = wb.create_sheet('Arbeitgeber geprüft')
ws2.append(['Arbeitgeber', 'Ergebnis', 'Notiz', 'Suchauftrag'])
for c in cov:
    ws2.append([c['Arbeitgeber'], c['Ergebnis'], c['Notiz'], c['Suchauftrag']])
for c, w in zip('ABCD', [45, 34, 90, 22]):
    ws2.column_dimensions[c].width = w
for cell in ws2[1]:
    cell.font = Font(bold=True)
ws2.freeze_panes = 'A2'
ws2.auto_filter.ref = ws2.dimensions

ws3 = wb.create_sheet('Noch nicht durchsucht')
ws3.append(['Gruppe', 'Suchauftrag', 'Status', 'Thema / Arbeitgeber'])
for g in groups:
    for b in g['batches']:
        what = b.get('theme') or '; '.join(b.get('companies', []))
        ws3.append([g['group'], b['id'], b['status'], what])
for c, w in zip('ABCD', [26, 26, 36, 140]):
    ws3.column_dimensions[c].width = w
for cell in ws3[1]:
    cell.font = Font(bold=True)

ws4 = wb.create_sheet('Methodik')
for line in [
    f'Stand: {STAND}',
    'Quelle: Websuche (Suchergebnis-Titel und -Links). Direkter Abruf von LinkedIn, jobs.ch, Indeed, Karriereseiten war durch die Netzwerk-Policy der Cloud-Umgebung gesperrt.',
    'Jeder Eintrag entspricht einem tatsächlich gefundenen Suchtreffer (URL geprüft), nichts ist erfunden.',
    'Status: "Wahrscheinlich offen" = Intake 2027 im Titel, neue LinkedIn-ID (>= ca. 4,38 Mrd., ab Frühling 2026) oder Datum im Suchausschnitt; "Offen? (prüfen)" = kein Datum erkennbar; "Wahrscheinlich abgelaufen" = Intake 2025/2026 oder alte LinkedIn-ID.',
    'Fit: hoch = Investment-/Bewertungs-/Research-/PE-/Private-Debt-/AM-/Immobilien-Investment-/M&A-Analystenrollen; mittel = übrige Finanz-, Beratungs-, Strategie-Rollen; gering = Vertrieb, Marketing, Operations, Compliance.',
    'Abdeckung unvollständig: Das Websuche-Limit dieser Sitzung (200 Suchen) war nach ca. 20 von 67 geplanten Suchaufträgen erreicht. Siehe Blatt "Noch nicht durchsucht".',
    'Spalten "Mein Status" und "Notizen" sind leer für deine eigene Bewerbungsverfolgung.',
]:
    ws4.append([line])
ws4.column_dimensions['A'].width = 160
wb.save(os.path.join(OUT, 'stellenliste-zuerich.xlsx'))

# ---------- Markdown ----------
st = Counter(r['Status'] for r in rows)
md = []
md.append('# Einstiegsstellen Zürich, Zug, Schwyz\n')
md.append(f'Stand {STAND}. Zielbereiche: Asset und Wealth Management, Consulting, Investment Banking, Private Debt, Leveraged Finance, Hedge Funds, Family Offices, Private Equity, Tech, Pharma sowie Beteiligungsgesellschaften und Konzern-M&A. Dazu Immobilien-Investment, weil es zur Masterarbeit passt.\n')
md.append(f'**{len(rows)} Stellen**: {st["Wahrscheinlich offen"]} wahrscheinlich offen, {st["Offen? (prüfen)"]} ohne erkennbares Datum (prüfen), {st["Wahrscheinlich abgelaufen"]} wahrscheinlich abgelaufen (als Hinweis auf wiederkehrende Programme aufgeführt).\n')
md.append('> **Die Liste ist nicht vollständig.** Diese Cloud-Sitzung durfte höchstens 200 Websuchen ausführen, und Jobportale (LinkedIn, jobs.ch, Indeed, Karriereseiten) waren für direkte Abrufe gesperrt. Durchsucht wurden vor allem UBS, Partners Group, LGT Capital Partners, Private Debt, Fintech/Krypto, Immobilien, unabhängige Vermögensverwalter und Schweizer Asset Manager. Viele Bereiche fehlen noch, darunter Julius Bär, globale Investmentbanken, Beratungen, Big 4, Tech, Pharma und Hedge Funds. Wie es weitergeht, steht unten unter [Fortsetzen](#fortsetzen).\n')
md.append('Dateien: [`stellenliste-zuerich.xlsx`](stellenliste-zuerich.xlsx) (mit Filtern und Spalten für den eigenen Bewerbungsstatus), [`stellenliste-zuerich.csv`](stellenliste-zuerich.csv) (Semikolon, UTF-8), [`daten/stellen.json`](daten/stellen.json).\n')
md.append('Legende: **Fit** hoch / mittel / gering (Einschätzung zum Profil: HSG-Master, empirische Immobilien-Finance-Masterarbeit). **Stufe**: Graduate-/Traineeprogramm, Einstieg, Associate (0–3 J.), Stretch (2–4 J.) oder Praktikum (Absolventen).\n')


def esc(s):
    return (s or '').replace('|', '/').replace('\n', ' ')


for status in ['Wahrscheinlich offen', 'Offen? (prüfen)', 'Wahrscheinlich abgelaufen']:
    sub = [r for r in rows if r['Status'] == status]
    md.append(f'\n## {status} ({len(sub)})\n')
    if status == 'Wahrscheinlich abgelaufen':
        md.append('Diese Stellen sind vermutlich besetzt oder die Frist ist vorbei (Intake 2025/2026 oder alte Ausschreibung). Sie zeigen aber, welche Programme jährlich wiederkommen, etwa die UBS-Graduate-Tracks für 2027.\n')
    by = defaultdict(list)
    for r in sub:
        by[r['Sektor']].append(r)
    for sektor in sorted(by):
        md.append(f'\n### {sektor}\n')
        md.append('| Arbeitgeber | Stelle | Stufe | Ort | Fit | Hinweise |')
        md.append('|---|---|---|---|---|---|')
        for r in by[sektor]:
            ort = esc(r['Ort']) + (f" ({r['Kanton']})" if r['Kanton'] not in ('', 'Unklar') else '')
            md.append(f"| {esc(r['Arbeitgeber'])} | [{esc(r['Stelle'])}]({r['Link']}) | {esc(r['Stufe'])} | {ort} | {r['Fit']} | {esc(r['Hinweise'])[:140]} |")

md.append('\n## Arbeitgeber ohne aktuelle Ausschreibung\n')
md.append('Diese Arbeitgeber wurden durchsucht, aber ohne passende öffentliche Ausschreibung. Bei Family Offices, Beteiligungsholdings und kleinen PE- oder VC-Häusern lohnen sich Initiativbewerbungen und Networking, weil diese Stellen oft gar nicht ausgeschrieben werden.\n')
md.append('| Arbeitgeber | Ergebnis | Notiz |')
md.append('|---|---|---|')
for c in cov:
    if c['Ergebnis'] in ('keine passenden Stellen gefunden', 'keine öffentlichen Ausschreibungen / unklar'):
        md.append(f"| {esc(c['Arbeitgeber'])} | {c['Ergebnis']} | {esc(c['Notiz'])[:160]} |")

open(os.path.join(OUT, 'README.md'), 'w').write('\n'.join(md) + '\n')
print('xlsx + md written')
