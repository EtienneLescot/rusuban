// Every test process takes its temporary folders from one root of its own, removed when it exits,
// its tests failed or not: the suite had left 14,767 folders in the temp folder by 2026-11-11.
// Imported first by every test file, so os.tmpdir() leads there before anything asks for it; the
// processes a test starts inherit it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-test-"));
for (const k of ["TMPDIR", "TEMP", "TMP"]) process.env[k] = root;

process.on("exit", () => {
	try {
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 });
	} catch {}
	// What cannot go fails the file: a process still at work in it, a file still open.
	if (fs.existsSync(root)) {
		console.error(`left behind: ${root}`);
		process.exitCode = 1;
	}
});
