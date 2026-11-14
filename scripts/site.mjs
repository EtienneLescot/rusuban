#!/usr/bin/env node
// Builds rusuban.dev into docs/, the folder GitHub Pages serves as it is: each page of site/pages
// and each Markdown doc of DOCS inside one layout, then sitemap.xml. The stylesheet, the script,
// the images, robots.txt and llms.txt are plain files in docs/, edited by hand.
//
// Usage: node scripts/site.mjs           writes the pages
//        node scripts/site.mjs --check   exits 1 when a page on disk is not what it would write
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { marked } from "marked";

const SITE = "https://rusuban.dev";
const REPO = "https://github.com/EtienneLescot/rusuban";
const ROOT = join(import.meta.dirname, "..");
// Under ~155 characters: past that, Google cuts the snippet mid-word.
const DESCRIPTION =
	"Rusuban runs Claude Code on your GitHub issues and PRs, on your machine. Agents follow the rules you write, and call you only when those rules say so.";
const OG_ALT = "Rusuban, the Claude Code autopilot for GitHub maintainers";

// The docs menu, in order. A page of site/pages/docs, or a Markdown doc that GitHub shows as well,
// given here the title and the description its text has no room for.
const DOCS = [
	{ path: "/docs/install/", nav: "Install" },
	{ path: "/docs/how-it-works/", nav: "How it works" },
	{
		path: "/docs/rules/",
		nav: "Writing rules",
		src: "docs/writing-rules.md",
		title: "Writing rules for Claude Code agents | Rusuban",
		description:
			"Rusuban's agents follow plain-text rules in your repo's .rusuban/rules/: where they live, how each run gets them, what to write, and how to try them.",
	},
	{
		path: "/docs/locks/",
		nav: "Locks",
		src: "docs/locks.md",
		title: "Merge locks: what Rusuban checks before a merge | Rusuban",
		description:
			"The eight gates Rusuban's server checks on live GitHub state before it merges a pull request, the built-in locks, merge orders and a repo's locks.json.",
	},
	{
		path: "/docs/security/",
		nav: "Security model",
		src: "docs/security.md",
		title: "Security model | Rusuban",
		description:
			"What holds Claude Code agents that run on your machine with your logins: deny rules, the host profile, merges by the server only, and the risks that remain.",
	},
	{
		path: "/docs/faq/",
		nav: "FAQ",
		src: "docs/faq.md",
		title: "FAQ | Rusuban",
		description:
			"Rusuban's rules, merges, your machine and your accounts: whose Claude plan the agents use, who they act as on GitHub, and how to stop everything.",
	},
	{
		path: "/docs/claude/",
		nav: "Set up from Claude",
		src: "docs/claude.md",
		title: "Setting Rusuban up from Claude Code | Rusuban",
		description:
			"Rusuban's MCP server lets Claude Code read your instance and change its settings. A change that widens what agents may do waits for your yes.",
	},
	{
		path: "/docs/test-machines/",
		nav: "Test machines",
		src: "docs/machines/README.md",
		title: "Test machines over SSH | Rusuban",
		description:
			"Give Rusuban's agents Linux, macOS or Windows machines over SSH, reserved one agent at a time, with a setup script for each system.",
	},
];
const DOCS_INDEX = {
	path: "/docs/",
	nav: "All docs",
	title: "Docs | Rusuban",
	description:
		"How to install Rusuban, how it works, how to write the rules its Claude Code agents follow, the merge locks, the security model and the FAQ.",
};

// Line endings as in the repo, whatever a Windows checkout made of them.
const read = (file) => readFileSync(join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const esc = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// site/pages/a/b.html is /a/b/; index.html is /, and 404.html stays a file.
function* sources(dir = "site/pages") {
	for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		const file = posix.join(dir, entry.name);
		if (entry.isDirectory()) yield* sources(file);
		else if (file.endsWith(".html")) yield file;
	}
}
function urlPath(file) {
	const rel = file.slice("site/pages/".length);
	if (rel === "index.html") return "/";
	if (rel === "404.html") return "/404.html";
	return `/${rel.slice(0, -".html".length)}/`;
}

// A page's front matter is a JSON object in its leading comment: title, description, nav (its
// name in menus), and the flags product (the SoftwareApplication node), bare (no reading column)
// and noindex.
function sourcePage(file) {
	const text = read(file);
	const head = /^<!--\s*(\{[\s\S]*?\})\s*-->\n/.exec(text);
	if (!head) throw new Error(`${file}: no front matter`);
	return { ...JSON.parse(head[1]), path: urlPath(file), body: text.slice(head[0].length) };
}

// GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens.
const slug = (html) =>
	html
		.replace(/<[^>]+>|&[a-z]+;|&#\d+;/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");

// A link of a Markdown doc, made to work from its page: to another doc's page, to a file this site
// serves, or to the repo on GitHub.
function docLink(src, href) {
	if (/^([a-z]+:|#|\/)/.test(href)) return href;
	const [path, hash] = href.split("#");
	const target = posix.join(posix.dirname(src), path);
	const anchor = hash ? `#${hash}` : "";
	const doc = DOCS.find((d) => d.src === target);
	if (doc) return doc.path + anchor;
	if (target.startsWith("docs/") && !target.endsWith("/")) return `/${target.slice(5)}${anchor}`;
	return `${REPO}/${target.endsWith("/") ? "tree" : "blob"}/main/${target}${anchor}`;
}

function renderDoc(src) {
	const seen = new Map();
	return marked
		.parse(read(src))
		.replace(/<(h[1-4])>(.*?)<\/\1>/g, (_, tag, inner) => {
			const base = slug(inner);
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			return `<${tag} id="${n ? `${base}-${n}` : base}">${inner}</${tag}>`;
		})
		.replace(/href="([^"]+)"/g, (_, href) => `href="${docLink(src, href)}"`)
		.replace(/<table>/g, '<div class="table"><table>')
		.replace(/<\/table>/g, "</table></div>");
}

const pages = [...sources()].map(sourcePage);
for (const doc of DOCS) {
	if (doc.src) pages.push({ ...doc, body: renderDoc(doc.src) });
	else if (!pages.some((p) => p.path === doc.path)) throw new Error(`${doc.path}: no page`);
}
const byPath = (prefix) =>
	pages.filter((p) => p.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path));
const docNav = () => DOCS.map((d) => ({ ...pages.find((p) => p.path === d.path), ...d }));
pages.push({
	...DOCS_INDEX,
	body: `<h1>Rusuban docs</h1>
<p class="lede">Everything about running Rusuban: install it, write the rules its agents follow, and know what holds them.</p>
<dl class="features">
${docNav()
	.map((d) => `<div><dt><a href="${d.path}">${d.nav}</a></dt><dd>${esc(d.description)}</dd></div>`)
	.join("\n")}
</dl>
`,
});

// Schema.org nodes. Organization and WebSite hold for every page. The product node goes only on
// the pages about the product, the home page and the install page, under one @id.
const ORGANIZATION = {
	"@type": "Organization",
	"@id": `${SITE}/#organization`,
	name: "Rusuban",
	url: `${SITE}/`,
	logo: `${SITE}/images/rusuban-seal.png`,
	sameAs: [REPO],
};
const WEBSITE = {
	"@type": "WebSite",
	"@id": `${SITE}/#website`,
	name: "Rusuban",
	url: `${SITE}/`,
	description: DESCRIPTION,
	inLanguage: "en",
	publisher: { "@id": ORGANIZATION["@id"] },
};
const SOFTWARE = {
	"@type": "SoftwareApplication",
	"@id": `${SITE}/#software`,
	name: "Rusuban",
	applicationCategory: "DeveloperApplication",
	applicationSubCategory: "GitHub maintenance automation",
	operatingSystem: "Windows, macOS, Linux",
	description: DESCRIPTION,
	url: `${SITE}/`,
	installUrl: `${SITE}/docs/install/`,
	downloadUrl: "https://www.npmjs.com/package/rusuban",
	softwareHelp: `${SITE}/docs/`,
	softwareRequirements: "Node.js 22 or later, GitHub CLI (gh), Claude Code",
	license: `${REPO}/blob/main/LICENSE`,
	isAccessibleForFree: true,
	// A price of 0 lets a result carry a "Free" label. The agents run on the owner's Claude plan.
	offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
	featureList: [
		"Claude Code judges every issue and pull request against rules written in the repo",
		"Agents comment, rebase and fix in worktrees of their own",
		"Only the server merges, behind locks checked on live GitHub state",
		"One inbox of cards for the decisions the rules keep for the owner",
		"Answers from a phone through Tailscale; pings on ntfy, Slack, Discord, Teams or e-mail",
		"Recurring tasks written as text",
	],
	sameAs: ["https://www.npmjs.com/package/rusuban"],
	publisher: { "@id": ORGANIZATION["@id"] },
};
const jsonLd = (nodes) =>
	JSON.stringify({ "@context": "https://schema.org", "@graph": nodes }).replace(/</g, "\\u003c");

const THEME_ICON =
	'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"></path></svg>';
const HEADER = `<header class="top">
<nav class="wrap" aria-label="Site">
<a class="brand" href="/"><span class="seal" lang="ja" aria-hidden="true">番</span>Rusuban</a>
<div class="links">
<a href="/docs/how-it-works/">How it works</a>
<a href="/docs/install/">Get started</a>
<a href="/docs/">Docs</a>
<a class="btn" href="${REPO}">GitHub</a>
<button type="button" class="icon-btn" id="theme" aria-label="Switch theme">${THEME_ICON}</button>
</div>
</nav>
</header>`;
const column = (name, links) =>
	`<div><p>${name}</p><ul>${links.map(([href, text]) => `<li><a href="${href}">${text}</a></li>`).join("")}</ul></div>`;
const FOOTER = `<footer class="foot">
<div class="wrap foot-inner">
<div class="foot-brand">
<a class="brand" href="/"><span class="seal seal-sm" lang="ja" aria-hidden="true">番</span>Rusuban</a>
<p>The Claude Code autopilot for GitHub maintainers. Free and open source, MIT license.</p>
</div>
<nav class="foot-cols" aria-label="All pages">
${column(
	"Docs",
	docNav().map((d) => [d.path, d.nav]),
)}
${column(
	"Features",
	byPath("/features/").map((p) => [p.path, p.nav]),
)}
${column(
	"Compare",
	[...byPath("/alternatives/"), ...byPath("/compare/")].map((p) => [p.path, p.nav]),
)}
${column("Project", [
	[REPO, "GitHub"],
	["https://www.npmjs.com/package/rusuban", "npm"],
	[`${REPO}/blob/main/CHANGELOG.md`, "Changelog"],
	[`${REPO}/issues`, "Issues"],
])}
</nav>
</div>
</footer>`;

function main(page) {
	if (page.bare) return page.body;
	const doc = DOCS.find((d) => d.path === page.path);
	if (!doc) return `<div class="wrap page"><article class="prose">\n${page.body}</article></div>`;
	const menu = DOCS.map(
		(d) =>
			`<li><a href="${d.path}"${d.path === page.path ? ' aria-current="page"' : ""}>${d.nav}</a></li>`,
	).join("");
	return `<div class="wrap page doc">
<nav class="doc-nav" aria-label="Docs"><ul>${menu}</ul></nav>
<article class="prose">
${page.body}</article>
</div>`;
}

function html(page) {
	const url = SITE + page.path;
	const index = page.noindex
		? '<meta name="robots" content="noindex">'
		: `<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
${index}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rusuban">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${OG_ALT}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/images/rusuban-seal.png">
<link rel="apple-touch-icon" href="/images/rusuban-seal.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&family=Zen+Kaku+Gothic+New:wght@500&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@700&text=%E7%95%AA&display=swap">
<link rel="stylesheet" href="/site.css">
<script>
	// The system's theme, unless the visitor chose one here before.
	try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}
</script>
<script type="application/ld+json">${jsonLd(page.product ? [ORGANIZATION, WEBSITE, SOFTWARE] : [ORGANIZATION, WEBSITE])}</script>
</head>
<body>
${HEADER}
<main id="top">
${main(page)}
</main>
${FOOTER}
<script src="/site.js"></script>
</body>
</html>
`;
}

const files = new Map();
for (const page of pages) {
	const file = page.path.endsWith("/") ? `${page.path}index.html` : page.path;
	files.set(`docs${file}`, html(page));
}
const listed = pages
	.filter((p) => !p.noindex)
	.map((p) => `${SITE}${p.path}`)
	.sort();
files.set(
	"docs/sitemap.xml",
	`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${listed.map((url) => `<url><loc>${url}</loc></url>`).join("\n")}
</urlset>
`,
);

if (process.argv.includes("--check")) {
	const stale = [...files].filter(([file, text]) => {
		try {
			return read(file) !== text;
		} catch {
			return true;
		}
	});
	if (stale.length) {
		console.error(`Out of date, run node scripts/site.mjs:\n${stale.map(([f]) => f).join("\n")}`);
		process.exit(1);
	}
	console.log(`${files.size} files up to date`);
} else {
	for (const [file, text] of files) {
		mkdirSync(dirname(join(ROOT, file)), { recursive: true });
		writeFileSync(join(ROOT, file), text);
	}
	console.log(`${files.size} files written`);
}
