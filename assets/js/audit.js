/* Free site audit: intake, live progress, report rendering and exports.
   Security note: every value that originates from an audited site (titles, URLs, element snippets,
   console messages) is inserted with textContent via h(), never as HTML. */
(function () {
  "use strict";

  var API = (window.QA_AUDIT_API || "").replace(/\/+$/, "");
  var qs = new URLSearchParams(location.search);
  if (qs.get("api") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) API = qs.get("api").replace(/\/+$/, ""); // local development only

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- tiny safe DOM builder ---------- */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(parent, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(parent, x); });
    else parent.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  var SERVICE_IDS = {}; (window.QA_SERVICES || []).forEach(function (s) { SERVICE_IDS[s.id] = s.name; });
  var STEPS = [
    ["connect", "Connect and read response headers"], ["transport", "Check HTTPS redirect, robots.txt and sitemap"],
    ["browser", "Load the page in a desktop browser"], ["axe", "Scan for accessibility issues"], ["mobile", "Check the phone layout"],
    ["links", "Check links"], ["analyse", "Build findings and test strategy"]
  ];
  var CATS = ["performance", "accessibility", "seo", "security", "reliability", "mobile"];
  var CAT_LABEL = { performance: "Performance", accessibility: "Accessibility", seo: "SEO", security: "Security", reliability: "Reliability", mobile: "Mobile" };
  var SEVS = ["critical", "high", "medium", "low", "info"];

  var tone = function (n) { return n >= 90 ? "good" : n >= 70 ? "ok" : "bad"; };
  var fmtMs = function (n) { return n >= 1000 ? (n / 1000).toFixed(1) + " s" : Math.round(n) + " ms"; };
  var fmtBytes = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"; };
  var host = function (u) { try { return new URL(u).hostname; } catch (e) { return u; } };

  /* ---------- elements ---------- */
  var form = $("#audit-form"), urlIn = $("#audit-url"), consent = $("#audit-consent"), errEl = $("#audit-err"),
      runBtn = $("#audit-run"), sampleBtn = $("#audit-sample"), offline = $("#audit-offline"),
      prog = $("#audit-progress"), report = $("#audit-report");
  if (!form) return;
  var current = null; // the report being displayed
  var busy = false;

  if (!API) {
    offline.hidden = false;
    runBtn.disabled = true; runBtn.setAttribute("aria-disabled", "true");
  }
  if (qs.get("url")) urlIn.value = qs.get("url");

  function showError(msg) { errEl.textContent = msg || ""; errEl.classList.toggle("show", !!msg); }

  /* ---------- run a live audit ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    showError("");
    if (!API) { showError("Live scanning is not connected on this deployment yet. You can still view the sample report."); return; }
    var u = urlIn.value.trim();
    if (!u) { showError("Enter the address of the site you want to audit."); urlIn.focus(); return; }
    if (!consent.checked) { showError("Please confirm you own this site or have permission to test it."); consent.focus(); return; }
    start(u);
  });

  function setBusy(on) { busy = on; runBtn.disabled = on || !API; sampleBtn.disabled = on; runBtn.firstChild.textContent = on ? "Auditing… " : "Run audit "; }

  function start(u) {
    setBusy(true); report.hidden = true; report.textContent = "";
    prog.hidden = false; renderProgress(u, [], 2, 0);
    prog.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    fetch(API + "/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u, consent: true }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error((x.j && x.j.error && x.j.error.message) || "The audit could not be started.");
        poll(x.j.id, u, Date.now());
      })
      .catch(function (err) { fail(err.message && err.message !== "Failed to fetch" ? err.message : "We could not reach the audit service. Please try again in a moment."); });
  }

  function poll(id, u, t0) {
    fetch(API + "/api/audit/" + id)
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error((x.j && x.j.error && x.j.error.message) || "The audit could not be found.");
        var j = x.j;
        if (j.status === "done") { prog.hidden = true; setBusy(false); show(j.result, false); return; }
        if (j.status === "error") { fail((j.error && j.error.message) || "The audit failed."); return; }
        if (Date.now() - t0 > 150000) { fail("The audit is taking longer than expected. Please try again."); return; }
        renderProgress(u, j.steps || [], j.percent || 4, j.position || 0);
        setTimeout(function () { poll(id, u, t0); }, 1200);
      })
      .catch(function (err) { fail(err.message && err.message !== "Failed to fetch" ? err.message : "We lost contact with the audit service. Please try again."); });
  }

  function fail(msg) { prog.hidden = true; setBusy(false); showError(msg); urlIn.focus(); }

  function renderProgress(u, steps, pct, position) {
    var seen = {}; steps.forEach(function (s) { seen[s.key] = true; });
    var lastIdx = -1; STEPS.forEach(function (s, i) { if (seen[s[0]]) lastIdx = i; });
    prog.textContent = "";
    add(prog, [
      h("h2", { text: position ? "Waiting in line" : "Auditing your site" }),
      h("p", { class: "sub", text: position ? "You are number " + position + " in the queue. " + u : u }),
      h("div", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": "Audit progress" }, h("i", { style: "width:" + pct + "%" })),
      h("div", { "aria-live": "polite" }, STEPS.map(function (s, i) {
        var cls = i < lastIdx ? "done" : i === lastIdx ? "now" : "";
        return h("div", { class: "pstep " + cls }, h("span", { class: "ic", "aria-hidden": "true", text: cls === "done" ? "✓" : "" }), h("span", { text: s[1] }));
      }))
    ]);
  }

  /* ---------- sample report ---------- */
  sampleBtn.addEventListener("click", loadSample);
  function loadSample() {
    if (busy) return;
    showError("");
    sampleBtn.disabled = true;
    fetch("assets/data/sample-report.json")
      .then(function (r) { if (!r.ok) throw new Error("missing"); return r.json(); })
      .then(function (j) { show(j, true); })
      .catch(function () { showError("The sample report could not be loaded here. If you opened this file directly from disk, serve the folder over http instead."); })
      .finally(function () { sampleBtn.disabled = false; });
  }
  if (location.hash === "#sample" || qs.get("sample") === "1") loadSample();

  /* ---------- report ---------- */
  function show(r, isSample) {
    current = r;
    report.textContent = "";
    report.hidden = false;
    report.appendChild(buildReport(r, isSample));
    animate();
    var hd = $("#rep-title"); if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); }
    report.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  function animate() {
    var go = function () {
      report.querySelectorAll(".ring .fg").forEach(function (c) { c.style.strokeDashoffset = c.getAttribute("data-off"); });
      report.querySelectorAll(".cat .bar i").forEach(function (i) { i.style.width = i.getAttribute("data-w") + "%"; });
    };
    if (reduce) go(); else requestAnimationFrame(function () { requestAnimationFrame(go); });
  }

  function buildReport(r, isSample) {
    var wrap = h("div", { class: "report-inner" });
    var s = r.scores || {};
    if (isSample) add(wrap, h("p", { class: "sample-note" }, h("strong", { text: "Sample report. " }), (r.sample && r.sample.label) || "This is an example of what you will get.", " ", (r.sample && r.sample.note) || ""));

    // header
    var C = 2 * Math.PI * 54, off = C * (1 - (s.overall || 0) / 100);
    var svg = svgEl("svg", { viewBox: "0 0 120 120", "aria-hidden": "true" });
    svg.appendChild(svgEl("circle", { class: "bg", cx: 60, cy: 60, r: 54 }));
    svg.appendChild(svgEl("circle", { class: "fg " + tone(s.overall), cx: 60, cy: 60, r: 54, "data-off": off.toFixed(1) }));
    var ring = h("div", { class: "ring", role: "img", "aria-label": "Overall score " + s.overall + " out of 100, grade " + s.grade },
      svg, h("div", { class: "num" }, h("b", { text: String(s.overall) }), h("span", { text: "Grade " + s.grade })));

    var n = r.strategy && r.strategy.narrative || {};
    var head = h("div", { class: "rep-head" }, ring, h("div", null,
      h("div", { class: "rep-meta" }, h("span", { text: host(r.finalUrl || r.target) }), h("span", { text: new Date(r.auditedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) }),
        isSample ? h("span", { class: "tag sample", text: "Sample" }) : null,
        n.source ? h("span", { class: "tag src", text: n.source === "ai" ? "AI-written summary" : "Rules-based summary" }) : null),
      h("h2", { id: "rep-title", text: "Audit report for " + host(r.finalUrl || r.target) }),
      h("p", { class: "summary", text: n.executiveSummary || "" }),
      n.actions && n.actions.length ? h("ul", { class: "actions-list", "aria-label": "Top actions" }, n.actions.map(function (a) { return h("li", { text: a }); })) : null,
      h("div", { class: "rep-tools" },
        h("button", { class: "btn sm", type: "button", onclick: function (e) { copyText(toMarkdown(r), e.currentTarget, "Copied as Markdown"); } }, "Copy as Markdown"),
        h("button", { class: "btn sm ghost", type: "button", onclick: function () { download("qualaces-audit-" + host(r.target) + ".json", JSON.stringify(withoutShots(r), null, 2), "application/json"); } }, "Download JSON"),
        h("button", { class: "btn sm ghost", type: "button", onclick: printReport }, "Print or save as PDF"))));
    add(wrap, head);

    // categories
    add(wrap, section("Scores by area", "Each area starts at 100 and loses points for every finding, weighted by severity.",
      h("div", { class: "cats" }, CATS.map(function (c) {
        var v = s[c];
        return h("div", { class: "cat" }, h("span", { class: "n", text: CAT_LABEL[c] }),
          h("div", { class: "bar", role: "img", "aria-label": CAT_LABEL[c] + " " + v + " out of 100" }, h("i", { class: "fill " + tone(v), "data-w": String(v) })),
          h("span", { class: "v", text: String(v) }));
      }))));

    // metrics
    var m = r.metrics || {};
    add(wrap, section("What was measured", "One run in a real browser. Markers show where the value falls between good, needs work and poor.",
      h("div", { class: "gauges" }, [
        gauge("Largest Contentful Paint", m.lcp, 2500, 4000, 6000, fmtMs),
        gauge("First Contentful Paint", m.fcp, 1800, 3000, 5000, fmtMs),
        gauge("Server response (TTFB)", m.ttfb, 800, 1800, 3000, fmtMs),
        gauge("Layout shift (CLS)", m.cls, 0.1, 0.25, 0.5, function (v) { return v.toFixed(2); }, true),
        gauge("Blocking time", m.tbt, 200, 600, 1200, fmtMs, true),
        gauge("Page weight", m.transferBytes, 2 * 1048576, 5 * 1048576, 8 * 1048576, fmtBytes),
        gauge("Requests", m.requests, 80, 150, 250, function (v) { return String(Math.round(v)); })
      ])));

    // findings
    add(wrap, findingsSection(r));

    // screenshots
    var shots = r.screenshots || {};
    if (isImg(shots.desktop) || isImg(shots.mobile)) {
      add(wrap, section("How it rendered", "What the audit's browser saw.", h("div", { class: "shots" },
        isImg(shots.desktop) ? h("figure", null, h("img", { src: shots.desktop, alt: "Screenshot of the page at desktop width", loading: "lazy" }), h("figcaption", { text: "Desktop, 1366 × 768" })) : null,
        isImg(shots.mobile) ? h("figure", { class: "m" }, h("img", { src: shots.mobile, alt: "Screenshot of the page at phone width", loading: "lazy" }), h("figcaption", { text: "Phone, 390 × 844" })) : null)));
    }

    // strategy
    add(wrap, strategySection(r));

    // limits + cta
    add(wrap, section("What this audit cannot tell you", "Automated checks are a fast, honest first look, not the whole picture.", h("ul", { class: "limits" }, (r.limitations || []).map(function (l) { return h("li", { text: l }); }))));
    add(wrap, ctaBlock(r));
    return wrap;
  }

  function svgEl(tag, attrs) { var e = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function isImg(s) { return typeof s === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s); }
  function section(title, sub, body) { return h("section", { class: "rep-sec" }, h("h3", { text: title }), sub ? h("p", { class: "sub", text: sub }) : null, body); }

  function gauge(name, v, good, poor, max, fmt, zeroOk) {
    if (v == null || isNaN(v) || (v === 0 && !zeroOk)) return h("div", { class: "gauge na" }, h("div", { class: "top" }, h("span", { class: "nm", text: name }), h("span", { class: "val", text: "n/a" })));
    var pos = Math.min(1, v / max) * 100;
    var rate = v <= good ? "Good" : v <= poor ? "Needs improvement" : "Poor";
    return h("div", { class: "gauge" },
      h("div", { class: "top" }, h("span", { class: "nm", text: name }), h("span", { class: "val", text: fmt(v) })),
      h("div", { class: "zones", role: "img", "aria-label": name + " " + fmt(v) + ", " + rate },
        h("i", { style: "width:" + (good / max * 100) + "%" }), h("i", { style: "width:" + ((poor - good) / max * 100) + "%" }), h("i", { style: "flex:1" }),
        h("span", { class: "mk", style: "left:" + pos + "%" })),
      h("div", { class: "rate", text: rate + " (good up to " + fmt(good) + ")" }));
  }

  function findingsSection(r) {
    var all = r.findings || [];
    var state = { sev: "all", cat: "all" };
    var list = h("div", { class: "findings" });
    var bar = h("div", { class: "filters2", role: "group", "aria-label": "Filter findings" });
    var count = function (k, v) { return all.filter(function (f) { return v === "all" || f[k] === v; }).length; };
    var chips = [];
    function chip(label, k, v) {
      var c = h("button", { class: "chip", type: "button", "aria-pressed": String(state[k] === v), onclick: function () { state[k] = v; refresh(); } }, label, h("span", { class: "c", text: String(count(k, v)) }));
      c.dataset.k = k; c.dataset.v = v; chips.push(c); return c;
    }
    bar.appendChild(chip("All", "sev", "all"));
    SEVS.forEach(function (s) { var c = h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: function () { state.sev = s; refresh(); } }, s[0].toUpperCase() + s.slice(1), h("span", { class: "c", text: String(all.filter(function (f) { return f.severity === s; }).length) })); c.dataset.k = "sev"; c.dataset.v = s; chips.push(c); if (all.some(function (f) { return f.severity === s; })) bar.appendChild(c); });
    var catBar = h("div", { class: "filters2", role: "group", "aria-label": "Filter by area" });
    var ca = h("button", { class: "chip", type: "button", "aria-pressed": "true", onclick: function () { state.cat = "all"; refresh(); } }, "All areas"); ca.dataset.k = "cat"; ca.dataset.v = "all"; chips.push(ca); catBar.appendChild(ca);
    CATS.forEach(function (c) { if (!all.some(function (f) { return f.category === c; })) return; var b = h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: function () { state.cat = c; refresh(); } }, CAT_LABEL[c], h("span", { class: "c", text: String(all.filter(function (f) { return f.category === c; }).length) })); b.dataset.k = "cat"; b.dataset.v = c; chips.push(b); catBar.appendChild(b); });

    var items = all.map(function (f) { var el = findingEl(f); el.dataset.sev = f.severity; el.dataset.cat = f.category; list.appendChild(el); return el; });
    var empty = h("p", { class: "empty-note", hidden: true, text: "No findings match these filters." });
    function refresh() {
      chips.forEach(function (c) { c.setAttribute("aria-pressed", String(state[c.dataset.k === "sev" ? "sev" : "cat"] === c.dataset.v)); });
      var shown = 0;
      items.forEach(function (el) { var ok = (state.sev === "all" || el.dataset.sev === state.sev) && (state.cat === "all" || el.dataset.cat === state.cat); el.hidden = !ok; if (ok) shown++; });
      empty.hidden = shown > 0;
    }
    var body = all.length ? [bar, catBar, list, empty] : [h("p", { class: "empty-note", text: "No findings. Nothing the audit measures needs attention." })];
    refresh();
    return section("Findings", all.length + " finding" + (all.length === 1 ? "" : "s") + ", most serious first. Open one for the detail and the fix.", h("div", null, body));
  }

  function findingEl(f) {
    var body = h("div", { class: "f-body" },
      h("p", { text: f.detail }),
      f.evidence && f.evidence.length ? h("div", null, h("h4", { text: "Evidence" }), h("ul", { class: "evid" }, f.evidence.map(function (e) { return h("li", { text: e }); }))) : null,
      h("div", null, h("h4", { text: "How to fix" }), h("p", { text: f.fix })),
      f.services && f.services.length ? h("div", null, h("h4", { text: "Where Qualaces can help" }),
        h("div", { class: "f-chips" }, f.services.filter(function (id) { return SERVICE_IDS[id]; }).map(function (id) { return h("a", { href: "services.html#" + id, text: SERVICE_IDS[id] }); }))) : null);
    return h("details", { class: "finding" },
      h("summary", null, h("span", { class: "sev " + f.severity, text: f.severity }), h("span", { class: "t", text: f.title }), h("span", { class: "cat-t", text: CAT_LABEL[f.category] || f.category })), body);
  }

  function strategySection(r) {
    var st = r.strategy || {};
    var wrap = h("section", { class: "rep-sec" }, h("h3", { text: "Your recommended test strategy" }),
      h("p", { class: "sub", text: "Built from your findings and mapped to Qualaces services. The same findings always produce the same plan." }));
    add(wrap, h("h4", { class: "h-md", style: "margin:0 0 14px", text: "Where to focus" }));
    add(wrap, h("ul", { class: "svc-rank" }, (st.services || []).map(function (s) {
      var cls = s.priority === "Start here" ? "start" : s.priority === "Next" ? "next" : "later";
      return h("li", null, h("div", null, h("span", { class: "prio " + cls, text: s.priority })),
        h("div", null, h("div", { class: "nm" }, h("a", { href: "services.html#" + s.id, text: s.name })), h("p", { class: "why", text: s.why })),
        h("ul", { "aria-label": "Why " + s.name }, (s.reasons || []).map(function (x) { return h("li", { text: x }); })));
    })));
    add(wrap, h("h4", { class: "h-md", style: "margin:0 0 14px", text: "A phased plan" }));
    add(wrap, h("ol", { class: "phases" }, (st.phases || []).map(function (p) {
      return h("li", { class: "phase" }, h("span", { class: "size", text: "Effort: " + p.size }), h("h4", { text: p.title }), h("p", { text: p.goal }),
        h("ul", null, (p.items || []).map(function (i) { return h("li", { text: i }); })),
        h("div", { class: "svs" }, (p.services || []).filter(function (id) { return SERVICE_IDS[id]; }).map(function (id) { return h("span", { text: SERVICE_IDS[id] }); })));
    })));
    add(wrap, h("h4", { class: "h-md", style: "margin:0 0 14px", text: "Test cases to start with" }));
    var rows = (st.testCases || []).map(function (c) {
      return h("tr", null, h("td", { class: "id", text: c.id }),
        h("td", null, h("details", null, h("summary", { text: c.title }), h("ol", null, (c.steps || []).map(function (x) { return h("li", { text: x }); })), h("p", null, h("strong", { text: "Expected: " }), c.expected))),
        h("td", { text: c.area }), h("td", { class: c.priority === "High" ? "pri-high" : "", text: c.priority }));
    });
    add(wrap, h("div", { class: "tc-wrap" }, h("table", { class: "tc" }, h("caption", { class: "sr-only", text: "Suggested test cases" }),
      h("thead", null, h("tr", null, ["ID", "Test case", "Area", "Priority"].map(function (x) { return h("th", { scope: "col", text: x }); }))), h("tbody", null, rows))));
    add(wrap, h("div", { class: "tc-tools" },
      h("button", { class: "btn sm ghost", type: "button", onclick: function (e) { copyText(casesText(r), e.currentTarget, "Copied test cases"); } }, "Copy test cases"),
      h("button", { class: "btn sm ghost", type: "button", onclick: function () { download("qualaces-test-cases.csv", casesCsv(r), "text/csv"); } }, "Download CSV")));
    return wrap;
  }

  function ctaBlock(r) {
    var names = ((r.strategy && r.strategy.services) || []).slice(0, 3).map(function (s) { return s.name; });
    var top = (r.findings || []).slice(0, 3).map(function (f) { return "- " + f.title; }).join("\n");
    var note = "I ran the Qualaces site audit on " + host(r.finalUrl || r.target) + " (score " + r.scores.overall + "/100, grade " + r.scores.grade + ").\n\nTop findings:\n" + top + "\n\nI'd like to talk about " + names.join(", ") + ".";
    var href = "contact-us.html?topics=" + encodeURIComponent(names.join(",")) + "&note=" + encodeURIComponent(note.slice(0, 1500)) + "#form";
    return h("section", { class: "rep-cta" }, h("div", null, h("h3", { text: "Want help acting on this?" }), h("p", { text: "Send us the report. We will walk through the findings with you and scope the tests that matter most." })),
      h("a", { class: "btn green", href: href }, "Discuss this report ", h("span", { class: "arr", "aria-hidden": "true", text: "→" })));
  }

  /* ---------- exports ---------- */
  function withoutShots(r) { var c = JSON.parse(JSON.stringify(r)); c.screenshots = {}; return c; }
  function casesText(r) { return ((r.strategy && r.strategy.testCases) || []).map(function (c) { return c.id + ". " + c.title + " [" + c.area + ", " + c.priority + "]\n   Steps: " + c.steps.join(" > ") + "\n   Expected: " + c.expected; }).join("\n\n"); }
  function csvCell(v) { var s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; } // quote, and neutralise spreadsheet formulas
  function casesCsv(r) {
    var rows = [["ID", "Title", "Area", "Priority", "Steps", "Expected"]].concat(((r.strategy && r.strategy.testCases) || []).map(function (c) { return [c.id, c.title, c.area, c.priority, c.steps.join(" > "), c.expected]; }));
    return rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
  }
  function toMarkdown(r) {
    var s = r.scores, st = r.strategy || {}, n = st.narrative || {}, L = [];
    L.push("# Audit report: " + host(r.finalUrl || r.target), "", "Audited " + r.auditedAt.slice(0, 10) + " by Qualaces. Overall **" + s.overall + "/100 (grade " + s.grade + ")**.", "", n.executiveSummary || "", "");
    if (n.actions && n.actions.length) { L.push("## Top actions", ""); n.actions.forEach(function (a) { L.push("- " + a); }); L.push(""); }
    L.push("## Scores", "", "| Area | Score |", "| --- | --- |"); CATS.forEach(function (c) { L.push("| " + CAT_LABEL[c] + " | " + s[c] + " |"); }); L.push("");
    L.push("## Findings", ""); (r.findings || []).forEach(function (f) { L.push("### [" + f.severity.toUpperCase() + "] " + f.title, "", f.detail, ""); if (f.evidence && f.evidence.length) { f.evidence.forEach(function (e) { L.push("- `" + String(e).replace(/`/g, "'") + "`"); }); L.push(""); } L.push("**Fix:** " + f.fix, ""); });
    L.push("## Recommended services", ""); (st.services || []).forEach(function (x) { L.push("- **" + x.name + "** (" + x.priority + "): " + x.why); }); L.push("");
    L.push("## Phased plan", ""); (st.phases || []).forEach(function (p) { L.push("### " + p.title + " (effort: " + p.size + ")", "", p.goal, ""); (p.items || []).forEach(function (i) { L.push("- " + i); }); L.push(""); });
    L.push("## Test cases", ""); L.push(casesText(r), "", "## Limitations", ""); (r.limitations || []).forEach(function (l) { L.push("- " + l); });
    return L.join("\n");
  }
  function copyText(text, btn, done) {
    var old = btn.textContent;
    var ok = function () { btn.textContent = done; setTimeout(function () { btn.textContent = old; }, 1800); };
    var fallback = function () { var t = h("textarea", { style: "position:fixed;left:-9999px", "aria-hidden": "true" }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); ok(); } catch (e) { btn.textContent = "Copy failed"; } t.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  }
  function download(name, text, type) {
    var a = h("a", { href: URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" })), download: name.replace(/[^a-z0-9._-]/gi, "_") });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function printReport() {
    var opened = [];
    report.querySelectorAll("details:not([open])").forEach(function (d) { d.open = true; opened.push(d); });
    var undo = function () { opened.forEach(function (d) { d.open = false; }); window.removeEventListener("afterprint", undo); };
    window.addEventListener("afterprint", undo);
    window.print();
  }
})();
