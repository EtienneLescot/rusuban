#!/usr/bin/env node
// After GitHub Pages publishes rusuban.dev, tells Bing and the other IndexNow engines which pages
// changed, instead of waiting for their next crawl. ChatGPT search answers from Bing's index.
//
// Changed = a page whose file in docs/ differs between two commits, and llms.txt when it does.
//
// Usage: node scripts/indexnow.mjs <from> <to> [--dry-run]   (--dry-run lists the URLs, sends nothing)
import { execFileSync } from "node:child_process";

const HOST = "rusuban.dev";
// Public by design: IndexNow checks it against /<key>.txt on the host.
const KEY = "7add7fb68f9db474d41eb4244a623c55";

const [from, to] = process.argv.slice(2);
const files = execFileSync("git", ["diff", "--name-only", from, to, "--", "docs/"], {
	encoding: "utf8",
}).split("\n");
const urls = [];
for (const file of files) {
	if (file === "docs/llms.txt") urls.push(`https://${HOST}/llms.txt`);
	else if (file.endsWith("/index.html"))
		urls.push(`https://${HOST}/${file.slice("docs/".length, -"index.html".length)}`);
}

if (!urls.length) {
	console.log("IndexNow: no page changed");
} else if (process.argv.includes("--dry-run")) {
	console.log(urls.join("\n"));
} else {
	const res = await fetch("https://api.indexnow.org/indexnow", {
		method: "POST",
		headers: { "Content-Type": "application/json; charset=utf-8" },
		body: JSON.stringify({
			host: HOST,
			key: KEY,
			keyLocation: `https://${HOST}/${KEY}.txt`,
			urlList: urls,
		}),
	});
	console.log(`IndexNow: ${urls.length} URL(s) sent, HTTP ${res.status}`);
	// 200 and 202 both mean accepted. Anything else fails the step, so the rejection shows in the run.
	if (res.status !== 200 && res.status !== 202) {
		console.log(await res.text());
		process.exitCode = 1;
	}
}
