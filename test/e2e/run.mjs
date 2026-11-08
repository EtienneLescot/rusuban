// The runner of a click test's runs: the real one (src/agents.mjs), in its own process like the
// product's, with fake-claude in place of `claude`. It works in the instance home it was started in.
import { fileURLToPath } from "node:url";
import { executeRun } from "../../src/agents.mjs";

const FAKE = fileURLToPath(new URL("../fixtures/fake-claude.mjs", import.meta.url));
await executeRun(process.argv[2], { command: [process.execPath, FAKE] });
