// Every example under examples/rules/ goes through the real rules loader, served as a repo's
// .rusuban/ folder on its default branch: an example that would not load in a repo fails here.
import "./tmp-root.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadRules } from "../src/rules.mjs";

const EXAMPLES = fileURLToPath(new URL("../examples/rules/", import.meta.url));

// The contents API of a repo whose .rusuban/ folder is the example's folder.
const repoOf = (dir) => async (endpoint) => {
	const m = /^repos\/o\/r\/contents\/?([^?]*)\?ref=main$/.exec(endpoint);
	if (!m) throw new Error(`HTTP 404: ${endpoint}`);
	const p = decodeURIComponent(m[1]);
	if (!p) return [{ name: ".rusuban", path: ".rusuban", type: "dir", sha: "tree" }];
	const [root, ...rest] = p.split("/");
	if (root !== ".rusuban") throw new Error(`HTTP 404: ${endpoint}`);
	const local = path.join(dir, ...rest);
	if (fs.statSync(local).isFile())
		return { content: fs.readFileSync(local).toString("base64"), encoding: "base64" };
	return fs.readdirSync(local, { withFileTypes: true }).map((e) => ({
		name: e.name,
		path: `${p}/${e.name}`,
		type: e.isDirectory() ? "dir" : "file",
		sha: `sha-${p}/${e.name}`,
	}));
};

const examples = fs
	.readdirSync(EXAMPLES, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name);

test("examples/rules holds examples", () => assert.ok(examples.length > 0));

for (const name of examples)
	test(`the ${name} example loads as a repo's rules, every file read and its locks valid`, async () => {
		const dir = path.join(EXAMPLES, name);
		const r = await loadRules("o/r", "main", null, repoOf(dir));
		assert.deepEqual(r.errors, [], "locks.json is valid");
		assert.ok(r.locks, "it has a locks.json");
		assert.equal(r.observeOnly, false, "it has rules");
		// The loader skips anything but Markdown files in silence: an example holds nothing it skips.
		assert.deepEqual(
			r.files.map((f) => f.name),
			fs.readdirSync(path.join(dir, "rules")).sort(),
		);
		for (const f of r.files) assert.ok(f.text.trim(), `${f.name} is empty`);
	});
