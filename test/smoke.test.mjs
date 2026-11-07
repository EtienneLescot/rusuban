import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the CLI prints the package version", () => {
	const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	const bin = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
	assert.equal(
		execFileSync(process.execPath, [bin, "--version"], { encoding: "utf8" }).trim(),
		`rusuban ${version}`,
	);
});
