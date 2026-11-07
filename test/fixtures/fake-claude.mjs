// Stands in for `claude -p --output-format stream-json` in tests: reads the prompt on stdin, prints
// the events a real session prints, and reports the arguments it got in its final answer.
import { delimiter } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
emit({ type: "system", subtype: "init", session_id: "00000000-0000-4000-8000-000000000001" });
emit({
	type: "assistant",
	message: { content: [{ type: "text", text: `Reading: ${prompt.trim()}` }] },
});
emit({
	type: "assistant",
	message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr merge 1" } }] },
});
await sleep(Number(process.env.FAKE_CLAUDE_MS ?? 0));
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
			cwd: process.cwd(),
			cli: searchPath.split(delimiter)[0],
		}),
	permission_denials: [{ tool_name: "Bash", tool_input: { command: "gh pr merge 1" } }],
	duration_ms: 1200,
	num_turns: 2,
});
process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? (limit ? 1 : 0)));
