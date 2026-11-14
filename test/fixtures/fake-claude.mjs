// Stands in for `claude -p --output-format stream-json` in tests: reads the prompt on stdin, prints
// the events a real session prints, and reports the arguments it got in its final answer.
import { writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
// The session says the model it runs on: the one asked, unless FAKE_CLAUDE_MODEL says otherwise.
const asked = process.argv[process.argv.indexOf("--model") + 1];
emit({
	type: "system",
	subtype: "init",
	session_id: "00000000-0000-4000-8000-000000000001",
	model: process.env.FAKE_CLAUDE_MODEL ?? asked,
});
// FAKE_CLAUDE_AUTH: the login no longer works, in the events `claude -p` printed on an expired one.
if (process.env.FAKE_CLAUDE_AUTH) {
	const text =
		"Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN for unattended jobs";
	emit({
		type: "assistant",
		error: "authentication_failed",
		message: { model: "<synthetic>", content: [{ type: "text", text }] },
	});
	emit({ type: "result", subtype: "success", is_error: true, result: text, num_turns: 1 });
	process.exit(1);
}
emit({
	type: "assistant",
	message: { content: [{ type: "text", text: `Reading: ${prompt.trim()}` }] },
});
emit({
	type: "assistant",
	message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr merge 1" } }] },
});
await sleep(Number(process.env.FAKE_CLAUDE_MS ?? 0));
// A worker builds in its work folder, as its prompt says: something there for the run's end to remove.
if (process.env.RUSUBAN_WORK) writeFileSync(join(process.env.RUSUBAN_WORK, "build.out"), "built\n");
// FAKE_CLAUDE_LIMIT: the run hits a usage limit, with that text as its result.
const limit = process.env.FAKE_CLAUDE_LIMIT;
const searchPath = Object.entries(process.env).find(([k]) => k.toUpperCase() === "PATH")?.[1] ?? "";
emit({
	type: "result",
	is_error: !!limit,
	result:
		limit ??
		JSON.stringify({
			args: process.argv.slice(2),
			run: process.env.RUSUBAN_RUN,
			project: process.env.RUSUBAN_PROJECT,
			work: process.env.RUSUBAN_WORK,
			cwd: process.cwd(),
			cli: searchPath.split(delimiter)[0],
			hooks: process.env[`GIT_CONFIG_VALUE_${Number(process.env.GIT_CONFIG_COUNT) - 1}`],
		}),
	permission_denials: [{ tool_name: "Bash", tool_input: { command: "gh pr merge 1" } }],
	duration_ms: 1200,
	num_turns: 2,
});
process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? (limit ? 1 : 0)));
