# Security model

What keeps agents inside what their owner allows, and what does not. Research R3 holds the deny rules.
This file is about the settings: Claude can set Rusuban up (US9), and Rusuban gives agents rights.

## Three layers against a loop

1. **Rusuban's runs do not reach the settings.**
   - `mcp__rusuban` is in every run's `--disallowedTools`, like the merges.
   - There is no `--strict-mcp-config`: tasks such as publications need the user's other MCP servers.
   - The owner's commands are in every run's deny rules: `rusuban project`, `task`, `start`,
     `permissions`, `machine`, `channel`, `remote`, `service`, `init`, `mcp`.
   - The MCP server and the owner's commands refuse to run when `RUSUBAN_RUN` is in their environment.
   - Cheap shell rules: no command naming the dashboard's port or a `.ts.net` address, nor
     `config.json` next to the home's name, `automerge.json`, `answers.jsonl` or `pending.json`.
2. **What widens agents' rights, or where data goes, never applies from a non-interactive context.**
   - That context is the MCP, or a command without a terminal, which covers Claude's shell.
   - The change waits as a card that the owner allows in the dashboard. In a terminal, a typed
     confirmation is enough.
   - FR-092 lists what widens.
3. **What narrows applies at once**: shadow mode, the bypass off, the switch disarmed, a project, a
   channel or a machine removed.

Every change, either way, goes to `settings.jsonl` with its origin: a terminal, the command line
without one, the MCP, or a confirmation in the dashboard. The page shows it in the journal.

## Residual risk

- Under the bypass host profile, an agent has the user's shell. It can get around these layers by
  editing `config.json`, or by calling the local API with a forged `Origin` and `x-rusuban`: to answer
  its own cards, arm the switch, or allow a setting's confirmation card, the one an MCP change waits
  on included. The shell rules match text: a variable, a script or an interpreter gets past them.
- The layers stop the direct paths and prompt injections, not a determined agent. For a repo that is
  not trusted, the answer remains the allowlist profile. A `config.json` changed outside the settings
  module is flagged in the journal with what changed (T125), after the fact: an approval bypass it
  turns on pings at once.
- After v1, the real barrier: agents under an OS account of their own, or in Claude Code's sandbox
  where it exists, out of reach of the owner's files and the dashboard; and a GitHub token reserved for
  agents, without admin rights.
