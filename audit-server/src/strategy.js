// Turns findings into a test strategy mapped to Qualaces services.
// Fully deterministic: the same findings always give the same plan. An optional AI layer (llm.js)
// only rewrites the narrative; it never changes services, phases or test cases.

import { SERVICE_NAMES, SEVERITY_WEIGHT } from './checks.js';

const SEV_POINTS = { critical: 8, high: 5, medium: 3, low: 1, info: 0.25 };
const QUALITY_SERVICES = ['performance', 'security', 'usability', 'compatibility', 'mobile'];

const SERVICE_BLURB = {
  smoke: 'Confirms the critical journeys work on every build.',
  sanity: 'Quickly verifies each fix and its neighbours.',
  regression: 'Proves new changes do not break existing behaviour.',
  ticket: 'Closes each finding against its ticket.',
  performance: 'Measures speed and load behaviour against targets.',
  security: 'Goes deeper than headers into real vulnerabilities.',
  usability: 'Checks that real people can complete real tasks, including with assistive technology.',
  compatibility: 'Covers the browsers and devices an automated audit cannot.',
  mobile: 'Tests the phone experience on real devices.',
  automation: 'Turns repeatable checks into a pipeline that runs on every change.',
  consulting: 'Plans what to test and in what order.',
  management: 'Tracks what was tested, what failed and what it means for release.',
  ai: 'Applies AI-assisted techniques to testing.',
};

export function buildStrategy({ findings, scores, profile, target }) {
  /* ---- rank services ---- */
  const tally = {};
  const bump = (id, pts, reason) => {
    if (!SERVICE_NAMES[id]) return;
    tally[id] = tally[id] || { id, score: 0, reasons: [] };
    tally[id].score += pts;
    if (reason && !tally[id].reasons.includes(reason)) tally[id].reasons.push(reason);
  };
  for (const f of findings) {
    f.services.forEach((id, i) => bump(id, SEV_POINTS[f.severity] * (i === 0 ? 1 : 0.6), f.title));
  }
  if (profile.hasLogin) { bump('security', 2, 'The page has a login form'); bump('smoke', 1, 'The page has a login form'); }
  if (profile.forms) bump('regression', 1, 'The page contains forms that must keep working');
  if (profile.clientRendered) bump('automation', 1.5, 'Content is rendered by JavaScript, which suits automated browser checks');
  if (profile.thirdParties > 8) bump('performance', 1, 'Many third-party domains affect speed and reliability');
  bump('compatibility', 1, 'An automated audit covers one browser only');
  const hasHigh = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
  if (hasHigh) bump('smoke', 2, 'There are high-severity issues, so critical paths need a safety net');

  const ranked = Object.values(tally).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const services = ranked.slice(0, 7).map((s, i) => ({
    id: s.id, name: SERVICE_NAMES[s.id], score: Math.round(s.score * 10) / 10,
    priority: i < 2 ? 'Start here' : i < 5 ? 'Next' : 'Later',
    why: SERVICE_BLURB[s.id] || '', reasons: s.reasons.slice(0, 3),
  }));

  /* ---- phases ---- */
  const seriousFindings = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const sizeOf = (n) => (n <= 3 ? 'Small' : n <= 8 ? 'Medium' : 'Large');
  const journeys = ['Home page loads and is usable'];
  if (profile.navLinks) journeys.push('Main navigation links reach the right pages');
  if (profile.hasSearch) journeys.push('Search returns results');
  if (profile.hasLogin) journeys.push('A user can sign in and out');
  if (profile.forms) journeys.push('Each form validates input and submits successfully');
  if (journeys.length < 3) journeys.push('The primary call-to-action works');

  const deep = ranked.filter((s) => QUALITY_SERVICES.includes(s.id)).slice(0, 3);
  const phases = [
    { key: 'gate', title: 'Phase 1. Protect the basics', services: ['smoke'], size: 'Small',
      goal: 'A quick pass/fail check on the journeys that must never break, run on every build.', items: journeys },
    { key: 'fix', title: 'Phase 2. Fix and verify', services: ['sanity', 'ticket'], size: sizeOf(seriousFindings.length),
      goal: seriousFindings.length ? 'Resolve the most serious findings and confirm each fix.' : 'No critical or high findings. Verify any medium items you choose to fix.',
      items: (seriousFindings.length ? seriousFindings : findings.filter((f) => f.severity === 'medium')).slice(0, 6).map((f) => f.title) },
    { key: 'deep', title: 'Phase 3. Go deeper', services: deep.map((d) => d.id), size: deep.length > 2 ? 'Large' : 'Medium',
      goal: 'Specialist testing where the audit found the most risk, and where it cannot see.',
      items: deep.map((d) => `${SERVICE_NAMES[d.id]}: ${SERVICE_BLURB[d.id]}`) },
    { key: 'sustain', title: 'Phase 4. Keep it fixed', services: ['regression', 'automation', 'management'], size: 'Medium',
      goal: 'Automate the checks you will repeat and report on them, so quality does not slip back.',
      items: ['Automate the Phase 1 journeys in CI', 'Add header, accessibility and performance-budget checks to the pipeline', 'Track results and trends in one report'] },
  ];

  /* ---- test cases ---- */
  const cases = [];
  const addCase = (c) => cases.push({ id: `TC-${String(cases.length + 1).padStart(2, '0')}`, ...c });
  journeys.forEach((j) => addCase({ title: j, area: 'Smoke', priority: 'High', source: 'profile', steps: ['Open the site in a clean browser session', `Perform: ${j.toLowerCase()}`], expected: 'The journey completes without errors' }));
  for (const f of findings) {
    if (f.testCase && cases.length < 18) addCase({ ...f.testCase, area: f.category[0].toUpperCase() + f.category.slice(1), priority: f.severity === 'critical' || f.severity === 'high' ? 'High' : 'Medium', source: 'finding', findingId: f.id });
  }
  if (cases.length < 18) addCase({ title: 'Keyboard-only navigation reaches every interactive control', area: 'Accessibility', priority: 'Medium', source: 'profile', steps: ['Use only Tab, Shift+Tab, Enter and Space', 'Visit every link, button and field'], expected: 'Focus is always visible and nothing is unreachable' });
  if (cases.length < 18) addCase({ title: 'Page renders correctly in Firefox and Safari as well as Chromium', area: 'Compatibility', priority: 'Medium', source: 'profile', steps: ['Open the home page in Firefox and Safari', 'Compare layout and behaviour with Chromium'], expected: 'No layout break or functional difference' });

  /* ---- narrative (rules-based) ---- */
  const cats = ['performance', 'accessibility', 'seo', 'security', 'reliability', 'mobile'];
  const sorted = cats.map((c) => [c, scores[c]]).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const counts = ['critical', 'high', 'medium', 'low'].map((s) => [s, findings.filter((f) => f.severity === s).length]).filter(([, n]) => n);
  const countText = counts.length ? counts.map(([s, n]) => `${n} ${s}`).join(', ') : 'no';
  const first = services[0];
  const executiveSummary = `${host(target)} scores ${scores.overall} out of 100. Its strongest area is ${best[0]} (${best[1]}) and its weakest is ${worst[0]} (${worst[1]}). The audit found ${countText} issues. The best place to start is ${first ? first.name.toLowerCase() : 'smoke testing'}${services[1] ? `, followed by ${services[1].name.toLowerCase()}` : ''}.`;
  const actions = seriousFindings.slice(0, 3).map((f) => f.title);
  while (actions.length < 3 && findings[actions.length]) actions.push(findings[actions.length].title);

  return {
    services, phases, testCases: cases,
    risks: findings.slice(0, 3).map((f) => ({ title: f.title, severity: f.severity })),
    narrative: { source: 'rules', executiveSummary, actions },
  };
}

function host(target) { try { return new URL(target).hostname; } catch { return 'The site'; } }
