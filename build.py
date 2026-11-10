#!/usr/bin/env python3
"""Static site generator for qualaces.com.

Run `python3 build.py` from this folder. It writes the HTML pages next to this file
and assets/js/data.js. Edit copy here; there are no other build steps or dependencies.
"""
import html, json, pathlib

ROOT = pathlib.Path(__file__).parent
SITE = "https://qualaces.com"
E = html.escape

# --------------------------------------------------------------------------- data
CATS = [
    ("core", "Core test types"),
    ("attr", "Quality attributes"),
    ("plat", "Platforms & devices"),
    ("auto", "Automation & AI"),
    ("adv", "Advisory & reporting"),
]

SERVICES = [
    dict(id="smoke", cat="core", name="Smoke Testing",
         short="Confirms the most critical functionality works.",
         long="Smoke testing is done to ensure that the most critical functionalities of a system are working fine. It is the quick check that tells you whether a build is stable enough to be worth testing any further.",
         use="Every new build or deployment.", pair=["sanity", "regression"]),
    dict(id="sanity", cat="core", name="Sanity Testing",
         short="A focused check after a small change.",
         long="Sanity testing is a type of software testing done after a minor change in the code or functionality to ascertain that the bugs have been fixed. It stays narrow on purpose: verify the fix, check its neighbours, move on.",
         use="Right after a bug fix or a minor change.", pair=["smoke", "ticket"]),
    dict(id="regression", cat="core", name="Regression Testing",
         short="Exhaustive re-testing when software changes.",
         long="Regression testing is exhaustive testing that is conducted when changes or enhancements are made to the software. It exists to catch the thing a new feature quietly broke somewhere else.",
         use="Before a release, or after larger changes.", pair=["automation", "smoke"]),
    dict(id="ticket", cat="core", name="Ticket Testing",
         short="Verifies individual items from your issue tracker.",
         long="Ticket testing involves testing individual items, or 'tickets', that are part of an issue tracking system. Each ticket is verified against what it said it would deliver, so the tracker reflects reality.",
         use="Sprint close, or when a backlog of fixes needs sign-off.", pair=["management", "sanity"]),

    dict(id="performance", cat="attr", name="Performance Testing",
         short="Assess scalability and responsiveness.",
         long="We assess the scalability and responsiveness of your software, so you find out how it behaves under load before your users do.",
         use="Before launches, campaigns and growth spikes.", pair=["automation", "management"]),
    dict(id="security", cat="attr", name="Security Testing",
         short="Identify vulnerabilities before someone else does.",
         long="We identify vulnerabilities in your software to ensure its security, working through the places where weaknesses tend to hide and reporting what we find clearly.",
         use="New releases, new integrations, and anything handling user data.", pair=["regression", "management"]),
    dict(id="usability", cat="attr", name="Usability Testing",
         short="Enhance the experience of using your software.",
         long="We evaluate how real people experience your software and where they get stuck, so the product is easier and more pleasant to use.",
         use="Redesigns, new flows, and onboarding.", pair=["compatibility", "mobile"]),
    dict(id="compatibility", cat="attr", name="Compatibility Testing",
         short="Works across platforms, browsers and devices.",
         long="We check that your software behaves consistently across the various platforms and devices your users actually have, not just the ones on your desk.",
         use="Launches and any UI-heavy release.", pair=["mobile", "usability"]),

    dict(id="mobile", cat="plat", name="Mobile App Testing", img="mobile",
         short="Apps and digital experiences on real devices.",
         long="Mobile testing is a procedure for evaluating the relevance, functionality, usability, and consistency of mobile apps and digital experiences, such as websites and e-commerce. Whether you're creating a responsive website, redesigning an existing one, or creating the next great app, mobile testing helps make sure it produces the best results.",
         use="New apps, redesigns and responsive sites.", pair=["compatibility", "usability"]),
    dict(id="hardware", cat="plat", name="Hardware Testing", img="hardware",
         short="Full integration and end-to-end system standards.",
         long="Hardware testing verifies the product's full integration. It is one of the last stages of the product development process. The goals are to evaluate end-to-end system standards and to provide knowledge about a product's quality.",
         use="Late-stage development, before release.", pair=["iot", "management"]),
    dict(id="iot", cat="plat", name="IoT Testing", img="iot",
         short="Performance, security and function of connected devices.",
         long="IoT testing comprises QA tests that examine the performance, security, and functionality of IoT devices. Every IoT device transmits and receives data over the Internet, so it is essential to confirm they can transfer critical information wirelessly before releasing them.",
         use="Before releasing connected devices.", pair=["security", "hardware"]),
    dict(id="chatbot", cat="plat", name="Chatbot Testing", img="chatbot",
         short="Make sure conversational AI engages users well.",
         long="A chatbot is an artificial intelligence (AI) program that can start and continue a conversation with a user via messaging in natural language. We test AI-powered chatbots to make sure they can engage users effectively, giving people the options they need and a way to reach a human when it matters.",
         use="New bots and conversation-flow changes.", pair=["ai", "usability"]),
    dict(id="arvr", cat="plat", name="AR / VR Testing", img="arvr",
         short="Augmented-reality-based testing (ARBT).",
         long="By fusing the virtual and actual worlds, augmented reality (AR) and virtual reality (VR) applications offer a new level of immersion. Augmented reality-based testing (ARBT) combines augmented reality with software testing to enhance testing by introducing a new dimension to the testers' field of vision.",
         use="Immersive apps and experiences.", pair=["usability", "performance"]),

    dict(id="automation", cat="auto", name="Automation Testing", img="automation",
         short="Automated checks with minimal developer involvement.",
         long="Automation testing is a method where the computer runs many tests on different software components with little to no developer participation. Any software you use daily, from what runs your phone to your TV or even your car, had to pass a predetermined process before it reached users. Automation makes that process repeatable.",
         use="Checks you will run again and again.", pair=["regression", "performance"]),
    dict(id="ai", cat="auto", name="Artificial Intelligence Testing", img="ai",
         short="AI and machine learning to improve test outcomes.",
         long="Artificial intelligence testing is the use of automated software testing methods that make use of artificial intelligence (AI), typically machine learning, to get better outcomes. The idea is that these technologies can get past many of the usual obstacles in automated software testing.",
         use="Teams ready to go beyond scripted automation.", pair=["automation", "chatbot"]),

    dict(id="consulting", cat="adv", name="Strategic Consulting",
         short="Test planning and optimisation.",
         long="Strategic consulting for test planning and optimization: what to test, in what order, with which people and tools, and how to spend your testing effort where it pays back most.",
         use="No test plan yet, or one that has outgrown the team.", pair=["management", "automation"]),
    dict(id="management", cat="adv", name="Test Management & Reporting",
         short="Detailed management and clear reporting.",
         long="Detailed test management and reporting, so everyone can see what was tested, what passed, what didn't, and what that means for the release.",
         use="Any engagement where stakeholders need visibility.", pair=["ticket", "consulting"]),
]
BYID = {s["id"]: s for s in SERVICES}
CATNAME = dict(CATS)

SOCIAL = [
    ("LinkedIn", "https://www.linkedin.com/company/qualaces/"),
    ("X / Twitter", "https://www.twitter.com/qualaces"),
    ("Facebook", "https://www.facebook.com/qualaces"),
    ("Instagram", "https://www.instagram.com/qualaces"),
    ("YouTube", "https://www.youtube.com/@qualaces"),
]

NAV = [("Home", "index.html"), ("Services", "services.html"), ("Free audit", "audit.html"), ("Products", "products.html"),
       ("Careers", "careers.html"), ("About us", "about-us.html")]

ARROW = '<span class="arr" aria-hidden="true">→</span>'

# --------------------------------------------------------------------------- shell
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&amp;family=Instrument+Sans:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">')

GA = ('<script async src="https://www.googletagmanager.com/gtag/js?id=G-PCM313WJ4W"></script>'
      '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-PCM313WJ4W")</script>')


def header(active):
    li = "".join(
        f'<li><a href="{h}"{" aria-current=\"page\"" if h == active else ""}>{n}</a></li>' for n, h in NAV)
    cur = ' aria-current="page"' if active == "contact-us.html" else ""
    return f'''<a class="skip" href="#main">Skip to content</a><div class="progress" aria-hidden="true"></div>
<header class="site-header"><div class="wrap nav">
<a class="brand" href="index.html" aria-label="Qualaces home"><img src="assets/img/logo.png" alt="Qualaces" width="159" height="34"></a>
<ul class="nav-links" id="nav-links">{li}<li class="m-only"><a href="contact-us.html"{cur}>Contact us</a></li></ul>
<button class="kbd-btn" type="button" data-open-pal aria-label="Open quick navigation"><span>Quick find</span><kbd><span class="mod">Ctrl</span> K</kbd></button>
<a class="btn sm" href="contact-us.html">Contact us {ARROW}</a>
<button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Menu"><span></span></button>
</div></header>'''


def footer(flush=False):
    soc = "".join(f'<li><a href="{u}" target="_blank" rel="noopener">{n}</a></li>' for n, u in SOCIAL)
    return f'''<footer class="site-footer{" flush" if flush else ""}"><div class="wrap">
<div class="foot-grid">
<div><a class="foot-brand" href="index.html"><img src="assets/img/mark.png" alt="" width="38" height="38"><span>qualaces<span class="dot">.</span></span></a>
<p>Qualaces is a software and quality testing services company that provides a wide range of services to ensure the success of your software.</p></div>
<div><h2>Explore</h2><ul><li><a href="services.html">Services</a></li><li><a href="audit.html">Free site audit</a></li><li><a href="products.html">Products · QTM</a></li><li><a href="careers.html">Careers</a></li><li><a href="about-us.html">About us</a></li><li><a href="privacy-policy.html">Privacy policy</a></li></ul></div>
<div><h2>Contact</h2><ul><li><a href="mailto:info@qualaces.com">info@qualaces.com</a></li><li><a href="tel:+15873196658">+1 (587) 319-6658</a></li><li>Calgary, Alberta<br>Canada</li><li><a href="contact-us.html">Send a message</a></li></ul></div>
<div><h2>Follow</h2><ul>{soc}</ul></div>
</div>
<div class="foot-bottom"><span>© 2021–2026 Qualaces. All rights reserved.</span><span>Quality, on purpose.</span></div>
<div class="wordmark-bg" aria-hidden="true"></div>
</div></footer>
<button class="back-top" type="button" aria-label="Back to top">↑</button>
<div class="pal" id="pal" role="dialog" aria-modal="true" aria-label="Quick navigation"><div class="pal-box">
<input type="text" placeholder="Jump to a page or service…" aria-label="Search pages and services" autocomplete="off">
<ul role="listbox"></ul><div class="pal-foot"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div></div></div>
<script src="assets/js/data.js"></script><script src="assets/js/main.js"></script>'''


def cta(title="Have a project in mind?", text="Start the collaboration with us while figuring out the best solution based on your needs.", href="contact-us.html"):
    return f'''<section class="wrap" style="margin-top:clamp(64px,9vw,120px)"><div class="cta rv"><div><h2>{title}</h2><p>{text}</p></div>
<a class="btn green" href="{href}">Contact us {ARROW}</a></div></section>'''


def page(fname, title, desc, active, body, *, head_extra="", foot_extra="", flush=False, body_class=""):
    canon = SITE + ("/" if fname == "index.html" else "/" + fname)
    doc = f'''<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<meta name="theme-color" content="#f6f3ec">
<link rel="canonical" href="{canon}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Qualaces"><meta property="og:title" content="{E(title)}"><meta property="og:description" content="{E(desc)}"><meta property="og:url" content="{canon}"><meta property="og:image" content="{SITE}/assets/img/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/img/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png"><link rel="manifest" href="manifest.webmanifest">
<script>document.documentElement.className="js"</script>
{FONTS}
<link rel="stylesheet" href="assets/css/styles.css">
{head_extra}{GA}
</head>
<body class="{body_class}">
{header(active)}
<main id="main">
{body}
</main>
{footer(flush)}
{foot_extra}
</body></html>
'''
    (ROOT / fname).write_text(doc, encoding="utf-8")
    print("wrote", fname)


# --------------------------------------------------------------------------- pages
def home():
    scopes = "".join(
        f'<button class="scope" type="button" data-scope="{k}" aria-pressed="{"true" if k == "smoke" else "false"}">{v}</button>'
        for k, v in [("smoke", "Smoke"), ("sanity", "Sanity"), ("regression", "Regression"), ("ticket", "Ticket")])

    types = [
        ("smoke", "Smoke", "Run when", "A new build lands", "Looks at", "Only the most critical functions", "Result", "A fast go / no-go signal"),
        ("sanity", "Sanity", "Run when", "A small change or bug fix just shipped", "Looks at", "The fix and its immediate neighbours", "Result", "Confidence the fix worked and nothing nearby broke"),
        ("regression", "Regression", "Run when", "Changes or enhancements are made", "Looks at", "Existing behaviour, exhaustively", "Result", "Proof that new work didn't break old work"),
        ("ticket", "Ticket", "Run when", "Items in your tracker need verifying", "Looks at", "Each ticket against what it promised", "Result", "A tracker that matches reality"),
    ]
    tabs = "".join(
        f'<button class="tab" role="tab" type="button" id="t-{t[0]}" aria-controls="p-{t[0]}">{t[1]} testing</button>' for t in types)
    panels = "".join(
        f'''<div class="tabpanel" role="tabpanel" id="p-{t[0]}" aria-labelledby="t-{t[0]}" hidden><h3>{t[1]} testing</h3><p>{BYID[t[0]]["long"]}</p>
<dl class="when"><div><dt>{t[2]}</dt><dd style="margin:0">{t[3]}</dd></div><div><dt>{t[4]}</dt><dd style="margin:0">{t[5]}</dd></div><div><dt>{t[6]}</dt><dd style="margin:0">{t[7]}</dd></div></dl>
<p style="margin-top:28px"><a class="link-arrow" href="services.html#{t[0]}">Read more {ARROW}</a></p></div>'''
        for t in types)

    def opts(name, items):
        return '<div class="opts">' + "".join(
            f'<div class="opt"><input type="radio" name="{name}" id="{name}-{v}" value="{v}"><label for="{name}-{v}">{l}</label></div>'
            for v, l in items) + "</div>"

    idx = "".join(
        f'<li class="rv"><a href="services.html#{i}"><span class="n">{n:02d}</span><span class="t">{BYID[i]["name"]}</span><span class="d">{BYID[i]["short"]}</span><span class="go" aria-hidden="true">→</span></a></li>'
        for n, i in enumerate(["performance", "security", "usability", "compatibility", "mobile", "automation", "ai", "consulting", "management"], 1))

    ld = json.dumps({
        "@context": "https://schema.org", "@type": "ProfessionalService", "name": "Qualaces", "url": SITE,
        "logo": SITE + "/assets/img/logo.png", "email": "info@qualaces.com", "telephone": "+1-587-319-6658",
        "description": "Software and quality testing services: performance, security, usability, compatibility, mobile, automation and AI testing.",
        "address": {"@type": "PostalAddress", "addressLocality": "Calgary", "addressRegion": "AB", "addressCountry": "CA"},
        "sameAs": [u for _, u in SOCIAL]})

    body = f'''
<section class="hero"><div class="wrap hero-grid">
<div>
<p class="eyebrow"><b>Software &amp; quality testing</b> Calgary, Alberta</p>
<h1 class="h-xl">We find the bugs <span class="mark">before your users do.</span></h1>
<p class="lede">Qualaces designs and delivers QA and software testing solutions, from a quick smoke run to a full regression, across web, mobile, devices and AI. Our methods and attention to detail make sure your software is thoroughly examined and validated.</p>
<div class="cta-row"><a class="btn" href="contact-us.html">Start a conversation {ARROW}</a><a class="btn ghost" href="#find-your-test">What do I need?</a></div>
<div class="hero-meta"><span><i></i>Web · Mobile · IoT · AI</span><span><i></i>Calgary, Alberta</span><span><i></i>Makers of QTM</span></div>
</div>
<div class="rv">
<div class="runner" id="runner" role="region" aria-label="Example test run">
<div class="runner-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>qualaces — test run<span class="tag">example</span></div>
<div class="scopes" role="group" aria-label="Choose a test scope">{scopes}</div>
<div class="runner-cmd" aria-live="polite"><span class="p">$</span> <span id="r-cmd">qa run --suite smoke</span><span class="c" aria-hidden="true"></span></div>
<ul class="checks" aria-live="polite"></ul>
<div class="runner-foot"><span class="sum"></span><button class="rerun" type="button">↻ Run again</button></div>
</div>
<p class="runner-note">Illustrative run. Choose a scope, watch a defect get caught, then fix &amp; re-run.</p>
</div>
</div></section>

<div class="strip"><div class="wrap"><ul><li>Performance</li><li>Security</li><li>Usability</li><li>Compatibility</li><li>Mobile</li><li>Automation</li><li>AI</li><li>IoT</li><li>AR / VR</li></ul></div></div>

<section class="sec"><div class="wrap split">
<div class="sticky rv"><p class="eyebrow"><b>01</b> Why Qualaces</p>
<h2 class="h-lg" style="margin:22px 0 22px">Quality is a habit, not a phase.</h2>
<p class="lede">Elevate your software's performance and quality with testing that's thorough, personal and honest.</p>
<p style="margin-top:28px"><a class="link-arrow" href="about-us.html">About us {ARROW}</a></p></div>
<ol class="principles">
<li class="rv"><div><h3>Commitment to quality</h3><p>Our testing methodologies and attention to detail guarantee that your software is thoroughly examined and validated.</p></div></li>
<li class="rv"><div><h3>Our expertise</h3><p>Each member has a strong background in software testing methodologies, quality assurance, and industry best practices.</p></div></li>
<li class="rv"><div><h3>Personalized attention</h3><p>Our team works closely with you, providing clear communication, understanding your requirements, and delivering solutions.</p></div></li>
<li class="rv"><div><h3>Integrity and confidentiality</h3><p>We operate in accordance with the utmost moral and professional standards.</p></div></li>
</ol></div></section>

<section class="sec-tight" id="find-your-test" style="padding-top:0"><div class="wrap">
<div class="sec-head rv"><p class="eyebrow"><b>02</b> Find your test</p><h2 class="h-lg">Not sure what you need? Answer three questions.</h2></div>
<form class="guide rv" id="guide" onsubmit="return false">
<div class="guide-q">
<fieldset><legend><span>A</span>What are you shipping?</legend>{opts("platform", [("web", "A web app"), ("mobile", "A mobile app"), ("device", "Hardware / IoT"), ("emerging", "AI, chatbot or AR/VR"), ("unsure", "Not sure")])}</fieldset>
<fieldset><legend><span>B</span>What's happening right now?</legend>{opts("moment", [("release", "A release is coming"), ("small", "We just shipped a small change"), ("big", "Lots of changes have landed"), ("tickets", "Tickets are piling up"), ("none", "We have no test plan yet")])}</fieldset>
<fieldset style="margin:0"><legend><span>C</span>What worries you most?</legend>{opts("worry", [("speed", "Speed under load"), ("security", "Security"), ("confusion", "Users getting stuck"), ("devices", "Working everywhere"), ("all", "All of it")])}</fieldset>
</div>
<div class="guide-out empty" id="guide-out" aria-live="polite"><div><div class="label">Our suggestion</div><h3>Answer a couple of questions.</h3><p class="txt">Your recommended starting point appears here, with the services that go with it.</p><ul class="pills"></ul></div>
<a class="btn green" id="guide-cta" href="contact-us.html" hidden>Talk this through {ARROW}</a></div>
</form></div></section>

<section class="sec dark on-dark"><div class="wrap">
<div class="sec-head rv"><p class="eyebrow"><b>03</b> The main types of testing</p><h2 class="h-lg">Four checks, four different questions.</h2></div>
<div class="tabs-wrap rv" data-tabs><div class="tablist" role="tablist" aria-label="Types of testing" aria-orientation="vertical">{tabs}</div><div>{panels}</div></div>
</div></section>

<section class="sec"><div class="wrap">
<div class="sec-head rv"><p class="eyebrow"><b>04</b> What we do</p><h2 class="h-lg">A full range of testing, under one roof.</h2>
<p class="lede">Performance to compatibility, mobile to IoT, consulting to reporting: we cover the services that make sure your software succeeds.</p></div>
<ul class="svc-index">{idx}</ul>
<p style="margin-top:34px"><a class="btn" href="services.html">See every service {ARROW}</a></p>
</div></section>

{teaser()}
<section class="sec dark on-dark"><div class="wrap qtm-grid">
<div class="rv"><span class="badge" style="color:var(--green-bright)">Our product</span>
<h2 class="h-lg" style="margin:22px 0 20px">Meet QTM. <span class="mark">Test without writing code.</span></h2>
<p class="lede">Empower your team to create and run tests without writing a single line of code, with the help of AI, and integrate with the workflow you already have.</p>
<ul class="feat-list">
<li><span class="tick">✓</span><div><b>Zero-code automation</b><span>An intuitive interface that anyone on your team can use to build, execute and maintain tests.</span></div></li>
<li><span class="tick">✓</span><div><b>Seamless Jira integration</b><span>Sync projects, issues and test cases automatically for one unified testing workflow.</span></div></li>
<li><span class="tick">✓</span><div><b>Visual testing with AI</b><span>AI-driven visual detection that flags design flaws and UI inconsistencies.</span></div></li>
</ul>
<a class="btn green" href="products.html">Explore QTM {ARROW}</a></div>
<div class="rv" style="--d:.1s"><div class="mock" role="group" aria-label="Illustrative QTM test case list"><div class="mock-bar"><span aria-hidden="true">● ● ●</span><span>QTM · Test cases</span><span class="tag">illustrative</span></div>
<div class="mock-body">
<div class="mrow"><span class="id">TC-101</span><span>Checkout with saved card</span><span class="st ok">PASSED</span></div>
<div class="mrow"><span class="id">TC-102</span><span>Apply discount code</span><span class="st ok">PASSED</span></div>
<div class="mrow"><span class="id">TC-103</span><span>Guest address validation</span><span class="st bad">FAILED</span></div>
<div class="mrow"><span class="id">TC-104</span><span>Order confirmation email</span><span class="st wip">RUNNING</span></div>
<div class="toggle"><span>Sync failed cases to Jira</span><button class="switch" type="button" role="switch" aria-checked="true" aria-label="Sync failed cases to Jira"></button></div></div></div></div>
</div></section>
{cta()}
'''
    page("index.html", "Qualaces | Software & QA Testing Services in Calgary",
         "Qualaces is a software testing company in Calgary. Performance, security, usability, compatibility, mobile, automation and AI testing, plus the QTM test management tool.",
         "index.html", body, head_extra=f'<script type="application/ld+json">{ld}</script>')



def sample_report():
    f = ROOT / "assets/data/sample-report.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def teaser():
    r = sample_report()
    if not r:
        return ""
    bars = ""
    for c, label in [("performance", "Performance"), ("accessibility", "Accessibility"), ("seo", "SEO"), ("security", "Security"), ("reliability", "Reliability"), ("mobile", "Mobile")]:
        v = r["scores"][c]
        tone = "good" if v >= 90 else "ok" if v >= 70 else "bad"
        bars += f'<div class="cat"><span class="n">{label}</span><div class="bar" role="img" aria-label="{label} {v} out of 100"><i class="fill {tone}" style="width:{v}%"></i></div><span class="v">{v}</span></div>'
    return f"""
<section class="sec" id="free-audit" style="padding-top:0"><div class="wrap teaser">
<div class="rv"><p class="eyebrow"><b>Free tool</b> Site audit</p>
<h2 class="h-lg" style="margin:22px 0 20px">See your site the way <span class="mark">a tester does.</span></h2>
<p class="lede">Enter a web address. We load it in a real browser, measure speed, accessibility, security headers, mobile layout and links, then turn the findings into a test plan mapped to our services.</p>
<div class="cta-row" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:30px"><a class="btn" href="audit.html">Audit your site {ARROW}</a><a class="btn ghost" href="audit.html#sample">See a sample report</a></div></div>
<div class="rv" style="--d:.1s"><div class="mini-report" role="group" aria-label="Sample audit scores"><div class="top"><span>Sample · previous qualaces.com</span><span>{r["auditedAt"][:10]}</span></div>
<div class="score"><b>{r["scores"]["overall"]}</b><span>/ 100 · grade {r["scores"]["grade"]}</span></div><div class="cats">{bars}</div></div></div>
</div></section>"""


def audit():
    checks = [
        ("Performance", "Time to first byte, first and largest paint, layout shift, blocking time, page weight, request count, compression and caching."),
        ("Accessibility", "An axe-core scan against WCAG 2.1 A and AA plus best practices: contrast, labels, alt text, headings, landmarks and ARIA."),
        ("SEO", "Title, description, headings, canonical link, social sharing tags, robots.txt, sitemap, and whether content only appears after JavaScript runs."),
        ("Security", "HTTPS and redirect, HSTS, Content-Security-Policy, framing and sniffing protection, referrer policy, cookie flags, mixed content and certificate coverage."),
        ("Reliability", "Console errors, uncaught exceptions, failed requests, error responses and a sample of broken links."),
        ("Mobile", "Viewport setting, sideways scrolling at phone width, tap target size and tiny text."),
    ]
    grid = "".join(f'<div class="rv"><span class="k">0{i}</span><h3>{t}</h3><p>{d}</p></div>' for i, (t, d) in enumerate(checks, 1))
    body = f"""
<section class="page-head"><div class="wrap"><p class="eyebrow"><b>Free audit</b> Passive, about a minute</p>
<h1 class="h-xl" style="font-size:clamp(2.6rem,6.4vw,5.4rem)">See your site the way <span class="mark">a tester does.</span></h1>
<p class="lede">Enter a web address. We load it in a real browser, measure speed, accessibility, security headers, mobile layout and links, then turn what we find into a test plan mapped to our services.</p></div></section>

<section class="audit-intake sec-tight" style="padding-top:0"><div class="wrap">
<p class="offline" id="audit-offline" hidden>Live scanning is not connected on this deployment yet. You can still explore a real sample report.</p>
<form class="audit-form" id="audit-form" novalidate>
<div class="audit-row"><div class="url"><label class="lbl" for="audit-url">Website address</label><input type="text" id="audit-url" name="url" inputmode="url" autocomplete="url" placeholder="yourcompany.com" spellcheck="false" autocapitalize="none"></div>
<button class="btn go" id="audit-run" type="submit">Run audit <span class="arr" aria-hidden="true">→</span></button></div>
<label class="consent"><input type="checkbox" id="audit-consent"><span>I own this site or have permission to test it.</span></label>
<p class="audit-err" id="audit-err" role="alert"></p>
<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center"><button class="btn ghost sm" id="audit-sample" type="button">See a sample report</button>
<p class="audit-note">Passive checks only: we load the page like a visitor and read public headers. We never log in, submit forms or try to break in.</p></div>
</form></div></section>

<section class="wrap" style="padding-bottom:24px"><div class="progress-card" id="audit-progress" hidden aria-live="polite"></div></section>
<section class="wrap" id="report-wrap"><div class="report" id="audit-report" hidden></div></section>

<section class="sec"><div class="wrap"><div class="sec-head rv"><p class="eyebrow"><b>What we check</b> Six areas</p><h2 class="h-lg">Measured, not guessed.</h2>
<p class="lede">Every finding comes from something the browser or the server actually reported. Each one says how serious it is, how to fix it, and where we can help.</p></div>
<div class="checks-grid">{grid}</div></div></section>

<section class="sec-tight" style="padding-top:0"><div class="wrap split">
<div class="sticky"><p class="eyebrow"><b>From findings to a plan</b></p><h2 class="h-lg" style="margin-top:22px">The report ends with what to do next.</h2></div>
<div><p class="lede" style="max-width:none;color:var(--ink)">The findings are ranked by severity and mapped to the testing services that address them, so you can see where to start and why.</p>
<p>You get a phased plan (protect the basics, fix and verify, go deeper, keep it fixed) and a starter set of test cases built from your own results. The same findings always produce the same plan. Where an AI summary is enabled, it only rewrites the wording of the headline summary. It cannot change scores, services or test cases.</p>
<p><strong>What it cannot do:</strong> it measures one page in one browser from one place, and it is not a penetration test. It tells you where to look. People still need to do the looking.</p>
<p>Reports are held in memory for one hour and then discarded. Read how we handle data in the <a href="privacy-policy.html">privacy policy</a>.</p></div>
</div></section>
{cta("Prefer to talk it through?", "Tell us about your site and we will plan the testing with you.")}
"""
    page("audit.html", "Free Website Audit | Qualaces",
         "Run a free, passive audit of any public website: performance, accessibility, SEO, security headers, mobile layout and links, with a test strategy mapped to Qualaces services.",
         "audit.html", body,
         head_extra='<link rel="stylesheet" href="assets/css/audit.css">',
         foot_extra='<script src="assets/js/config.js"></script><script src="assets/js/audit.js"></script>')


def services():
    chips = '<button class="chip" type="button" data-cat="all" aria-pressed="true">All</button>' + "".join(
        f'<button class="chip" type="button" data-cat="{k}" aria-pressed="false">{v}</button>' for k, v in CATS)
    lst = ""
    for k, v in CATS:
        lst += f'<li class="grp" data-cat="{k}">{v}</li>'
        for s in [x for x in SERVICES if x["cat"] == k]:
            lst += f'<li><button class="svc-btn" type="button" data-id="{s["id"]}" data-cat="{k}">{s["name"]}</button></li>'
    # the .grp header should be an li too, with class on li itself
    panels = ""
    for s in SERVICES:
        pairs = "".join(f'<a class="link-arrow" style="margin-right:20px" href="#{p}">{BYID[p]["name"]}</a>' for p in s["pair"])
        img = (f'<div class="img"><img src="assets/img/{s["img"]}.webp" alt="" loading="lazy" width="1000" height="560"></div>' if s.get("img") else "")
        panels += f'''<article class="svc-panel" data-id="{s["id"]}" id="svc-{s["id"]}" hidden>
<p class="eyebrow cat">{CATNAME[s["cat"]]}</p><h2>{s["name"]}</h2><p class="big">{s["short"]}</p><p class="muted" style="max-width:38em">{s["long"]}</p>{img}
<dl class="facts"><div><dt>Typical use</dt><dd>{s["use"]}</dd></div><div><dt>Pairs well with</dt><dd>{pairs}</dd></div></dl>
<div class="svc-actions"><a class="btn" href="contact-us.html?topics={s["name"].replace(" ", "%20").replace("&", "%26")}&amp;note=I%27d%20like%20to%20talk%20about%20{s["name"].replace(" ", "%20").replace("&", "%26")}.#form">Talk to us about this {ARROW}</a></div></article>'''

    body = f'''
<section class="page-head"><div class="wrap"><p class="eyebrow"><b>Services</b> Explore</p>
<h1 class="h-xl" style="font-size:clamp(2.6rem,6.4vw,5.4rem)">Everything between <span class="mark">“it compiles”</span> and “it ships.”</h1>
<p class="lede">Join forces with Qualaces to achieve a higher standard of software quality. Our firm provides a wide range of services to guarantee your software products operate seamlessly and uphold the highest standards of quality and dependability.</p></div></section>
<section class="sec-tight" style="padding-top:0"><div class="wrap" id="explorer"><div class="filters" role="group" aria-label="Filter services">{chips}</div>
<div class="explorer"><nav class="svc-list" aria-label="Services"><ul>{lst}</ul></nav><div class="svc-detail" id="svc-detail" aria-live="polite">{panels}</div></div></div></section>
{cta("Not sure which one you need?", "Tell us what you're building and what keeps you up at night. We'll help you pick a place to start.")}
'''
    # make group headers behave: move class .grp onto li (already) and keep cat attr for filter
    page("services.html", "Services | Qualaces: Ensuring Seamless Software Quality",
         "Explore Qualaces' software testing services: smoke, sanity, regression, performance, security, usability, mobile, hardware, IoT, AI, automation and more.",
         "services.html", body)


def products():
    demos = [
        ("zero", "Zero-code", "Test your applications without writing a single line of code.",
         "QTM's intuitive interface allows anyone on your team to build, execute, and maintain tests, from test plan creation to result reporting.",
         '''<div class="mock-body"><div class="steps-mini"><span class="on">1 · Open page</span><span>2 · Click “Add to cart”</span><span>3 · Expect total</span></div>
<div class="mrow"><span class="id">STEP</span><span>Click “Add to cart”</span><span class="st wip">EDIT</span></div>
<div class="mrow"><span class="id">STEP</span><span>Expect cart total = $48.00</span><span class="st ok">OK</span></div>
<div class="mrow" style="border-style:dashed"><span class="id">＋</span><span class="muted">Add a step, no code needed</span><span></span></div></div>'''),
        ("jira", "Jira & Git", "Effortlessly integrate with Jira.",
         "Sync your projects, issues, and test cases automatically, creating a unified testing workflow across platforms. QTM's Jira and Git integrations maintain visibility and traceability across your entire software lifecycle.",
         '''<div class="mock-body"><div class="mrow"><span class="id">JIRA</span><span>PAY-482 · Card form rejects valid expiry</span><span class="st bad">OPEN</span></div>
<div class="mrow"><span class="id">QTM</span><span>TC-231 linked to PAY-482</span><span class="st wip">LINKED</span></div>
<div class="toggle"><span>Auto-sync status <b id="sync-s" data-on="ON" data-off="OFF">ON</b></span><button class="switch" type="button" role="switch" aria-checked="true" data-target="sync-s" aria-label="Auto-sync status"></button></div></div>'''),
        ("visual", "Visual AI", "Harness AI-driven visual detection.",
         "Automatically identify design flaws and UI inconsistencies, so layout regressions are caught without someone staring at screenshots.",
         '''<div class="mock-body"><div class="visual-cmp"><div class="pane"><i></i><i style="width:70%"></i><i class="btn-m"></i><small>baseline</small></div><div class="pane diff"><i></i><i style="width:70%"></i><i class="btn-m"></i><small>difference found</small></div></div></div>'''),
        ("insights", "Insights", "Gain deep visibility into your testing results.",
         "Comprehensive reporting and analytics drive informed decision-making, from the status of a single run to the health of a release.",
         '''<div class="mock-body"><div class="bars" aria-hidden="true"><i style="height:48%"></i><i style="height:62%"></i><i style="height:55%"></i><i class="f" style="height:30%"></i><i style="height:74%"></i><i style="height:82%"></i><i style="height:90%"></i></div>
<div class="mrow"><span class="id">RUN</span><span>Last 7 runs · pass rate trending up</span><span class="st ok">+</span></div></div>'''),
        ("team", "Collaboration", "Empower your team to work together.",
         "Share test cases, assign tasks, and align on testing goals, so QA is a team sport and not a silo.",
         '''<div class="mock-body"><div class="mrow"><span class="id">TC-310</span><span>Assigned to QA</span><span class="avatars"><i></i><i></i><i></i></span></div>
<div class="mrow"><span class="id">TC-311</span><span>Shared with Dev &amp; Product</span><span class="avatars"><i></i><i></i><i></i><i></i></span></div></div>'''),
    ]
    tabs = "".join(f'<button type="button" role="tab" id="d-{d[0]}" aria-controls="dp-{d[0]}">{d[1]}</button>' for d in demos)
    panels = "".join(f'''<div class="demo-panel qtm-grid" role="tabpanel" id="dp-{d[0]}" aria-labelledby="d-{d[0]}" hidden>
<div><h3 class="h-md" style="margin-bottom:16px">{d[2]}</h3><p class="lede">{d[3]}</p></div>
<div><div class="mock"><div class="mock-bar"><span>QTM</span><span class="tag">illustrative preview</span></div>{d[4]}</div></div></div>''' for d in demos)

    body = f'''
<section class="page-head"><div class="wrap"><span class="badge" style="color:var(--violet-ink)">Product</span>
<h1 class="h-xl" style="margin:24px 0 26px;font-size:clamp(2.6rem,6.4vw,5.4rem)">QTM: a <span class="mark">powerful</span> software testing tool.</h1>
<p class="lede">Empower your team to create and run tests without writing a single line of code, using the power of ChatGPT and AI. Seamlessly integrate with your development workflow and let AI handle the heavy lifting.</p>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:32px"><a class="btn" href="contact-us.html?topics=QTM&amp;note=I%27d%20like%20to%20sign%20up%20for%20QTM.#form">Sign up for QTM {ARROW}</a><a class="btn ghost" href="#features">See what it does</a></div></div></section>

<section class="sec dark on-dark" id="features"><div class="wrap">
<div class="sec-head"><p class="eyebrow"><b>Features</b> Tour</p><h2 class="h-lg">Streamlined testing with QTM.</h2>
<p class="lede">From test plan creation to result reporting, QTM provides a comprehensive suite of tools to enhance your testing capabilities.</p></div>
<div data-tabs><div class="demo-tabs" role="tablist" aria-label="QTM features">{tabs}</div>{panels}</div>
<p class="mock-note">Interface previews are illustrative.</p>
</div></section>

<section class="sec"><div class="wrap split">
<div class="sticky"><p class="eyebrow"><b>Why QTM</b></p><h2 class="h-lg" style="margin-top:22px">Unleash your testing <span class="mark">potential.</span></h2></div>
<div><p class="lede" style="max-width:none">Leverage the power of AI and intelligent automation to streamline your testing processes. With QTM, create, execute, and analyze tests faster than ever, eliminating repetitive tasks and reducing human error.</p>
<p class="lede" style="max-width:none">Our platform lets you focus on high-impact areas while the AI handles the heavy lifting, ensuring your software meets the highest standards of quality, efficiently and effortlessly.</p>
<p>At the heart of QTM lies an integration that connects your testing efforts with your development processes. Use the Jira and Git integrations to maintain visibility and traceability across your entire software lifecycle.</p></div>
</div></section>
{cta("Ready to try QTM?", "Discover how QTM can streamline your testing workflows, empower your team, and drive data-driven decision-making.")}
'''
    page("products.html", "QTM | Powerful Software Testing Tool by Qualaces",
         "Discover QTM, a powerful software testing tool with zero-code automation, seamless Jira integration, AI-driven visual testing, and more.",
         "products.html", body, flush=False)


def careers():
    pillars = [
        ("Career building guidance", "Personalized career advice and guidance from experienced mentors at Qualaces."),
        ("Valuable certifications", "Acquire industry-recognized certifications that add significant value to your professional profile."),
        ("Hands-on experience", "Immerse yourself in real-world projects and scenarios, gaining practical experience under the guidance of seasoned professionals."),
        ("Latest tools and technology", "Learn to navigate and master cutting-edge QA tools, ensuring you are equipped with the skills demanded by the industry."),
        ("Fast-track your career", "Receive guidance on making strategic career moves and advancing quickly within the QA domain."),
        ("One-on-one mentoring", "Enjoy one-on-one mentorship sessions tailored to your specific career goals and learning needs."),
    ]
    acc = "".join(f'''<div class="pillar"><h3><button type="button" aria-expanded="false" id="ph-{i}" aria-controls="pb-{i}"><span class="n">0{i}</span><span>{t}</span><span class="pm" aria-hidden="true"></span></button></h3>
<div class="body" id="pb-{i}" role="region" aria-labelledby="ph-{i}"><div><p>{d}</p></div></div></div>''' for i, (t, d) in enumerate(pillars, 1))
    body = f'''
<section class="page-head"><div class="wrap"><p class="eyebrow"><b>Careers</b> Mentorship program</p>
<h1 class="h-xl" style="font-size:clamp(2.6rem,6.4vw,5.4rem)">Become a <span class="mark">proficient QA professional.</span></h1>
<p class="lede">Join the Qualaces Quality Assurance Mentorship Program to unlock your full potential and accelerate your career. Whether you're a recent graduate or looking to transition into QA, the program provides a solid foundation for success in a rapidly evolving tech landscape.</p>
<div style="margin-top:32px"><a class="btn" href="contact-us.html?topics=Mentorship&amp;note=I%27d%20like%20to%20sign%20up%20for%20the%20mentorship%20program.#form">Sign up {ARROW}</a></div></div></section>

<section class="sec-tight"><div class="wrap"><div class="sec-head"><p class="eyebrow"><b>How we help</b> Six ways</p><h2 class="h-lg">What the program gives you.</h2></div>
<div class="pillars">{acc}</div></div></section>

<section class="sec-tight"><div class="wrap"><div class="sec-head"><p class="eyebrow"><b>Who it's for</b></p><h2 class="h-lg">Starting out, or starting over.</h2></div>
<div class="who"><div class="rv"><span class="mono muted" style="font-size:12px;letter-spacing:.1em">A</span><h3>Recent graduates</h3><p>Turn a degree into a practical QA foundation, with real projects and guidance from seasoned professionals.</p></div>
<div class="rv"><span class="mono muted" style="font-size:12px;letter-spacing:.1em">B</span><h3>Career switchers</h3><p>Moving into QA from another field? Get structured mentorship, current tools, and a clear path in.</p></div></div>
<p class="lede" style="margin-top:36px">As technology and industries evolve, staying up to date with the latest QA methodologies and tools is crucial to provide the best possible service. We make that a habit, and teach it.</p></div></section>
{cta("Ready to start?", "Sign up and we'll be in touch about the next steps.", "contact-us.html?topics=Mentorship#form")}
'''
    page("careers.html", "Careers & QA Mentorship Program | Qualaces",
         "Explore career opportunities and the mentorship program at Qualaces. Learn how we can help you build your career in quality assurance.",
         "careers.html", body)


def about():
    values = [
        ("Expertise", "Our team is made up of professional quality assurance specialists with broad expertise."),
        ("Client first", "We give our clients' needs and objectives top priority."),
        ("Tailored solutions", "Our solutions are customized to fit each client's unique objectives, financial constraints, and time constraints."),
        ("Always current", "We are dedicated to staying in the lead in the constantly changing quality assurance environment."),
        ("Integrity", "We do our business in accordance with the strictest codes of ethics and professionalism."),
        ("Collaboration", "Our devoted team collaborates directly with clients to comprehend their unique needs, difficulties, and objectives."),
    ]
    vals = "".join(f'<div class="rv"><span class="k">0{i}</span><h3>{t}</h3><p>{d}</p></div>' for i, (t, d) in enumerate(values, 1))
    body = f'''
<section class="page-head"><div class="wrap"><p class="eyebrow"><b>About us</b> Quality Aces</p>
<h1 class="h-xl" style="font-size:clamp(2.6rem,6.4vw,5.4rem)">A testing partner that works like <span class="mark">part of your team.</span></h1>
<p class="lede">Welcome to Qualaces! We are Quality Aces, dedicated to delivering products and services with the highest standards and dependability.</p></div></section>

<section class="sec-tight"><div class="wrap split">
<div class="sticky"><p class="eyebrow"><b>Our goal</b></p><h2 class="h-lg" style="margin-top:22px">Excellence, for companies of every size.</h2></div>
<div><p class="lede" style="max-width:none;color:var(--ink)">At our foundation, we think that success is driven by a dedication to excellence. Our goal is to assist companies of all sizes to meet their greatest expectations of quality.</p>
<p>We make a conscious effort to offer thorough quality assurance solutions that are suited to each client's particular demands. We seek to increase customer satisfaction and promote long-term success for our clients by utilizing our understanding of the industry, expertise, and cutting-edge tools.</p>
<p>We are experts at offering comprehensive quality assurance services to a range of sectors.</p>
<div class="facts-big"><div><small>Based in</small><strong>Calgary, Alberta</strong></div><div><small>Focus</small><strong>Software &amp; QA testing</strong></div><div><small>Product</small><strong>QTM</strong></div></div></div>
</div></section>

<section class="sec-tight"><div class="wrap"><div class="sec-head"><p class="eyebrow"><b>What we stand for</b></p><h2 class="h-lg">Six commitments.</h2></div><div class="values">{vals}</div></div></section>

<section class="sec dark on-dark" style="margin-top:clamp(40px,6vw,80px)"><div class="wrap split">
<div class="sticky"><p class="eyebrow"><b>How we work</b></p><h2 class="h-lg" style="margin-top:22px">From first call to final report.</h2></div>
<ol class="timeline">
<li><h3>Understand</h3><p>We work directly with you to understand your needs, difficulties and objectives before touching a test.</p></li>
<li><h3>Plan</h3><p>Strategic test planning and optimization, so effort goes where it pays back most.</p></li>
<li><h3>Test</h3><p>We run the right tests, from smoke to security, and keep communication clear throughout.</p></li>
<li><h3>Report</h3><p>Detailed test management and reporting, so you can see exactly where your software stands.</p></li>
</ol></div></section>
{cta("Come along for the ride.", "Together, we can raise the bar for excellence and establish new benchmarks. Get in touch to find out how we can help.")}
'''
    page("about-us.html", "About Us | Quality Assurance Experts | Qualaces",
         "Welcome to Qualaces! We are dedicated to delivering top-quality products and services with the highest standards and reliability.",
         "about-us.html", body)


def contact():
    topics = ["Test planning", "Regression", "Automation", "Performance", "Security", "Mobile", "QTM", "Mentorship", "Something else"]
    tp = "".join(f'<div class="opt"><input type="checkbox" name="topic" id="tp-{i}" value="{t}"><label for="tp-{i}">{t}</label></div>' for i, t in enumerate(topics))
    body = f'''
<section class="page-head"><div class="wrap contact-grid" style="align-items:start">
<div><p class="eyebrow"><b>Contact</b> Say hello</p>
<h1 class="h-xl" style="margin:24px 0 26px;font-size:clamp(2.2rem,4.4vw,3.8rem)">Delegate QA to us. <span class="mark">Do business on your terms.</span></h1>
<p class="lede">Tell us what you're building and what worries you about it. We'll reply with how we can help.</p>
<ul class="reach"><li><span class="k">Email</span><a href="mailto:info@qualaces.com">info@qualaces.com</a></li><li><span class="k">Phone</span><a href="tel:+15873196658">+1 (587) 319-6658</a></li>
<li><span class="k">Where</span><a href="https://www.google.com/maps/search/?api=1&amp;query=Calgary%2C+Alberta" target="_blank" rel="noopener">Calgary, Alberta, Canada ↗</a></li>
<li><span class="k">Social</span><span><a href="https://www.linkedin.com/company/qualaces/" target="_blank" rel="noopener" style="font-size:1rem">LinkedIn ↗</a></span></li></ul></div>
<div class="form-card" id="form">
<form id="contact-form" novalidate>
<div class="field"><span class="lbl" id="tl">What's this about? <span class="opt-t">(optional)</span></span><div class="opts" role="group" aria-labelledby="tl">{tp}</div></div>
<div class="field"><label for="name">Your name</label><input type="text" id="name" name="name" autocomplete="name" required><p class="msg" role="alert"></p></div>
<div class="field"><label for="email">Your email</label><input type="email" id="email" name="email" autocomplete="email" inputmode="email" required><p class="msg" role="alert"></p></div>
<div class="field"><label for="message">Message</label><textarea id="message" name="message" maxlength="2000" required></textarea><span class="count" aria-hidden="true"></span><p class="msg" role="alert"></p></div>
<div class="hp" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>
<div class="form-foot"><button class="btn" type="submit">Send message {ARROW}</button><small>We only use your details to reply to you. See our <a href="privacy-policy.html">privacy policy</a>.</small></div>
<div class="fallback-note" id="fallback" hidden>We couldn't send that just now. <a href="mailto:info@qualaces.com">Email us directly instead</a> and your message will be pre-filled.</div>
</form>
<div class="success" id="success" tabindex="-1" hidden><div class="check"><svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
<h2 class="h-md" style="margin-bottom:14px">Thank you, <span class="who-name"></span>.</h2><p class="lede">We have received your message and we'll be in touch soon.</p><p style="margin-top:24px"><a class="link-arrow" href="services.html">Browse our services {ARROW}</a></p></div>
</div></div></section>
'''
    page("contact-us.html", "Contact Us | Get in Touch with Qualaces",
         "Delegate QA to us for a bug-free experience. Let's discuss how we can help and empower you to do business on your own terms.",
         "contact-us.html", body, flush=False)


def privacy():
    body = f'''
<section class="page-head"><div class="wrap legal"><p class="eyebrow"><b>Legal</b></p><h1 class="h-lg" style="margin:22px 0 18px">Privacy policy</h1>
<p class="lede">This Privacy Policy explains how Qualaces ("we", "us", "our") collects, uses, and shares personal information when you use our website, qualaces.com (the "Site"). By using the Site, you agree to the terms of this Privacy Policy.</p>
<h2>Information we collect</h2>
<ul><li><strong>Information you provide.</strong> We collect information you voluntarily provide, such as your name, email address, and any other information you choose to provide when contacting us or using our services.</li>
<li><strong>Automatically collected information.</strong> We may automatically collect certain information when you visit our Site, including your IP address, browser type, device type, and the pages you visit.</li></ul>
<h2>Free site audit tool</h2>
<p>If you use the free site audit, we process the web address you enter, load that page and a small sample of its links, and read public response headers. Results are held in memory for one hour and then discarded. To prevent abuse we rate-limit requests by IP address. We do not log in to your site, submit forms or attempt to exploit anything.</p>
<h2>Cookies and similar technologies</h2>
<p>We use cookies and similar technologies to collect information about your preferences and browsing behavior on our Site. You can control cookies through your browser settings and other tools. However, disabling certain cookies may affect the functionality of the Site.</p>
<h2>How we use your information</h2>
<ul><li><strong>Provide and maintain the Site:</strong> to deliver and maintain the functionality of the Site.</li><li><strong>Improve and personalize our services:</strong> to understand and analyze how you use our Site and to enhance your experience.</li><li><strong>Communicate with you:</strong> to respond to your inquiries, send newsletters, and provide updates about our services.</li><li><strong>Legal compliance:</strong> to comply with applicable laws and regulations.</li></ul>
<h2>Information sharing</h2>
<p>We may share your personal information with third parties under the following circumstances:</p>
<ul><li><strong>Service providers:</strong> we may engage third-party service providers to assist with the operation of the Site and related services.</li><li><strong>Legal requirements:</strong> we may disclose your information if required by law or in response to a legal request.</li></ul>
<h2>Your rights</h2>
<p>Depending on your location, you may have certain rights regarding your personal information, including the right to access, correct, or delete your data. Please contact us at <a href="mailto:info@qualaces.com">info@qualaces.com</a> to exercise these rights.</p>
<h2>Security</h2>
<p>We take reasonable measures to protect the confidentiality and security of your personal information. However, no method of transmission over the Internet or electronic storage is completely secure.</p>
<h2>Changes to this policy</h2>
<p>We may update this Privacy Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. We will notify you of any changes by posting the updated Privacy Policy on this page.</p>
<h2>Contact us</h2>
<p>If you have any questions or concerns about this Privacy Policy, please contact us at <a href="mailto:info@qualaces.com">info@qualaces.com</a>.</p></div></section>'''
    page("privacy-policy.html", "Privacy Policy | Qualaces",
         "How Qualaces collects, uses and shares personal information when you use qualaces.com.", "privacy-policy.html", body)


def notfound():
    body = f'''<section class="nf"><div class="wrap"><p class="eyebrow"><b>404</b> Test failed</p>
<h1 class="h-xl" style="margin:24px 0">That page didn't <span class="mark">pass.</span></h1>
<p class="lede">The page you were looking for doesn't exist, or has moved. Good news: this is the kind of bug we're here to catch.</p>
<p style="margin-top:30px"><a class="btn" href="index.html">Back to home {ARROW}</a></p></div></section>'''
    page("404.html", "Page not found | Qualaces", "The page you were looking for could not be found.", "", body)


def extras():
    data = [{"id": s["id"], "name": s["name"]} for s in SERVICES]
    (ROOT / "assets/js/data.js").write_text("window.QA_SERVICES=" + json.dumps(data) + ";\n", encoding="utf-8")
    pages = ["", "services.html", "audit.html", "products.html", "careers.html", "about-us.html", "contact-us.html", "privacy-policy.html"]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{SITE}/{p}</loc></url>\n" for p in pages) + "</urlset>\n"
    (ROOT / "sitemap.xml").write_text(sm)
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
    (ROOT / "manifest.webmanifest").write_text(json.dumps({
        "name": "Qualaces", "short_name": "Qualaces", "start_url": "/", "display": "standalone",
        "background_color": "#f6f3ec", "theme_color": "#1c0f45",
        "icons": [{"src": "assets/img/apple-touch-icon.png", "sizes": "180x180", "type": "image/png"}]}, indent=2))


if __name__ == "__main__":
    for fn in (home, services, audit, products, careers, about, contact, privacy, notfound, extras):
        fn()
