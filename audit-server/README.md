# Qualaces audit service

A small Node service that audits a public website and returns scores, findings and a test strategy.
It powers the **Free audit** page (`/audit.html`). Without it the page runs in sample-report mode.

## What it does

For one URL it:

1. reads the response headers over a guarded connection (HTTPS, redirects, security headers, cookies);
2. loads the page in headless Chromium at desktop and phone widths and measures timings, weight, console errors, failed requests and layout;
3. runs axe-core for accessibility;
4. checks `robots.txt`, `sitemap.xml`, the `www` certificate and a sample of links (up to 20 same-site and 10 external);
5. turns the findings into scores, a ranked list of Qualaces services, a four-phase plan and starter test cases.

Checks are **passive**. It never logs in, submits forms or tries to exploit anything.

## Run it

```bash
cd audit-server
npm ci
npm test                 # unit tests (no browser needed)
npm run test:e2e         # real-browser test, needs Chromium: E2E=1 CHROMIUM_PATH=/path/to/chrome
npm start                # listens on :8787
```

Chromium: use `npx playwright-core install chromium` locally, or set `CHROMIUM_PATH`.
In production use the supplied `Dockerfile` (it is based on the official Playwright image, which includes Chromium).

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `POST` | `/api/audit` | `{ "url": "example.com", "consent": true }` | `202 { id }` |
| `GET` | `/api/audit/:id` | | `{ status: queued/running/done/error, percent, steps[], result? , error? }` |
| `GET` | `/api/health` | | `{ ok: true }` |

Identical requests within 10 minutes share one job. Results are held in memory for one hour.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `ALLOWED_ORIGINS` | none | Comma-separated origins allowed by CORS, or `*`. **Set this to your website's origin.** |
| `TRUST_PROXY` | off | Set to `1` only behind a proxy you control, so `X-Forwarded-For` is used for rate limiting |
| `RATE_LIMIT_PER_HOUR` | `6` | Audits per IP per hour |
| `MAX_CONCURRENT` | `2` | Audits running at once (each uses a browser context) |
| `MAX_QUEUE` | `20` | Waiting audits before new ones get a 503 |
| `AUDIT_TIMEOUT_MS` | `100000` | Hard limit per audit |
| `AUDIT_EXTERNAL_LINKS` | on | Set to `0` to check only same-site links |
| `ANTHROPIC_API_KEY` | none | Optional. Enables an AI-written executive summary (see below) |
| `AUDIT_LLM_MODEL` | `claude-sonnet-5-5` | Model for the optional summary |
| `CHROMIUM_PATH` | bundled | Path to a Chromium executable |

## Connect it to the website

1. Deploy this folder anywhere that runs a Docker container (Render, Fly.io, Railway, Cloud Run, a VPS).
2. Set `ALLOWED_ORIGINS` to your site's origin, for example `https://qualaces.com`.
3. In the website repo, edit `assets/js/config.js`:
   ```js
   window.QA_AUDIT_API = "https://your-audit-service.example.com";
   ```
4. Commit. The audit page switches from sample mode to live mode.

For local development, open the audit page on `localhost` with `?api=http://localhost:8787` (this override is ignored on any other hostname).

## Security model

Running a service that fetches URLs chosen by strangers is risky, so this one is deliberately defensive.
It is tested (`test/security.test.js`) against the usual server-side request forgery tricks.

- Only `http` and `https`, only ports 80 and 443, no credentials in the URL.
- Hostnames must resolve **only** to public addresses. Loopback, private, link-local, CGNAT, multicast, reserved and cloud-metadata ranges are refused, including IPv6 and IPv4-mapped forms and numeric forms such as `2130706433` or `0x7f000001`.
- Every redirect hop is re-validated, and the connection is pinned to the validated address.
- Every browser sub-request goes through the same check, and every connected IP address is checked after the fact. If a page ever connects to a non-public address, the audit is discarded and no data or screenshot is returned.
- Per-IP rate limit, concurrency cap, bounded queue, request-size limit, hard timeout per audit.
- Unknown errors are masked in API responses.
- Report data from audited sites is only ever inserted into the page as text, never as HTML. CSV exports neutralise spreadsheet formulas.
- The test-only switch `ALLOW_LOOPBACK_TARGETS=1` permits `localhost` only. It can never permit private or metadata ranges. **Never set it in production.**

**Residual risk.** A hostile site could change its DNS answer between our check and the browser's own lookup (DNS rebinding). The post-connection address check closes this for anything that returns data, but a blind request could still be sent. Run the container with egress limited to the public internet (no route to internal networks or the metadata service), drop all capabilities, and keep it on its own network segment.

## Optional AI summary

If `ANTHROPIC_API_KEY` is set, the service asks the model to rewrite only the headline summary and top actions, from a compact summary of scores and finding titles. Page content and screenshots are never sent. The output is validated and falls back to the built-in rules-based summary on any problem. The model cannot change scores, recommended services or test cases, and the report labels which kind of summary it shows. This path is tested against a mock server, not against the live API.

## Limits to be honest about

- One page is measured in depth, in one browser, from one location. Numbers vary run to run.
- Automated accessibility scanning finds a minority of real issues.
- It is not a penetration test and does not measure cross-browser or real-device behaviour.
- The Dockerfile has not been built in the environment where this was written (no access to the base image registry), so run it once before relying on it.
