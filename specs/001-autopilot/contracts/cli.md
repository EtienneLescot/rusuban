# Contract: command line

One binary, `rusuban`. An item is `owner/repo#n`, or `#n` when the project has one repo.

## Owner commands

| Command | Effect |
|---|---|
| `init` | Checks `gh` and `claude` logins, takes the owner login from `gh`, asks the host permission mode (no default), adds a first project, installs the service, prints and opens the URL. |
| `start` | Runs the daemon in the foreground (what the service calls). |
| `status` | URL (local and tailnet), uptime, projects, running agents. |
| `open` | Opens the dashboard. |
| `project add <owner/repo> [--checkout <path>] [--to <project>]` | Adds a repo, to a new or an existing project. |
| `project list` / `project remove <id>` | |
| `machine add <alias> [--os] [--caps a,b] [--checkout <path>] [--owner <login>]` | Checks SSH, git and the checkout folder, then registers the machine. `--owner` marks a person's desktop. |
| `machine list` / `machine probe [<machine>]` | |
| `channel add <ntfy\|slack\|discord\|teams\|email> <target>` / `channel test <id>` / `channel list` | |
| `task list` / `task run <id>` | |
| `remote enable` / `remote disable` | Runs `tailscale serve` for the dashboard, or stops it. |
| `service install` / `service uninstall` | Autostart with restart on failure (Task Scheduler, launchd, systemd user). |

## Agent commands

Called by agents inside a run. The launcher sets `RUSUBAN_RUN` and `RUSUBAN_PROJECT`. These commands are
the only writers of the judgment file; each validates and locks before writing.

| Command | Effect |
|---|---|
| `todo` | JSON list of what the agents must do, each with a reason: `unjudged`, `new-commit`, `ci-approval`, `missing-card`, `revisit-due`. The server computes them; no delay is built in: `revisit-due` fires at the judgment's `revisitAt`, which the agent sets from the rules (OpenScreen: a third party waits 2 days at most). |
| `show <item>` | Live state and judgment of one item. |
| `judge <file.json>` | Writes judgments. Refuses an incomplete one, or a PR judged on a head that is not the live head. |
| `resolve <item> <text>` | Closes a card as replaced, with the reason. |
| `evidence <item> <todo\|running\|ok\|fail> [url]` | Records the proof a locked path requires. |
| `log <kind> <item> <text> [url]` | Adds to the journal. |
| `answers` / `asks` | Answers and requests not handled yet. |
| `worker start <worker> <item> <mission.md>` | Starts a worker in its own worktree; at most the configured number at once. |
| `worker stop <worker>` / `worker list` | |
| `lease <machine> \| --os <os> [--caps a,b]` `[--wait 20m] --reason <text>` | Waits for and takes an exclusive lease; prints the machine. A person's desktop opens a card first. |
| `release <machine>` | Ends the lease. A run's leases are released when the run ends anyway. |

Agents never get a merge command: the server merges (research R3).
