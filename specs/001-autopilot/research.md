# Research: Project autopilot for Claude Code

Phase 0 of [plan.md](plan.md). Each entry: decision, rationale, alternatives. Facts marked
**verified** were checked on this machine on 2026-11-07 (Windows 11, Claude Code 2.1.302).

## R1. Runtime and language

- **Decision**: plain ES-module JavaScript on Node.js ≥ 22, no build step, JSDoc types where they help.
- **Rationale**: the current pilot already runs this way; a published npm package cannot rely on
  Node's TypeScript stripping (it refuses files under `node_modules`), so TypeScript would bring a build.
- **Alternatives**: TypeScript with a build (rejected: build step); Bun (rejected: npm-centric users,
  Windows maturity); Python (rejected: full rewrite).

## R2. Running agents

- **Decision**: `claude -p <prompt> --output-format stream-json --verbose`, session id taken from the
  `system/init` event, final summary from the `result` event, as `engine/claude-run.mjs` does today.
- **Verified**: a headless `--resume <id>` keeps the same session id, so an answer from the dashboard
  lands in the original conversation. `--fork-session` gives a new id (used when the session is live).
- **Alternatives**: Claude Agent SDK (rejected for v1: the CLI covers everything and adds no dependency).

## R3. Containing agents

- **Decision**: agents never merge and never touch the instance's state. Built-in deny rules are passed on
  every run (`--disallowedTools`): `gh pr merge`, `gh api` calls on `/merge`, pushes to a default branch,
  edits under the instance home. The server is the only merger, after its gates.
- **Verified**: a deny rule holds under `--dangerously-skip-permissions`
  (`Bash(echo canary-merge-test*)` was refused, with a `permission_denials` entry in the result).
- **Residual risk**: deny rules match command prefixes; a determined agent can route around them. Two
  answers: the server flags any merge it did not perform (a merged PR absent from its journal), and the
  owner chooses the host profile (allowlist or full bypass) at init.
- **Later**: an agent-only GitHub token without admin rights, plus a repository ruleset.
- **Pushes**: the server also flags any commit on a default branch that none of its merges produced.
- **Desktops**: a person's desktop alias is refused to every run that does not hold its lease. Deny
  rules cannot do it: they are set when a run starts, and a run leases the desktop later. So while a
  desktop is registered, each run gets a PreToolUse hook (`--settings`), `rusuban guard`.
  - It refuses (exit 2) a Bash command that names the alias unless the run holds the lease, read on
    the machine.
  - It lets `rusuban lease` and `rusuban release` through, alone on their line.
  - Checked on Claude Code 2.1.302 on Windows: the hook runs with `--setting-sources user` and
    `--dangerously-skip-permissions`, and finds `rusuban` on the run's PATH.
  - An alias spelt another way gets through. The desktop's own agent account is the wall.
- **Shadow projects**: every GitHub write (`gh` comment, review, close, edit, `gh api` with a method,
  `git push`) is added to the deny rules.

## R4. Reading the rules

- **Decision**: read `.rusuban/rules/*.md` and `.rusuban/locks.json` from the project repo's default
  branch through `gh api repos/{o}/{r}/contents/...?ref=<default>`, cached by tree sha and refreshed each
  cycle. The server injects them into the prompts; a PR head's version is never read.
- **Rationale**: no dependency on the state of a local checkout; one source for every maintainer.
- **Alternatives**: `git show origin/<default>:<path>` from a local clone (rejected: needs a fresh fetch
  and a clone of every repo).

## R5. Watching GitHub

- **Decision**: the three GraphQL queries of `github.mjs` (open PRs, open issues, merged in 7 days) per
  repo, every 90 s by default, slower when the rate-limit budget drops under 20 %.
- **Alternatives**: webhooks (rejected: need a public endpoint); `gh webhook forward` (later: beta, needs
  repo admin).

## R6. Claude Code transcripts

- **Decision**: discover sessions under `~/.claude/projects/*/`, keep those whose `cwd` (or
  `relocatedCwd`) is inside a project folder, parse each file incrementally from its last byte offset.
- **Verified format** (internal, may change):
  - one JSON object per line; `user` and `assistant` lines carry `sessionId`, `cwd`, `gitBranch`,
    `entrypoint` (`claude-desktop`, `sdk-cli`, `cli`), `timestamp`, `message`;
  - the session title is its `custom-title`, else its `agent-name`, else the `ai-title` Claude Code
    writes itself (`aiTitle`), else its first user text; `pr-link` gives `prNumber`, `prUrl`,
    `prRepository`; `relocated` gives a new `cwd`;
  - Claude Desktop sessions live there too; the openscreen repo has 128 worktree folders;
  - files: median 0.66 MB; on 2026-11-08 the largest was 196 MB, and the whole folder 7.4 GB. A file
    is read 1 MB at a time.
- **Rules**: the folder slug (non-alphanumerics → `-`) only says where to look; membership comes from
  `cwd`, because sibling folders collide (`repo-website` vs `repo/website`). A file written in the last
  120 s marks a live session.
- **Runs**: a run's session is found by the run's own record (`session`, `cwd` in its status), not by
  its folder.
- **Linking order**: pilot run metadata → `pr-link` → `gitBranch` equal to a PR head ref → `#N` and
  GitHub URLs in the title and user messages. A run's session takes no citation: its prompt cites every
  open card. A bare `#N` links only to an item the live state knows. The `<system-reminder>` blocks
  Claude Code adds to a message are neither title nor citation, nor is a compaction's summary
  (`isCompactSummary`), which the reader does not show either. A fork's PR from its default branch
  never matches a session on `main`.
- **Missed, accepted**: a session that moves into a project folder after it started elsewhere is missed
  while its transcript stays in its first folder: only the folders a project folder's slug starts are
  read.
- **Degradation**: an unknown line type is skipped; a file that fails to parse is listed without links,
  and the hub says so.

## R7. Remote access

- **Decision**: the server listens on 127.0.0.1 only. `tailscale serve --bg --https=443
  http://127.0.0.1:<port>` publishes it to the tailnet. A request carrying `Tailscale-User-Login` must
  match the owner's login; a loopback request without it is the local user. Writes accept the `ts.net`
  origin. Funnel (public) is never used.
- **Rationale**: Serve strips spoofed identity headers; binding to loopback stops direct access.
- **Host check** (added by the analysis): every request's `Host` must be `127.0.0.1:<port>`,
  `localhost:<port>` or the instance's tailnet name, which stops DNS rebinding. A request on the tailnet
  name must carry `Tailscale-User-Login` equal to `owner.tailscaleLogin`, read by `remote enable` from
  `tailscale status --json`; it may differ from the GitHub login. GET requests are checked too: the
  transcripts are private. The tailnet name is read from `tailscale status --json` at start and every
  5 minutes.
- **Alternatives**: own login system (rejected for v1); binding to the LAN (rejected: unauthenticated).

## R8. Ping channels

- **Decision**: five outbound channels, each a small module that turns a card into a payload:
  - ntfy: HTTP POST with `Title` and `Click` headers, ntfy.sh or self-hosted;
  - Slack: incoming webhook, blocks;
  - Discord: webhook, embed;
  - Microsoft Teams: a Workflows webhook with an Adaptive Card. Office 365 connectors (the old
    "Incoming Webhook") were switched off in May 2026;
  - e-mail: SMTP through `nodemailer`, the only runtime dependency.
- **Alternatives**: Apprise (rejected: Python); answering from the channel (out of v1 by decision).

## R9. Machines

- **Decision**: a registry in the instance config. The server probes each machine every 2 min with
  `ssh -o BatchMode=yes -o ConnectTimeout=5 <alias> exit`, plus `tailscale status --json` when present.
- **Leases**: a file per machine, created exclusively (`wx`), holding the run id, pid and expiry;
  renewed while the run lives. A dead holder or a passed expiry frees the machine; a FIFO queue serves
  waiters. Machines are matched by OS and capability tags.
- **Person's desktop**: a machine with an `owner` login is leased only after that person accepts a card.
  It is asked for only when the run names it, or when nothing else fits: a request another machine
  fits queues there. In v1 the owner is the instance's own, the one person with a dashboard.
- **Enrollment**: `rusuban machine add <alias>` checks SSH, git and the checkout folder, then writes the
  entry.

- **Decided on 2026-11-07** (reflection P1 to P3), replacing the host-side lease file above: the lease
  is a directory `<workspace>/.lease` created by an atomic `mkdir` over SSH on the machine itself,
  holding the run, the instance, the pid and the expiry; renewed while the run lives, never past
  `maxLeaseMin`. The workspace holds a bare mirror fetched at lease time and one worktree per run,
  removed at release. Agents log in as a dedicated `rusuban` account. Because the machine holds its own
  lease, two instances can share it later with no server.

## R10. One daemon, supervised by the OS

- **Decision**: the server also schedules tasks (it replaces the Windows task that ran `run-due` every
  10 min). The OS restarts it: a Task Scheduler entry at logon with restart on failure (Windows), a
  launchd agent with `KeepAlive` (macOS), a `systemd --user` unit with `Restart=on-failure` (Linux).
  A missed slot runs once at the next start, as `lastSlot` already does.

## R6b. Hub details (added by the analysis)

- **Answering**: a session Rusuban started resumes in place unless its run is alive; any other session
  is answered with `--fork-session`, recorded as `forkOf` and listed under the original. `forkOf` is the
  reply run's (T059): the fork is a new session, found by its run.
- **Branch numbers**: `fix/1475-keyframes` links to #1475 as well as to the PR whose head it is.
- **Cadence**: a rescan every 30 s, cheap because only new bytes are read.

## R11. Worker worktrees

- **Decision**: each worker gets `git worktree add <home>/worktrees/<project>/<run>`, never the user's
  checkout. It is removed when the run ends, and stale worktrees are cleaned at start.

## R12. Dashboard

- **Decision**: the current vanilla page (graph, kanban, drawer), ported to English, with SSE and no
  build. New views: inbox, conversations, runs, machines, tasks. The layout works on a phone.

## R14. Claude usage limits

- **Decision**: a run whose result reports a usage limit becomes `limited`, with the reset time when the
  message gives one, else retried after 5, 15, then 60 minutes. The queue holds and the dashboard says
  why; requests are never lost.

## R13. Packaging

- **Decision**: one npm package with a `bin`, Node ≥ 22. Install with `npx rusuban init`. MIT license.
  The name is chosen before M0, with npm and GitHub checks.
