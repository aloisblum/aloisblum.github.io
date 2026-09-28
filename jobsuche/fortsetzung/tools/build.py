"""Merge, dedupe and grade all job findings; write CSV/XLSX/JSON."""
import json, glob, os, re, csv
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = '/root/.claude/projects/-home-user-aloisblum-github-io/0dca2655-f7be-5113-9435-028c6fe933e9/subagents/workflows'
OUTDIR = os.environ.get('OUTDIR', os.path.join(HERE, 'out'))
os.makedirs(OUTDIR, exist_ok=True)

links = {x['url'] for x in json.load(open(os.path.join(HERE, 'search_links.json')))}

# 1) jobs reported by the search agents
jobs = []
for r in json.load(open(os.path.join(HERE, 'raw_results.json'))):
    for j in r['jobs']:
        j = dict(j)
        j['quelle_agent'] = r['label']
        jobs.append(j)

# 2) jobs classified from mined links (classify workflow journal)
for jf in glob.glob(os.path.join(BASE, '*', 'journal.jsonl')):
    for line in open(jf):
        d = json.loads(line)
        res = d.get('result')
        if d.get('type') == 'result' and isinstance(res, dict) and 'rejected_count' in res:
            for j in res['jobs']:
                j = dict(j)
                j.setdefault('source', '')
                j['quelle_agent'] = 'link-mining'
                jobs.append(j)

# every URL must come from a real search result
jobs = [j for j in jobs if j['url'] in links]


def source_of(url, given):
    h = urlparse(url).netloc
    if 'linkedin' in h:
        return 'LinkedIn'
    if 'jobs.ch' in h or 'jobup.ch' in h:
        return 'jobs.ch / jobup.ch'
    if 'efinancialcareers' in h:
        return 'eFinancialCareers'
    if 'glassdoor' in h:
        return 'Glassdoor'
    if 'indeed' in h:
        return 'Indeed'
    return given or 'Firmen-Website / Andere'


def linkedin_id(url):
    if 'linkedin.com/jobs/view' not in url:
        return None
    m = re.search(r'-(\d{9,10})(?:[/?]|$)', url)
    return int(m.group(1)) if m else None


def key(j):
    u = j['url']
    lid = linkedin_id(u)
    if lid:
        return f'li:{lid}'
    m = re.search(r'jobid=(\d+)', u, re.I)
    if m and 'ubs' in u:
        return f'ubs:{m.group(1)}'
    m = re.search(r'/detail/([0-9a-f-]{20,})', u)
    if m:
        return f'jobsch:{m.group(1)}'
    return 'url:' + u.split('?')[0].rstrip('/').lower()


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def company_key(c):
    c = norm(c)
    for a, b in [('zürcher kantonalbank', 'zkb'), ('zurcher kantonalbank', 'zkb')]:
        c = c.replace(a, b)
    return c.split(' ')[0] if c else c


# dedupe: exact posting key, then company+title
merged = {}
for j in jobs:
    k = key(j)
    if k in merged:
        continue
    merged[k] = j
seen = {}
for k, j in list(merged.items()):
    k2 = (company_key(j['company']), norm(j['title'])[:60])
    if k2 in seen:
        other = merged[seen[k2]]
        other.setdefault('weitere_links', []).append(j['url'])
        del merged[k]
    else:
        seen[k2] = k

CONF_RANK = {'hoch': 2, 'mittel': 1, 'niedrig': 0}


def status(j):
    t = j['title']
    lid = linkedin_id(j['url'])
    if re.search(r'\b2025\b', t) or re.search(r'2026 (Graduate Talent Program|Off-Cycle)', t, re.I) \
            or re.search(r'\b2026 Graduate\b', t) or 'Investment Banking 2026 Off-Cycle' in t:
        return 'Wahrscheinlich abgelaufen'
    if lid is not None and lid < 4_300_000_000 and not re.search(r'202[67]', t):
        return 'Wahrscheinlich abgelaufen'
    if re.search(r'\b2027\b', t) or (lid and lid >= 4_380_000_000) or CONF_RANK.get(j.get('confidence'), 0) >= 1:
        return 'Wahrscheinlich offen'
    return 'Offen? (prüfen)'


def clean_title(t):
    t = re.sub(r'^(UBS bietet Job als|.*? sucht)\s+', '', t)
    t = re.sub(r'\s*[-|–]\s*(UBS Job Board for Graduates.*|UBS - Campus Recruitment.*|UBS Job B.*|UBS\s*$|Job Offer at .*|Stellenangebot .*)$', '', t)
    t = re.sub(r'\s+(in|bei) [A-ZÄÖÜ][^|]*\| (LinkedIn|Glassdoor)$', '', t)
    t = re.sub(r'\s*\|\s*(UBS|Glassdoor|LinkedIn)\b.*$', '', t)
    return t.strip(' -–|')


BANK_FUNCS = re.compile(r'(Internal Audi|Risk|Treasury|Liquidity|Reporting|Finance|Business Analyst|Marketing|Real Estate &|Corporate Real Estate|Securities Banks|Client Needs|Corporate Clients)', re.I)
for j in merged.values():
    j['title'] = clean_title(j['title'])
    if j.get('sector') == 'Sonstiges' and re.search(r'UBS|Kantonalbank|ZKB', j['company']) :
        j['sector'] = 'Bank – Konzernfunktionen (Risk, Finance, Treasury, Audit …)'

# second dedupe on cleaned titles (same posting on several boards)
def tkey(j):
    t = norm(j['title'])
    t = re.sub(r'\b(off cycle|zurich|zürich|zh|ubs)\b', ' ', t)
    return (company_key(j['company']), re.sub(r'\s+', ' ', t).strip()[:55])
seen2 = {}
for k, j in list(merged.items()):
    k2 = tkey(j)
    if k2 in seen2:
        keep = merged[seen2[k2]]
        # prefer employer site over aggregators
        if 'glassdoor' in keep['url'] and 'glassdoor' not in j['url']:
            j.setdefault('weitere_links', []).append(keep['url'])
            j['weitere_links'] += keep.get('weitere_links', [])
            merged[seen2[k2]] = j
            del merged[k]
        else:
            keep.setdefault('weitere_links', []).append(j['url'])
            del merged[k]
    else:
        seen2[k2] = k

# third pass: truncated titles ('Global Wealth Manag') -> merge into the longer one
items = list(merged.items())
for k, j in items:
    if k not in merged:
        continue
    a = tkey(j)
    for k2, j2 in items:
        if k2 == k or k2 not in merged:
            continue
        b = tkey(j2)
        if a[0] == b[0] and len(a[1]) >= 25 and b[1].startswith(a[1]) and len(b[1]) > len(a[1]) and (b[1][len(a[1])].isalnum() or j['title'].rstrip().endswith(('...', '…'))):
            j2.setdefault('weitere_links', []).append(j['url'])
            del merged[k]
            break

rows = []
for j in merged.values():
    lid = linkedin_id(j['url'])
    rows.append({
        'Status': status(j),
        'Fit': j.get('fit', ''),
        'Sektor': j.get('sector', ''),
        'Arbeitgeber': j['company'],
        'Stelle': j['title'],
        'Stufe': j.get('level', ''),
        'Funktion': j.get('function', ''),
        'Ort': j.get('location', ''),
        'Kanton': j.get('canton', ''),
        'Quelle': source_of(j['url'], j.get('source')),
        'Link': j['url'],
        'Weitere Links': ' '.join(j.get('weitere_links', [])),
        'Datum / Frist': j.get('posted_or_deadline', '') if j.get('posted_or_deadline', '').lower() not in ('unknown', 'unbekannt', 'unklar', 'nicht angegeben') else '',
        'Hinweise': (j.get('notes') or '').strip(),
        'Aktualitäts-Indiz': (j.get('recency_evidence') or '').strip() + (f' LinkedIn-ID {lid}' if lid else ''),
        'Konfidenz': j.get('confidence', ''),
    })

ORDER_S = {'Wahrscheinlich offen': 0, 'Offen? (prüfen)': 1, 'Wahrscheinlich abgelaufen': 2}
ORDER_F = {'hoch': 0, 'mittel': 1, 'gering': 2}
rows.sort(key=lambda r: (ORDER_S[r['Status']], r['Sektor'], ORDER_F.get(r['Fit'], 3), r['Arbeitgeber'].lower(), r['Stelle'].lower()))

json.dump(rows, open(os.path.join(OUTDIR, 'stellen.json'), 'w'), ensure_ascii=False, indent=1)
cols = list(rows[0].keys())
with open(os.path.join(OUTDIR, 'stellenliste.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols, delimiter=';')
    w.writeheader()
    w.writerows(rows)

# employers checked (coverage)
checked = {}
for r in json.load(open(os.path.join(HERE, 'raw_results.json'))):
    for c in r.get('companies_checked', []):
        note = c.get('note', '') or ''
        if 'budget' in note.lower() or 'not verified' in note.lower() or 'nicht verifiziert' in note.lower():
            res = 'nicht geprüft (Suchlimit)'
        else:
            res = c['result']
        checked.setdefault(c['company'], (res, note, r['label']))
cov = [{'Arbeitgeber': k, 'Ergebnis': v[0], 'Notiz': v[1], 'Suchauftrag': v[2]} for k, v in sorted(checked.items(), key=lambda x: x[0].lower())]
json.dump(cov, open(os.path.join(OUTDIR, 'arbeitgeber_geprueft.json'), 'w'), ensure_ascii=False, indent=1)

from collections import Counter
print(len(rows), 'Stellen nach Dedupe')
print(Counter(r['Status'] for r in rows))
print(Counter(r['Sektor'] for r in rows if r['Status'] != 'Wahrscheinlich abgelaufen'))
print(Counter(c['Ergebnis'] for c in cov))
