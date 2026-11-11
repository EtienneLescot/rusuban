// The tests leave nothing in the temp folder (test/tmp-root.mjs), asked on 2026-11-11.
import "./tmp-root.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const TEST = fileURLToPath(new URL(".", import.meta.url));

test("a test file leaves nothing in the temp folder, failed or not, nor do the processes it starts", () => {
	// This process's own root: the file run below makes its own inside it.
	const before = fs.readdirSync(os.tmpdir());
	// A run of its own, not a part of this one's: without the context the test runner hands down.
	const { NODE_TEST_CONTEXT: _, ...env } = process.env;
	const run = spawnSync(
		process.execPath,
		["--test", path.join(TEST, "fixtures/leaves-folders.mjs")],
		{ encoding: "utf8", env },
	);
	assert.notEqual(run.status, 0, "its test fails");
	assert.match(run.stdout, /fails on purpose/);
	assert.doesNotMatch(`${run.stdout}${run.stderr}`, /left behind/);
	assert.deepEqual(fs.readdirSync(os.tmpdir()), before);
});

test("every test file takes its temporary folders from that root, imported first", () => {
	const files = [
		...fs
			.readdirSync(TEST)
			.filter((f) => f.endsWith(".test.mjs"))
			.map((f) => path.join(TEST, f)),
		path.join(TEST, "e2e", "app.mjs"),
	];
	assert.ok(files.length > 20);
	for (const file of files)
		assert.match(
			fs.readFileSync(file, "utf8").match(/^import .*$/m)?.[0] ?? "",
			/^import "\.{1,2}\/tmp-root\.mjs";$/,
			path.relative(TEST, file),
		);
});
