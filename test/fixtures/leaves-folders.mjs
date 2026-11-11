// A test file that makes folders in the temp folder, starts a process that writes there too, and
// fails: run by test/tmp-root.test.mjs, which checks nothing of it is left.
import "../tmp-root.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("makes folders, then fails", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-leak-"));
	fs.mkdirSync(path.join(dir, "deep", "deeper"), { recursive: true });
	fs.writeFileSync(path.join(dir, "deep", "file.txt"), "x");
	execFileSync(process.execPath, [
		"-e",
		"const fs = require('fs'), os = require('os'), path = require('path'); fs.mkdtempSync(path.join(os.tmpdir(), 'rusuban-child-'))",
	]);
	throw new Error("fails on purpose");
});
