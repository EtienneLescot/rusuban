import "./tmp-root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDiff, loadRules, rulesChange, validateLocks } from "../src/rules.mjs";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// A fake contents API: a tree of paths at one ref, recording every endpoint asked for.
function fakeRepo(tree, { sha = "tree1" } = {}) {
	const calls = [];
	const get = async (endpoint) => {
		calls.push(endpoint);
		const [p, query] = endpoint.replace(/^repos\/o\/r\/contents\/?/, "").split("?");
		if (query !== "ref=main") throw new Error(`HTTP 404: ${endpoint}`);
		const path = decodeURIComponent(p);
		if (path in tree) return { content: b64(tree[path]), encoding: "base64" };
		const prefix = path ? `${path}/` : "";
		const names = new Set(
			Object.keys(tree)
				.filter((k) => k.startsWith(prefix))
				.map((k) => k.slice(prefix.length).split("/")[0]),
		);
		if (!names.size) throw new Error(`HTTP 404: ${endpoint}`);
		return [...names].map((name) => {
			const full = prefix + name;
			const dir = !(full in tree);
			return {
				name,
				path: full,
				type: dir ? "dir" : "file",
				sha: dir && full === ".rusuban" ? sha : `blob-${full}`,
			};
		});
	};
	return { get, calls };
}

test("rules are read in file-name order, Markdown only", async () => {
	const { get } = fakeRepo({
		"README.md": "hi",
		".rusuban/rules/20-merge.md": "second",
		".rusuban/rules/10-scope.md": "first",
		".rusuban/rules/notes.txt": "ignored",
	});
	const r = await loadRules("o/r", "main", null, get);
	assert.deepEqual(
		r.files.map((f) => [f.name, f.text]),
		[
			["10-scope.md", "first"],
			["20-merge.md", "second"],
		],
	);
	assert.equal(r.observeOnly, false);
	assert.equal(r.treeSha, "tree1");
});

test("no rules folder: the repo is only observed, after a single call", async () => {
	const { get, calls } = fakeRepo({ "README.md": "hi" });
	const r = await loadRules("o/r", "main", null, get);
	assert.equal(r.observeOnly, true);
	assert.equal(calls.length, 1);
});

test("locks without rules still leave the repo observe-only", async () => {
	const { get } = fakeRepo({ ".rusuban/locks.json": '{"maxLines": 300}' });
	const r = await loadRules("o/r", "main", null, get);
	assert.deepEqual([r.observeOnly, r.locks], [true, { maxLines: 300 }]);
});

test("an invalid locks.json is reported and yields no locks", async () => {
	assert.match(validateLocks("{nope").errors[0], /not valid JSON/);
	assert.match(
		validateLocks('{"lockedPath": [".github/**"]}').errors[0],
		/lockedPath is not a known field/,
	);
	const bad = validateLocks('{"maxLines": -1, "mergeMethod": "fast", "evidence": [{"paths": []}]}');
	assert.equal(bad.locks, null);
	assert.equal(bad.errors.length, 3);
	const { get } = fakeRepo({ ".rusuban/rules/a.md": "x", ".rusuban/locks.json": "[1]" });
	const r = await loadRules("o/r", "main", null, get);
	assert.deepEqual([r.locks, r.errors], [null, ["locks.json must be an object"]]);
});

test("only the default branch is ever read, never a PR head", async () => {
	const { get, calls } = fakeRepo({ ".rusuban/rules/a.md": "x", ".rusuban/locks.json": "{}" });
	await loadRules("o/r", "main", null, get);
	assert.ok(calls.length > 1);
	for (const c of calls) {
		assert.match(c, /^repos\/o\/r\/contents[^?]*\?ref=main$/);
		assert.doesNotMatch(c, /pulls|head/);
	}
});

test("an unchanged tree sha reuses the cache", async () => {
	const repo = fakeRepo({ ".rusuban/rules/a.md": "x" });
	const first = await loadRules("o/r", "main", null, repo.get);
	repo.calls.length = 0;
	const again = await loadRules("o/r", "main", first, repo.get);
	assert.equal(repo.calls.length, 1);
	assert.deepEqual(again.files, first.files);
	const moved = fakeRepo({ ".rusuban/rules/a.md": "y" }, { sha: "tree2" });
	assert.equal((await loadRules("o/r", "main", first, moved.get)).files[0].text, "y");
});

test("ignoredChecks are a list of names, never also required", () => {
	assert.deepEqual(validateLocks('{"ignoredChecks":["nix build"]}').locks, {
		ignoredChecks: ["nix build"],
	});
	assert.match(validateLocks('{"ignoredChecks":"nix"}').errors[0], /ignoredChecks must be a list/);
	assert.match(
		validateLocks('{"requiredChecks":["CI"],"ignoredChecks":["CI"]}').errors[0],
		/CI both required and ignored/,
	);
});

test("a rules change names its files and gives a line diff; the first read and the same tree give none", () => {
	const rules = (treeSha, files, extra = {}) => ({
		treeSha,
		files,
		locks: null,
		errors: [],
		...extra,
	});
	const v1 = rules("t1", [
		{ name: "01-merge.md", text: "# Merging\nBug fixes merge alone.\nWait 2 days." },
		{ name: "02-old.md", text: "Gone soon." },
	]);
	const v2 = rules(
		"t2",
		[
			{ name: "01-merge.md", text: "# Merging\nBug fixes and docs merge alone.\nWait 2 days." },
			{ name: "03-new.md", text: "New rule." },
		],
		{ errors: ["locks.json is not valid JSON: x"] },
	);
	assert.equal(rulesChange(undefined, v1), null);
	assert.equal(rulesChange(v1, { ...v1 }), null);
	const change = rulesChange(v1, v2);
	assert.deepEqual(change.files, [
		"rules/01-merge.md edited",
		"rules/02-old.md removed",
		"rules/03-new.md added",
		"locks.json invalid",
	]);
	assert.match(
		change.diff,
		/--- rules\/01-merge.md\n- Bug fixes merge alone.\n\+ Bug fixes and docs merge alone./,
	);
	assert.deepEqual(lineDiff("a\nb\nc", "a\nc\nd"), ["- b", "+ d"]);
});
