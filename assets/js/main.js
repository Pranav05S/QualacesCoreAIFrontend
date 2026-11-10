/* Qualaces site behaviour. Vanilla JS, no dependencies. Every enhancement degrades to plain HTML. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     Contact form delivery. Mirrors the previous site (EmailJS client-side
     keys are public by design). Swap `endpoint` for your own backend/Formspree
     etc. if preferred: it receives JSON {name, email, message, topics}.
  ------------------------------------------------------------------ */
  var CONFIG = {
    emailjs: { service: "service_cb9iuq3", template: "template_mnxa2vr", key: "oVwPtJHP_o6KtLxnE" },
    endpoint: "", // optional: your own POST endpoint (takes priority over EmailJS when set)
    mailto: "info@qualaces.com"
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, reduce ? 0 : ms); }); };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  /* ---------------- header, progress, back-to-top ---------------- */
  var header = $(".site-header"), bar = $(".progress"), topBtn = $(".back-top");
  function onScroll() {
    var y = window.scrollY, h = document.documentElement.scrollHeight - innerHeight;
    if (header) header.classList.toggle("scrolled", y > 8);
    if (bar) bar.style.transform = "scaleX(" + (h > 0 ? Math.min(1, y / h) : 0) + ")";
    if (topBtn) topBtn.classList.toggle("show", y > 900);
  }
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  if (topBtn) topBtn.addEventListener("click", function () { scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); });

  var menuBtn = $(".menu-btn"), links = $(".nav-links");
  function setMenu(open) {
    if (!menuBtn) return;
    menuBtn.setAttribute("aria-expanded", open);
    links.classList.toggle("open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }
  if (menuBtn) {
    menuBtn.addEventListener("click", function () { setMenu(menuBtn.getAttribute("aria-expanded") !== "true"); });
    $$("a", links).forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
    addEventListener("resize", function () { if (innerWidth > 960) setMenu(false); });
  }

  /* ---------------- scroll reveal ---------------- */
  var rv = $$(".rv");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: .12, rootMargin: "0px 0px -6% 0px" });
    rv.forEach(function (n) { io.observe(n); });
  } else rv.forEach(function (n) { n.classList.add("in"); });

  /* ---------------- generic tabs ---------------- */
  $$("[data-tabs]").forEach(function (root) {
    var tabs = $$('[role="tab"]', root), panels = $$('[role="tabpanel"]', root);
    function select(i, focus) {
      tabs.forEach(function (t, j) { t.setAttribute("aria-selected", i === j); t.tabIndex = i === j ? 0 : -1; });
      panels.forEach(function (p, j) { p.hidden = i !== j; });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(i); });
      t.addEventListener("keydown", function (e) {
        var k = e.key, n = tabs.length, nx = null;
        if (k === "ArrowRight" || k === "ArrowDown") nx = (i + 1) % n;
        else if (k === "ArrowLeft" || k === "ArrowUp") nx = (i - 1 + n) % n;
        else if (k === "Home") nx = 0; else if (k === "End") nx = n - 1;
        if (nx != null) { e.preventDefault(); select(nx, true); }
      });
    });
    select(0);
  });

  /* ---------------- switches (QTM mock) ---------------- */
  $$(".switch").forEach(function (s) {
    s.addEventListener("click", function () {
      var on = s.getAttribute("aria-checked") !== "true";
      s.setAttribute("aria-checked", on);
      var tgt = s.getAttribute("data-target"), t = tgt && document.getElementById(tgt);
      if (t) t.textContent = on ? t.getAttribute("data-on") : t.getAttribute("data-off");
    });
  });

  /* ---------------- hero test runner ---------------- */
  var runner = $("#runner");
  if (runner) {
    var SCOPES = {
      smoke: { cmd: "qa run --suite smoke", checks: [
        ["App boots and renders", 0], ["User can sign in", 0], ["Checkout page loads", 0],
        ["Payment API responds", 1, "POST /pay returned 502 under normal load"], ["Search returns results", 0]] },
      sanity: { cmd: "qa run --suite sanity --after #4821", checks: [
        ["Fix verified: password reset email", 0], ["Adjacent: sign-in still works", 0],
        ["Adjacent: profile save", 1, "Save returns 500 since the change"], ["Adjacent: logout", 0]] },
      regression: { cmd: "qa run --suite regression", checks: [
        ["Account creation", 0], ["Sign-in / sign-out", 0], ["Cart totals and tax", 1, "Tax rounds down on 3+ items"],
        ["Order history", 0], ["Email notifications", 0], ["Admin permissions", 0]] },
      ticket: { cmd: "qa verify --tracker tickets", checks: [
        ["QA-214 · Address form validation", 0], ["QA-215 · Dark-mode contrast", 0],
        ["QA-219 · CSV export", 1, "Export drops rows after 1,000"], ["QA-223 · Session timeout", 0]] }
    };
    var checksEl = $(".checks", runner), cmdEl = $("#r-cmd", runner), sumEl = $(".sum", runner),
        rerun = $(".rerun", runner), scopeBtns = $$(".scope", runner);
    var token = 0, scope = "smoke", runs = {};

    var run = async function () {
      var my = ++token, def = SCOPES[scope], fixed = runs[scope] > 0;
      runs[scope] = (runs[scope] || 0) + 1;
      checksEl.innerHTML = ""; rerun.disabled = true;
      sumEl.innerHTML = '<span class="muted" style="color:#8f88bf">running…</span>';
      cmdEl.textContent = def.cmd;
      var items = def.checks.map(function (c) {
        var li = el("li", "", '<span class="ic" aria-hidden="true"></span><span class="nm">' + esc(c[0]) + '</span><span class="ms"></span>' + (c[1] ? '<span class="note">' + esc(c[2]) + "</span>" : ""));
        checksEl.appendChild(li); return li;
      });
      var pass = 0, fail = 0;
      for (var i = 0; i < items.length; i++) {
        if (my !== token) return;
        var li = items[i], c = def.checks[i];
        li.classList.add("show", "run"); await sleep(260 + Math.random() * 380);
        if (my !== token) return;
        var bad = c[1] && !fixed;
        li.classList.remove("run");
        li.classList.add(bad ? "fail" : "pass");
        $(".ic", li).textContent = bad ? "✕" : "✓";
        $(".ms", li).textContent = Math.round(90 + Math.random() * 420) + "ms";
        bad ? fail++ : pass++;
      }
      if (my !== token) return;
      sumEl.innerHTML = fail
        ? "<b>" + pass + " passed</b> · <em>" + fail + " defect caught before release</em>"
        : "<b>All " + pass + " checks green.</b> Safe to ship.";
      rerun.textContent = fail ? "↻ Fix & re-run" : "↻ Run again";
      rerun.disabled = false;
      if (!fail) runs[scope] = 0;
    };
    scopeBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        scopeBtns.forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
        scope = b.getAttribute("data-scope"); runs[scope] = 0; run();
      });
    });
    rerun.addEventListener("click", run);
    run();
  }

  /* ---------------- "find your test" guide ---------------- */
  var guide = $("#guide");
  if (guide && window.QA_SERVICES) {
    var byId = {}; QA_SERVICES.forEach(function (s) { byId[s.id] = s; });
    var PRIMARY = {
      release: ["regression", "smoke", "A release is the moment regressions hurt most. A full regression pass finds what the new code quietly broke; a short smoke run confirms the critical paths before and after you ship."],
      small: ["sanity", "regression", "After a small change you want a quick, focused check that the fix works and nothing next to it fell over. That is sanity testing, with regression held in reserve."],
      big: ["regression", "automation", "When lots of code has changed, repeating the same checks by hand does not scale. Start with regression coverage and automate the checks you will run again."],
      tickets: ["ticket", "management", "Verifying work item by item keeps your tracker honest. Ticket testing closes the loop, and clear test management keeps the results visible."],
      none: ["consulting", "management", "With no plan yet, the highest-value move is a short strategy engagement: what to test, in what order, and how to report it, before any tests are written."]
    };
    var PLATFORM = { web: "compatibility", mobile: "mobile", device: "hardware", emerging: "ai" };
    var CONCERN = { speed: "performance", security: "security", confusion: "usability", devices: "compatibility", all: "management" };
    var out = $("#guide-out"), cta = $("#guide-cta", guide);
    var read = function (n) { var c = guide.querySelector('input[name="' + n + '"]:checked'); return c && c.value; };
    var update = function () {
      var a = read("platform"), b = read("moment"), c = read("worry");
      if (!b) { out.classList.add("empty"); $("h3", out).textContent = "Answer a couple of questions."; $(".txt", out).textContent = "Your recommended starting point appears here, with the services that go with it."; $(".pills", out).innerHTML = ""; cta.hidden = true; return; }
      var p = PRIMARY[b], ids = [p[0], p[1]];
      if (a && PLATFORM[a]) ids.push(PLATFORM[a]); if (a === "device") ids.push("iot");
      if (c && CONCERN[c]) ids.push(CONCERN[c]);
      ids = ids.filter(function (x, i) { return byId[x] && ids.indexOf(x) === i; }).slice(0, 5);
      out.classList.remove("empty");
      $("h3", out).textContent = "Start with " + byId[p[0]].name.toLowerCase() + ".";
      $(".txt", out).textContent = p[2];
      $(".pills", out).innerHTML = ids.map(function (i) { return "<li>" + esc(byId[i].name) + "</li>"; }).join("");
      var names = ids.map(function (i) { return byId[i].name; });
      cta.hidden = false;
      cta.href = "contact-us.html?topics=" + encodeURIComponent(names.join(",")) + "&note=" + encodeURIComponent("From the test finder: I'd like to talk about " + names.join(", ") + ".") + "#form";
    };
    guide.addEventListener("change", update); update();
  }

  /* ---------------- services explorer ---------------- */
  var exp = $("#explorer");
  if (exp) {
    var btns = $$(".svc-btn", exp), panels2 = $$(".svc-panel", exp), chips = $$(".chip", exp);
    var show = function (id, push) {
      var ok = false;
      btns.forEach(function (b) { var on = b.dataset.id === id; if (on) { b.setAttribute("aria-current", "true"); ok = true; } else b.removeAttribute("aria-current"); });
      panels2.forEach(function (p) { p.hidden = p.dataset.id !== id; });
      if (!ok) return show(btns[0].dataset.id, push);
      if (push) history.replaceState(null, "", "#" + id);
      if (innerWidth <= 900 && push) { var d = $("#svc-detail", exp); d && d.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
    };
    btns.forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.id, true); }); });
    chips.forEach(function (ch) {
      ch.addEventListener("click", function () {
        var cat = ch.dataset.cat;
        chips.forEach(function (x) { x.setAttribute("aria-pressed", x === ch); });
        $$(".grp, .svc-btn", exp).forEach(function (n) { n.classList.toggle("hide", cat !== "all" && n.dataset.cat !== cat); });
        $$(".svc-list li", exp).forEach(function (li) { li.style.display = li.classList.contains("hide") || (li.firstElementChild && li.firstElementChild.classList.contains("hide")) ? "none" : ""; });
        var first = btns.filter(function (b) { return !b.classList.contains("hide"); })[0];
        if (first) show(first.dataset.id);
      });
    });
    show((location.hash || "").slice(1) || btns[0].dataset.id);
    addEventListener("hashchange", function () { show(location.hash.slice(1)); });
  }

  /* ---------------- accordion ---------------- */
  var accBtns = $$(".pillar button");
  var panelOf = function (b) { return document.getElementById(b.getAttribute("aria-controls")); };
  var setAcc = function (b, open) {
    b.setAttribute("aria-expanded", open);
    var p = panelOf(b); open ? p.removeAttribute("data-closed") : p.setAttribute("data-closed", "");
  };
  accBtns.forEach(function (b, i) {
    setAcc(b, i === 0);
    b.addEventListener("click", function () {
      var open = b.getAttribute("aria-expanded") === "true";
      accBtns.forEach(function (x) { setAcc(x, false); });
      if (!open) setAcc(b, true);
    });
  });

  /* ---------------- contact form ---------------- */
  var form = $("#contact-form");
  if (form) {
    var q = new URLSearchParams(location.search);
    var want = (q.get("topics") || q.get("topic") || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    var ALIAS = { "test planning": ["strategic consulting", "test management"] };
    $$('input[name="topic"]', form).forEach(function (i) {
      var v = i.value.toLowerCase(), keys = [v].concat(ALIAS[v] || []);
      if (want.some(function (w) { return keys.some(function (k) { return w.indexOf(k) > -1; }); })) i.checked = true;
    });
    var msg = form.elements.message;
    if (q.get("note") && !msg.value) msg.value = q.get("note");
    var cnt = $(".count", form);
    var upd = function () { cnt.textContent = msg.value.length + " / 2000"; };
    msg.addEventListener("input", upd); upd();

    var rules = {
      name: function (v) { return v.trim().length < 2 ? "Please tell us your name." : ""; },
      email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "That email doesn't look right."; },
      message: function (v) { return v.trim().length < 10 ? "A sentence or two helps us reply usefully." : ""; }
    };
    var check = function (n) {
      var f = form.elements[n], wrap = f.closest(".field"), m = rules[n](f.value);
      wrap.classList.toggle("err", !!m); $(".msg", wrap).textContent = m; f.setAttribute("aria-invalid", !!m); return !m;
    };
    Object.keys(rules).forEach(function (n) {
      form.elements[n].addEventListener("blur", function () { if (form.elements[n].value) check(n); });
      form.elements[n].addEventListener("input", function () { if (form.elements[n].closest(".field").classList.contains("err")) check(n); });
    });

    var send = function (d) {
      if (CONFIG.endpoint) return fetch(CONFIG.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then(function (r) { if (!r.ok) throw new Error(r.status); });
      var e = CONFIG.emailjs;
      return fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: e.service, template_id: e.template, user_id: e.key,
          template_params: { from_name: d.name, from_email: d.email, message: (d.topics.length ? "[Topics: " + d.topics.join(", ") + "]\n\n" : "") + d.message } })
      }).then(function (r) { if (!r.ok) throw new Error(r.status); });
    };

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (form.elements.company.value) return; // honeypot
      var ok = Object.keys(rules).map(check).every(Boolean);
      if (!ok) { var bad = $(".field.err input, .field.err textarea", form); bad && bad.focus(); return; }
      var d = { name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), message: msg.value.trim(),
        topics: $$('input[name="topic"]:checked', form).map(function (i) { return i.value; }) };
      var btn = $(".btn", form), label = btn.firstChild.textContent;
      btn.disabled = true; btn.firstChild.textContent = "Sending…";
      send(d).then(function () {
        form.hidden = true; var s = $("#success"); s.hidden = false; $(".who-name", s).textContent = d.name.split(" ")[0]; s.focus();
      }).catch(function () {
        btn.disabled = false; btn.firstChild.textContent = label;
        var f = $("#fallback"); f.hidden = false;
        var body = (d.topics.length ? "Topics: " + d.topics.join(", ") + "\n\n" : "") + d.message;
        $("a", f).href = "mailto:" + CONFIG.mailto + "?subject=" + encodeURIComponent("Enquiry from qualaces.com") + "&body=" + encodeURIComponent(body + "\n\n" + d.name + " <" + d.email + ">");
      });
    });
  }

  /* ---------------- command palette (Ctrl/⌘ + K, or "/") ---------------- */
  var pal = $("#pal");
  if (pal) {
    var input = $("input", pal), list = $("ul", pal), sel = 0, shown = [];
    var base = document.documentElement.getAttribute("data-root") || "";
    var items = [
      ["Home", "index.html", "Page"], ["Services", "services.html", "Page"], ["Free site audit", "audit.html", "Tool"], ["Products · QTM", "products.html", "Page"],
      ["Careers & mentorship", "careers.html", "Page"], ["About us", "about-us.html", "Page"], ["Contact us", "contact-us.html", "Page"],
      ["Privacy policy", "privacy-policy.html", "Page"], ["Email info@qualaces.com", "mailto:info@qualaces.com", "Action"]
    ].concat((window.QA_SERVICES || []).map(function (s) { return [s.name, "services.html#" + s.id, "Service"]; }));
    var render = function () {
      var t = input.value.trim().toLowerCase();
      shown = items.filter(function (i) { return !t || (i[0] + " " + i[2]).toLowerCase().indexOf(t) > -1; }).slice(0, 12);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map(function (i, n) {
        return '<li><a href="' + base + i[1] + '" role="option" aria-selected="' + (n === sel) + '">' + esc(i[0]) + "<small>" + i[2] + "</small></a></li>";
      }).join("") : '<li class="empty">Nothing matches “' + esc(t) + "”</li>";
    };
    var openPal = function () { pal.classList.add("open"); input.value = ""; sel = 0; render(); input.focus(); document.body.style.overflow = "hidden"; };
    var closePal = function () { pal.classList.remove("open"); document.body.style.overflow = ""; };
    $$("[data-open-pal]").forEach(function (b) { b.addEventListener("click", openPal); });
    pal.addEventListener("mousedown", function (e) { if (e.target === pal) closePal(); });
    input.addEventListener("input", function () { sel = 0; render(); });
    addEventListener("keydown", function (e) {
      var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pal.classList.contains("open") ? closePal() : openPal(); }
      else if (e.key === "/" && !typing && !pal.classList.contains("open")) { e.preventDefault(); openPal(); }
      else if (pal.classList.contains("open")) {
        if (e.key === "Escape") closePal();
        else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
        else if (e.key === "Enter") { var a = $('a[aria-selected="true"]', list); if (a) a.click(); }
      }
    });
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    $$(".mod").forEach(function (k) { k.textContent = isMac ? "⌘" : "Ctrl"; });
  }
})();
