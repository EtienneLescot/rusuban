# Contract: command line

One binary, `rusuban`. An item is `owner/repo#n`, or `#n` when the project has one repo.

## Owner commands

| Command | Effect |
|---|---|
| `init` | Checks `gh` and `claude` logins, takes the owner login from `gh`, asks the host permission mode and whether to arm automatic merges (no default for either), adds a first project, installs the service, prints and opens the URL. |
| `start` | Runs the daemon in the foreground (what the service calls). |
| `status` | URL (local and tailnet), uptime, projects, running agents. |
| `open` | Opens the dashboard. |
| `project add <owner/repo> [--checkout <path>] [--to <project>]` | Adds a repo, to a new project (in `shadow` mode, its id from the repo's name) or to an existing one. A repo belongs to one project. |
| `project list` / `project remove <id>` | `remove` refuses while a run of the project waits or works, deletes no file and says where they stay. |
| `project mode <id> <live\|shadow>` | `shadow`: agents judge and propose, every GitHub write is denied, nothing is merged. Runs at work keep the mode they started in. |
| `project bypass <id> <on\|off>` | The approval bypass (FR-029): the server merges with `--admin` what it would merge anyway, once every check the base branch requires is green on the head. Off for every new project. |
| `permissions <bypass\|allowlist>` | The host profile (FR-025): what agents may run on this machine. `bypass` widens it. |
| `machine add <alias> [--os] [--caps a,b] [--workspace <path>] [--owner <login>]` | Checks SSH, the `rusuban` account, git and the workspace, creates the bare mirror, then registers the machine. `--owner` marks a person's desktop. |
| `machine list` / `machine probe [<machine>]` / `machine doctor <machine>` | `doctor` rechecks SSH, the account, the workspace and the project's toolchain. |
| `channel add <ntfy\|slack\|discord\|teams\|email> <target> [--urgency now,digest] [--quiet HH:MM-HH:MM] [--digest HH:MM] [--smtp <url>] [--from <address>] [--token <token>]` / `channel test <id>` / `channel list` / `channel remove <id>` | Adding one sends data out (FR-092): confirmed. A target shows only its host. |
| `task list` / `task run <id>` | The catalog with each task's slots, state and last runs; starts a task now, refused while one of its runs waits or works. |
| `task add <file.md>` / `task remove <id>` | Writes a task into the instance (it widens: confirmed, FR-092), or sets one aside, its file kept as `<id>.md.removed`. |
| `mcp` | Rusuban's MCP server on stdio (`contracts/mcp.md`). |
| `remote enable` / `remote disable` | Runs `tailscale serve` for the dashboard, or stops it. |
| `service install` / `service uninstall` | Autostart with restart on failure (Task Scheduler, launchd, systemd user). |

The `project` commands write `config.json`; a running daemon reads it again within seconds, without a
restart. Each command asks that daemon whether it applied the change and says so. The owner's commands
refuse to run inside an agent run, and the built-in deny rules forbid them (FR-095).

A change that widens what agents may do (FR-092) is confirmed in a terminal by typing its target; from
a command without a terminal, which covers Claude's shell, it waits as a card the owner allows in the
dashboard. A change that narrows applies at once. The MCP server (`contracts/mcp.md`) offers the same
settings through the same module.

## Agent commands

Called by agents inside a run. The launcher sets `RUSUBAN_RUN` and `RUSUBAN_PROJECT`. These commands are
the only writers of the judgment file; each validates and locks before writing.

| Command | Effect |
|---|---|
| `todo` | JSON list of what the agents must do, each with a reason, all computed by the server: `unjudged` (open item, no judgment); `new-commit` (PR head differs from the judged head); `ci-approval` (a fork's workflow waits for approval); `missing-card` (owned by a person, no open card); `revisit-due` (its `revisitAt` has passed: the agent sets it from the rules, no delay is built in; OpenScreen waits 2 days for a third party); `lock-blocked` (judged `auto` but a project lock or the rules-folder lock stops it: the agent writes a card); `conflict` (judged `auto` on its head, but its base moved and it now conflicts, or cannot be rebased for a rebase merge: a worker rebases it); `merge-refused` (GitHub refused the server's merge of that head, its reason given: the agent puts it on a card for the owner; the server never tries that head again). |
| `show <item>` | Live state and judgment of one item. |
| `judge <file.json>` | Writes judgments. Refuses an incomplete one, or a PR judged on a head that is not the live head. |
| `resolve <item> <text>` | Closes a card as replaced, with the reason. |
| `evidence <item> <todo\|running\|ok\|fail> [url]` | Records the proof a locked path requires, for the live head. Accepted only from a worker run other than the one that judged the item; the run and its conversation are attached. |
| `log <kind> <item> <text> [url]` | Adds to the journal. |
| `answers` / `asks` | Answers and requests not handled yet. |
| `worker start <worker> <item> <mission.md>` | Starts a worker in its own worktree; at most the configured number at once. |
| `worker stop <worker>` / `worker list` | |
| `lease <machine> \| --os <os> [--caps a,b]` `[--wait 20m] --reason <text>` | Waits for and takes an exclusive lease, held on the machine itself (atomic `mkdir`) and capped at `maxLeaseMin`; prints the machine. A person's desktop opens a card first. |
| `release <machine>` | Ends the lease. A run's leases are released when the run ends anyway. |

Agents never get a merge command: the server merges (research R3).
