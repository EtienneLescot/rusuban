# Data model: Project autopilot for Claude Code

Everything lives in files, as today: JSON written atomically (temp file + rename), JSONL appended. Each
file has **one writer**. `rusuban` is the product name.

## Instance home (`~/.rusuban/`)

| Path | Writer | Content |
|---|---|---|
| `config.json` | the settings module (`src/settings.mjs`), for the owner's commands, the MCP and the dashboard's confirmations, under `settings.lock` | owner, host permissions, port, projects, machines, channels; the daemon reads it again when it changes |
| `pending.json` | the settings module | `{ requests: [{ id, at, origin, by, change, project, card, said }] }`: settings that widen, waiting for the owner's confirmation (FR-092) |
| `settings.jsonl` | the settings module | `{ at, kind: "setting", setting, project, origin, by, state, text, request?, notify? }`, `state` one of `applied`, `pending`, `confirmed`, `declined`; shown in the journal |
| `projects/<p>/live.json` | daemon | per repo: `{ checkedAt, changedAt, prs[], issues[], merged[] }` |
| `projects/<p>/rules.json` | daemon | per repo: `{ treeSha, text, locks, loadedAt }` from the default branch |
| `projects/<p>/judgment.json` | agent CLI only | `{ items: { "<owner/repo#n>": Judgment }, proposals: { "rule:<id>": Rule proposal } }` |
| `projects/<p>/answers.jsonl` | daemon | `{ at, item, card, option, note, by }`; a rule proposal's `item` is its own id |
| `projects/<p>/asks.jsonl` | daemon | `{ at, text, item?, by }` |
| `projects/<p>/journal.jsonl` | daemon | `{ at, kind, item?, text, href?, by }` |
| `projects/<p>/agent-log.jsonl` | agent CLI, under the judgment lock | same shape; the dashboard shows both files as one journal |
| `projects/<p>/triggers.json` | daemon | what started the last judge and coordinator, `{ sig, at, run }` each, and `examined: { "<owner/repo#n>": head }`: the fork CI approvals a judge ended on, which come back on a new head only |
| `pings.json` | daemon | the pings' state between two calls of the dispatcher: per channel, since when it pings and what it sent or retries |
| `automerge.json` | the settings module (the dashboard's switch, the MCP) | the merge switch: `{ armed, at, by }`; `init` asks whether to arm it; arming it from Claude waits for the owner (FR-092) |
| `runs/<run>/status.json` | the run's launcher | Run |
| `runs/<run>/<ts>.log` | the run's launcher | readable live steps |
| `hub/index.json` | daemon | `{ version, scannedAt, sessions: { "<id>": Conversation }, files: { "<path>": { size, offset, mtime } } }`; an index of another version is read again from scratch |
| `<workspace>/.lease/` on each machine | lease module (agent CLI and daemon, same code) | Lease, created by an atomic `mkdir` over SSH: the machine arbitrates |
| `leases/queue.json` | lease module, under a host lock | `{ "<machine>": [{ run, pid, since }] }`, FIFO; a waiter whose `lease` command died loses its place |
| `leases/probes.json` | daemon | `{ at, probes: [{ name, state, checkedAt, lease, said?, tailnet }] }`: the last probe, which the page and the agents' context read |
| `leases/requests.json` | `lease` command, under the host lock | `{ "<run>": { run, project, reason, asks: [{ machine, owner }], at } }`: the desktops a run asks for (T070) |
| `leases/answers.json` | daemon, under the host lock | `{ "<run> <machine>": { yes, by, at } }`: the owner's answers, which the waiting command reads |
| `tasks/<id>.md` | the user | Task |
| `worktrees/<p>/<run>/` | worker launcher | git worktree of a worker |

`config.json` is created with mode 600: it holds channel secrets.

## Entities

### Instance config

```json
{
  "version": 1,
  "owner": { "login": "EtienneLescot", "tailscaleLogin": "etienne@example.com" },
  "port": 8788,
  "limits": { "maxWorkers": 3, "maxRunMinutes": 150 },
  "model": "claude-opus-5-5",
  "permissions": { "mode": "bypass", "allow": [], "deny": [] },
  "projects": [Project],
  "machines": [Machine],
  "channels": [Channel]
}
```

- `permissions.mode`: `bypass` or `allowlist`, asked at init, no default. `deny` adds to the built-in
  deny rules (research R3), it never removes them.
- `model`: the Claude model every run uses (FR-098), a Claude Code id or alias, passed as `--model`.
  Asked at init, no default; a config without one loads, but no run starts until `rusuban model`
  sets it.
- `version`: the format of the whole instance home, config.json and every state file under it (FR-074).
  A rusuban that finds a newer one refuses to load it; a change to any file's format bumps it, and the
  update that brings it migrates the home on load. Version 1 has no migration yet.
- `owner.tailscaleLogin`: written by `remote enable` from `tailscale status --json`; it may differ from
  the GitHub login (research R7).
- `limits`: written explicitly by `init`; `maxWorkers` caps concurrent workers, `maxRunMinutes` stops a
  run that hangs.

### Project

`{ id, title, bypassApproval: false, repos: [{ slug: "owner/repo", checkout: "<path>" }], folders: ["<path>"], refreshSec: 90 }`

- `repos` may be empty, or left out: a project without a repo (FR-096) holds tasks, their runs and
  conversations. The daemon starts no read loop for it, so nothing is read, judged or merged on GitHub.
- No `mode`: shadow mode was removed on 2026-11-09 (FR-028). A config that still names one is refused at
  load, so a project that was in shadow mode never starts acting unasked: removing the key is the owner's
  go.
- A repo belongs to one project (slugs compared without case): two would read, judge and merge it each on
  their own.
- `bypassApproval` (FR-029): off unless `project bypass <id> on` sets it; never read from a repo. The server
  then merges with `--admin`, only after checking the base branch's rules itself. Its changes are
  journaled (`bypass`, with `on`), a change made while the daemon was stopped when it starts.

- `folders`: extra folders whose conversations belong to the project (a website checkout, a scratch dir).
  Each checkout's worktrees are included automatically.

### Locks (`.rusuban/locks.json` in the project repo, optional)

```json
{
  "mergeMethod": "rebase",
  "lockedPaths": [".github/**", "package-lock.json"],
  "maxLines": 300, "maxFiles": 15,
  "sizeExempt": ["**/*.test.*", "docs/**"],
  "requiredChecks": [], "requiredReviewers": ["coderabbitai"], "ignoredChecks": ["nix build"],
  "evidence": [{ "paths": ["crates/compositor/**"], "what": "pixel-identical export and ±5 % timing" }]
}
```

- **Built-in locks** (always on, not configurable): CI green on the exact head, no unresolved review
  thread, head unchanged since judgment, the `.rusuban/` folder itself, never a push to the default
  branch, the global merge switch.
- `evidence` generalizes OpenScreen's R4 measure: a PR touching these paths needs a recorded proof.
- `sizeExempt` files count toward neither the size locks nor an `evidence` zone: a PR that touches only
  tests or docs under a zone needs no proof.
- `ignoredChecks`: check names that never block a merge (a slow optional build, a fork notification);
  never all of them. A head whose only checks are ignored is not green.

### Item (live)

- **PR**: `repo, n, title, url, author, draft, head, headRef, base, additions, deletions, files[], refs[],
  closes[], mergeable, canBeRebased, ci { state, runId }, reviews { "<login>": state }, threadsOpen,
  createdAt, updatedAt`.
- **Issue**: `repo, n, title, url, author, labels[], comments, createdAt, updatedAt`.

### Judgment (keyed `owner/repo#n`)

| Field | Values |
|---|---|
| `type` | `pr` \| `issue` |
| `label` | short title |
| `kind` | `bug` \| `feature` \| `maintenance` \| `docs` \| `translation` \| `question` \| `other` |
| `owner` | `agent` \| `third` \| a GitHub login |
| `waits` | who or what a `third` item waits on, else null |
| `next`, `block` | the next step; what blocks, or null |
| `priority`, `area` | `P0`…`P3`; free text defined by the project's rules |
| `links` | `{ issues[], before[], duplicateOf }` |
| `pr` | `{ head, auto, why, evidence: { needed, state, head, href, run, conversation } }`; evidence is accepted only from a worker run other than the one that judged |
| `decision` | Decision card or null |
| `revisitAt` | ISO date, required when `owner` is `agent` or `third`: when the item comes back to the agents. Set from the rules, so no delay is built into the product. |
| `judgedAt` | ISO date |

### Decision card

`{ id, to: "<login>", urgency: "now" | "digest", q, ctx, rec, why, options: [{ id, label, effect,
message? }], createdAt, resolvedAt, outcome }`

- Transitions: `open → resolved` by an answer (option or free note); `open → replaced` by a newer
  judgment, which refuses late answers.
- Resolution is derived, so no file has two writers: a card is resolved when `answers.jsonl` (daemon)
  holds an answer for its id, replaced when the agent CLI's `resolve` marks it in `judgment.json`.
- In v1 every card is delivered to the owner; `to` still names its intended login.
- `writtenUnder` (FR-101): the fingerprint of the product's card rules the card was written under,
  stamped by the agent CLI whatever the input says. An open, unanswered card under another one comes
  back to the judge once, as `stale-card`; judged again with its question, it keeps its id.
- `about` (FR-099): `"rule"` or `"lock"` when the card asks how the agents follow the project, so it
  waits in Rules & settings; none when it is the item's question. A card on a PR judged `auto` is
  one or the other without it: `"lock"` when an option orders the merge, `"rule"` otherwise.

### Rule proposal (keyed `rule:<id>`, FR-099)

`{ id, repo, file, rule, items: ["<owner/repo#n>"], q, ctx, done, urgency, rec: "open", options:
[open, no], to, by, createdAt, resolvedAt, outcome, state }`

- Written by `rusuban propose`: two items or more, of one repo, each with an open card and in no other
  open proposal; `file` is `.rusuban/rules/<name>.md`. Its options are the server's: "Open the rule
  PR" and "Not a rule".
- Answered and closed like a card, its id standing for its item.

### Run

`{ id, kind: "judge" | "act" | "worker" | "task" | "reply", project, items[], session, cwd, worktree,
leases[], trigger, state, startedAt, endedAt, exitCode, step, summary, crash?, modelAsked, model }`

- `modelAsked` is the config's model the run was started on; `model` is the one its session
  announced in its init event (FR-098).

- `state`: `queued → running → done | failed | stopped`; `running` with a dead pid reads `interrupted`.
- An interrupted run is journaled once by the daemon, with why: the error its runner noted in `crash`
  as it crashed, the host's restart, or neither. Its `endedAt` and `summary` are set then, and it is
  asked again unless it was its third attempt.

### Conversation

`{ id, project, cwd, title, origin: "rusuban" | "claude-desktop" | "cli" | "sdk-cli", run?, forkOf?,
firstAt, lastAt, live, branch, prs[], items[], parseError? }`

- The page shows a run's session under its run's title, not its prompt. `forkOf` comes from the reply
  run that made the fork (T059), as do `runKind` and `runState`.

### Machine and lease

- **Machine**: `{ name, os: "windows" | "macos" | "linux", ssh: "<alias>" | null, caps: ["display",
  "gpu", "webcam"], workspace, agentUser: "rusuban", owner?: "<login>", maxLeaseMin: 60 }`. `ssh: null`
  is the host itself. The workspace holds one bare mirror per repo, `<project>/<repo>.git`, and one worktree per run.
- **Probe state** (in memory, pushed to the page): `online | offline | unknown`, `checkedAt`.
- **Lease**: `{ machine, run, instance, pid, project, since, expires, reason }`, in
  `<workspace>/.lease` on the machine. Transitions: `free → held → released |
  expired`; a person's desktop goes `requested → held` only through an accepted card.

### Task (`tasks/<id>.md`)

Front matter `title`, `project`, `schedule` (`daily HH:MM,…`, optional), `lock` (group), `cwd`, then the
prompt. Unchanged from today, plus `project`. Without `lock` a task is its own group; without `cwd` it
works in its project's scratch folder. A dotted lock is a project's group and starts with the task's own
project (`sandbox.coordinator`); a group shared across projects has no dot (`publishing`).

### Channel

`{ id, type: "ntfy" | "slack" | "discord" | "teams" | "email", target, urgency: ["now", "digest"],
quietHours?: "22:00-08:00", digestAt?: "18:00", smtp?, from?, token? }`

- `target`: the topic's or the webhook's URL, or the e-mail address. It is a secret: shown masked.
- `smtp`: an e-mail channel's server, `smtps://user:pass@host:465`; required for `email`.
- `from`: an e-mail's sender; the server's user when absent.
- `token`: a protected ntfy topic's access token, sent as `Authorization: Bearer`.

What pings: every card waiting in the inbox, by its urgency, and what the journal flags for the owner
(`notify`). A flag goes at once when it is a rules change, an approval bypass turned on, or a merge or
a push the server did not make; any other waits for the digest. A `ping-failed` flag never pings, or a
broken channel would loop. Each pings once per channel, and never one older than the channel.
