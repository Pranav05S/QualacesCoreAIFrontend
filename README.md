# Qualaces website (redesign)

Static site: plain HTML, CSS and vanilla JS. No framework and no bundler, so it hosts on any static host.

- `python3 build.py` regenerates all pages (copy lives in `build.py`; styling in `assets/css/styles.css`; behaviour in `assets/js/main.js`).
- Preview: `python3 -m http.server` in this folder.
- Contact form: `CONFIG` at the top of `assets/js/main.js` (EmailJS keys carried over from the old site; set `endpoint` to use your own backend). On failure it falls back to a pre-filled `mailto:`.
- Interface previews on the QTM page are illustrative; swap in real screenshots when available.
- Quick find: Ctrl/⌘ + K (or `/`).

## Deploying
Pushes to `main` publish the site via GitHub Pages (`.github/workflows/pages.yml`). One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

## Free audit tool
`/audit.html` is an interactive site auditor: enter a URL and get scores, findings and a test strategy mapped to Qualaces services.

- **Front end** (this site): `assets/js/audit.js`, `assets/css/audit.css`. It runs in sample-report mode out of the box (`assets/data/sample-report.json`, a real audit of the previous qualaces.com).
- **Back end**: `audit-server/` (Node + Playwright). It needs a host that runs containers, because GitHub Pages is static. See `audit-server/README.md` for deployment, the security model and limits.
- **Connect them** by setting `window.QA_AUDIT_API` in `assets/js/config.js` to the deployed service URL.

