"""Extract every search-result link (title, url, query) from all agent transcripts."""
import json, glob, os, re

BASE = '/root/.claude/projects/-home-user-aloisblum-github-io/0dca2655-f7be-5113-9435-028c6fe933e9/subagents/workflows'
OUT = os.path.join(os.path.dirname(__file__), 'search_links.json')

HEAD = re.compile(r'Web search results for query: "(.*?)"\n', re.S)


def texts(content):
    if isinstance(content, str):
        yield content
    elif isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                yield c.get('text', '')
            elif isinstance(c, str):
                yield c


links = {}
summaries = []
for f in glob.glob(os.path.join(BASE, '*', 'agent-*.jsonl')):
    agent = os.path.basename(f)[6:-6]
    for line in open(f):
        d = json.loads(line)
        c = d.get('message', {}).get('content')
        if not isinstance(c, list):
            continue
        for x in c:
            if x.get('type') != 'tool_result':
                continue
            for t in texts(x.get('content')):
                if 'Web search results for query' not in t or 'was not performed' in t:
                    continue
                m = HEAD.search(t)
                q = m.group(1) if m else ''
                i = t.find('Links: [')
                if i < 0:
                    continue
                j = t.find(']\n', i)
                raw = t[i + 7:j + 1]
                try:
                    arr = json.loads(raw)
                except Exception:
                    # fall back to regex
                    arr = [{'title': a, 'url': b} for a, b in re.findall(r'"title":"(.*?)","url":"(.*?)"', raw)]
                for a in arr:
                    u = a.get('url', '')
                    e = links.setdefault(u, {'url': u, 'title': a.get('title', ''), 'queries': set(), 'agents': set()})
                    e['queries'].add(q)
                    e['agents'].add(agent)
                summaries.append({'agent': agent, 'query': q, 'summary': t[j + 2:j + 2 + 3000]})

out = [dict(v, queries=sorted(v['queries']), agents=sorted(v['agents'])) for v in links.values()]
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
json.dump(summaries, open(os.path.join(os.path.dirname(__file__), 'search_summaries.json'), 'w'), ensure_ascii=False, indent=1)
print(len(out), 'unique links;', len(summaries), 'successful searches')
