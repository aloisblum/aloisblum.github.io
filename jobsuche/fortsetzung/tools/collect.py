"""Collect agent results from workflow journals into one raw JSON file."""
import json, glob, os, sys

BASE = '/root/.claude/projects/-home-user-aloisblum-github-io/0dca2655-f7be-5113-9435-028c6fe933e9/subagents/workflows'
OUT = os.path.join(os.path.dirname(__file__), 'raw_results.json')


def find_payload(obj):
    """Return the first dict inside obj that has a 'jobs' list."""
    if isinstance(obj, dict):
        if isinstance(obj.get('jobs'), list):
            return obj
        for v in obj.values():
            r = find_payload(v)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_payload(v)
            if r is not None:
                return r
    elif isinstance(obj, str) and '"jobs"' in obj:
        try:
            return find_payload(json.loads(obj))
        except Exception:
            return None
    return None


results = []
labels = {}
for jf in sorted(glob.glob(os.path.join(BASE, '*', 'journal.jsonl'))):
    wf = os.path.basename(os.path.dirname(jf))
    for line in open(jf):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get('type') == 'started':
            labels[d.get('key')] = d.get('label')
            continue
        payload = find_payload(d)
        if payload is None:
            continue
        label = d.get('label') or labels.get(d.get('key')) or '?'
        results.append({'workflow': wf, 'label': label, **payload})

json.dump(results, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(f'{len(results)} agent results, {sum(len(r["jobs"]) for r in results)} jobs -> {OUT}')
for r in results:
    print(f'  {r["workflow"]} {r["label"]}: {len(r["jobs"])} jobs, {len(r.get("companies_checked", []))} checked')
