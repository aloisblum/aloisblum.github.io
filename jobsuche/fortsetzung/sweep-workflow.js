export const meta = {
  name: 'zurich-entry-jobs-sweep',
  description: 'Sweep web search for currently open entry-level jobs in Zurich/Zug/Schwyz across finance, consulting, tech and pharma employers',
  phases: [{ title: 'Search', detail: 'one agent per employer batch or keyword sweep' }],
}

const PROFILE = `The candidate: Master's student/graduate of the University of St. Gallen (HSG). Master's thesis = empirical study whether "prime" US office REITs outperform their conventional peers (risk-adjusted returns, property-level data on ~1,700 office assets of 99 REITs 2006–2024, S&P Capital IQ Pro / SNL, composite quality scores, panel/factor regressions). Holds a Bachelor and a Master (business/finance) plus several internships. Speaks German and English. Seeks a FIRST full-time position (entry level, start late 2026 or 2027) in Zurich and surroundings. Target areas: Asset Management, Wealth Management, Consulting, Investment Banking, Private Debt, Leveraged Finance, Hedge Funds, Family Offices, Private Equity, tech companies, pharma companies, and companies that hold and make direct corporate investments (holdings, investment companies, corporate M&A). Real-estate investment roles are an extra natural fit given the thesis.`

const RULES = `TOOLS: Only WebSearch works — load it first via ToolSearch with query "select:WebSearch". WebFetch and curl are blocked by the network egress proxy for practically all job sites (LinkedIn, jobs.ch, Indeed, Greenhouse, Google, eFinancialCareers…) — do not waste time on them. WebSearch returns result links (title + URL) plus a model-written summary. Use the allowed_domains parameter to force job-posting pages, for example:
- ["ch.linkedin.com","linkedin.com"] → individual postings look like ch.linkedin.com/jobs/view/<slug>-<numeric id>
- ["jobs.ch","jobup.ch"] → jobs.ch/de/stellenangebote/detail/<id> or jobs.ch/en/vacancies/detail/<id>
- ["efinancialcareers.ch","efinancialcareers.com","efinancialcareers.co.uk","efinancialcareers.de"]
- the employer's own career domain (e.g. jobs.ubs.com, careers.<company>.com, <tenant>.myworkdayjobs.com, jobs.smartrecruiters.com, boards.greenhouse.io, job-boards.greenhouse.io, jobs.lever.co, successfactors, softgarden, join.com, personio)
- ["ch.indeed.com","glassdoor.ch","glassdoor.com","jobscout24.ch","careerjet.ch","jobs.ch"]
Also run some searches WITHOUT allowed_domains. Run MANY queries: typically 4–8 per large employer and 2–4 per small one; 30–70 queries in total is normal. Vary English and German keywords (Analyst, Associate, Graduate, Junior, Trainee, Einstieg, Absolvent, Hochschulabsolvent, Berufseinsteiger, Praktikum), towns (Zürich, Zurich, Zug, Baar, Cham, Rotkreuz, Pfäffikon SZ, Freienbach, Wollerau, Winterthur, Opfikon …) and the years 2026 / 2027.

INCLUSION RULES
Region — core: Kanton Zürich, Kanton Zug, Kanton Schwyz. Extended (still include, set canton accordingly): Aargau (Baden, Aarau, Zofingen …), St. Gallen Linth area (Rapperswil-Jona, Uznach), Luzern area, Schaffhausen. Exclude roles located only in Geneva, Lausanne, Basel, Bern, Ticino or abroad.
Level — include roles a fresh Master's graduate with several internships can realistically get: graduate/trainee programmes; Analyst / Junior / entry roles; Associate roles asking ≤3 years; 'Einstieg', 'Berufseinsteiger', 'Hochschulabsolvent'. Also include roles asking 2–4 years as level "Stretch (2–4 J.)". Include internships ONLY if explicitly open to graduates (e.g. 'nach Abschluss', 'graduate internship', 'post-Master', 'Hochschulpraktikum') → level "Praktikum (Absolventen)". EXCLUDE: senior roles (5+ years, VP, Director, Head, Lead, Senior Manager, Partner), pure software engineering / IT infrastructure, lab / clinical / scientific research, legal roles requiring a bar exam, secretarial/admin, apprenticeships (Lehrstellen), student-only internships and working-student (Werkstudent) jobs.
Function — at finance firms include investment, advisory, client-facing (incl. junior/assistant relationship manager), research, product, risk, treasury, finance/controlling, strategy, business analysis, data/quant analytics, and EVERY graduate-programme track. At tech, pharma and industrial companies include only business roles: finance/FP&A/controlling/treasury, corporate development/M&A/strategy, BizOps / strategy & operations, business analyst, business development / BD&L, internal consulting, commercial / market-access analytics, data / BI analyst, entry sales or account management, associate product / program manager.
Freshness — today is 2026-09-28. Include only postings that plausibly are open now. Evidence: intake year 2026/2027 in the title, posting date in snippet (roughly June 2026 or later), 'x days ago', rolling programmes. Exclude postings clearly for past intakes (e.g. '2025 Graduate Program', 'Summer 2025') or marked closed / 'no longer accepting applications'. If you cannot tell, include with confidence "niedrig". For LinkedIn postings always keep the full /jobs/view/ URL (its numeric ID indicates age).
Honesty — every job MUST correspond to a real result link you saw (title/URL). Never invent URLs, titles or postings. Prefer the individual posting URL over search-list pages. A search-list page like "21 Jobs für Partners Group in Baar" is NOT a posting — do not turn it into entries (you may mention it in companies_checked). Deduplicate within your own output (same role on LinkedIn and jobs.ch → one entry; keep the most direct URL and mention the other in notes).
fit — "hoch" = investment / valuation / research / PE / private debt / AM / real-estate investment / M&A analyst roles that use empirical finance and real-estate knowledge; "mittel" = other finance, consulting, strategy, business-analyst roles; "gering" = tangential (sales, marketing, HR, operations, general admin tracks).
Output everything via the structured output tool. Write titles exactly as posted; notes short (≤25 words: key requirements, start date, deadline).`

const SECTORS = ['Investment Banking', 'Leveraged Finance', 'Private Debt', 'Private Equity', 'Venture Capital', 'Hedge Fund / Trading', 'Asset Management', 'Wealth Management', 'Family Office', 'Beteiligungsgesellschaft / Holding', 'Corporate Development / M&A (Konzern)', 'Consulting', 'Real Estate Investment', 'Tech', 'Pharma / Biotech / Medtech', 'Insurance / Pension / Zentralbank', 'Fintech / Digital Assets', 'Research / Ratings / Finanzdaten', 'Sonstiges']

const SCHEMA = {
  type: 'object',
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          sector: { type: 'string', enum: SECTORS },
          function: { type: 'string' },
          level: { type: 'string', enum: ['Graduate-/Traineeprogramm', 'Einstieg / Analyst / Junior', 'Associate (0–3 J.)', 'Stretch (2–4 J.)', 'Praktikum (Absolventen)', 'Unklar'] },
          location: { type: 'string' },
          canton: { type: 'string', enum: ['ZH', 'ZG', 'SZ', 'AG', 'SG', 'LU', 'SH', 'Mehrere', 'Unklar'] },
          url: { type: 'string' },
          source: { type: 'string', enum: ['Firmen-Website', 'LinkedIn', 'jobs.ch / jobup.ch', 'eFinancialCareers', 'Indeed', 'Glassdoor', 'Hochschul-Portal', 'Recruiter', 'Andere'] },
          posted_or_deadline: { type: 'string' },
          recency_evidence: { type: 'string' },
          confidence: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] },
          fit: { type: 'string', enum: ['hoch', 'mittel', 'gering'] },
          language: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['title', 'company', 'sector', 'level', 'location', 'canton', 'url', 'source', 'confidence', 'fit'],
      },
    },
    companies_checked: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          result: { type: 'string', enum: ['Stellen gefunden', 'keine passenden Stellen gefunden', 'keine öffentlichen Ausschreibungen / unklar'] },
          note: { type: 'string' },
        },
        required: ['company', 'result'],
      },
    },
    suggested_additional_employers: { type: 'array', items: { type: 'string' } },
  },
  required: ['jobs', 'companies_checked', 'suggested_additional_employers'],
}

function assignment(b) {
  if (b.mode === 'keyword') {
    return `MODE: KEYWORD SWEEP (${b.id}) — theme: ${b.theme}
Sweep job boards and career sites for this theme. Find as many DISTINCT currently-open postings as possible from ANY employer (large firms, boutiques, family offices, start-ups, and postings published via recruiters such as Selby Jennings, Walker Hamill, Robert Walters, Michael Page, Hays, Morgan McKinley). Starting queries — extend them generously with variants, synonyms, German/English and other towns in the region:
${b.queries.map(q => '- ' + q).join('\n')}
In companies_checked list the employers whose postings you found (result "Stellen gefunden").`
  }
  return `MODE: EMPLOYER SWEEP (${b.id}) — ${b.title}
For EACH employer below, find every currently-open position in the target region that fits the rules. Do not stop after the first hit — large employers often have 5–30 fitting openings. Report every employer in companies_checked.
${b.companies.map(c => '- ' + c).join('\n')}
${b.focus ? 'Extra focus: ' + b.focus : ''}
If you come across other relevant employers/postings in the region while searching, include those postings too.`
}

function prompt(b) {
  return `You are researching OPEN JOB POSTINGS for a job seeker. Today is 2026-09-28.

${PROFILE}

${assignment(b)}

${RULES}`
}

phase('Search')
const results = await parallel(args.batches.map(b => () =>
  agent(prompt(b), { label: b.id, phase: 'Search', schema: SCHEMA })))

return {
  group: args.group,
  summary: results.map((r, i) => r
    ? { id: args.batches[i].id, jobs: r.jobs.length, checked: r.companies_checked.length, suggested: r.suggested_additional_employers.length }
    : { id: args.batches[i].id, failed: true }),
}
