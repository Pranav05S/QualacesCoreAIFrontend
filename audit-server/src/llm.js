// Optional AI narrative. Enabled only when ANTHROPIC_API_KEY is set; otherwise the rules-based
// narrative from strategy.js is used. The model receives a compact, derived summary (scores and
// finding titles), never page content or screenshots, and may not change services or test cases.

const MODEL = () => process.env.AUDIT_LLM_MODEL || 'claude-sonnet-5-5';
const BASE = () => (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

export async function narrate({ target, scores, findings, strategy }) {
  const fallback = strategy.narrative;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;

  const payload = {
    site: new URL(target).hostname,
    scores,
    findings: findings.slice(0, 15).map((f) => ({ severity: f.severity, category: f.category, title: f.title })),
    recommendedServices: strategy.services.slice(0, 5).map((s) => s.name),
  };
  const prompt = `You write the executive summary of a website audit for a non-technical business owner.
Use ONLY the data below. Do not invent numbers, tools, prices, timelines or findings.
Reply with JSON only, in this exact shape:
{"executiveSummary": "2 to 3 plain sentences, under 600 characters", "actions": ["three short actions, each under 140 characters"]}

DATA:
${JSON.stringify(payload)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${BASE()}/v1/messages`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return fallback;
    const body = await r.json();
    const text = (body.content || []).map((c) => c.text || '').join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const summary = typeof json.executiveSummary === 'string' ? json.executiveSummary.trim() : '';
    const actions = Array.isArray(json.actions) ? json.actions.filter((a) => typeof a === 'string').map((a) => a.trim()).slice(0, 3) : [];
    if (!summary || summary.length > 800 || actions.length < 1) return fallback;
    return { source: 'ai', executiveSummary: summary, actions: actions.map((a) => a.slice(0, 200)) };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
