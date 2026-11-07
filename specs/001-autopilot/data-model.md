# Data model: Project autopilot for Claude Code

Everything lives in files, as today: JSON written atomically (temp file + rename), JSONL appended. Each
file has **one writer**. `rusuban` is the product name.

## Instance home (`~/.rusuban/`)

| Path | Writer | Content |
|---|---|---|
| `config.json` | CLI (`init`, `project`, `machine`, `channel`) | owner, host permissions, port, projects, machines, channels |
| `projects/<p>/live.json` | daemon | per repo: `{ checkedAt, changedAt, prs[], issues[], merged[] }` |
| `projects/<p>/rules.json` | daemon | per repo: `{ treeSha, text, locks, loadedAt }` from the default branch |
| `projects/<p>/judgment.json` | agent CLI only | `{ items: { "<owner/repo#n>": Judgment } }` |
| `projects/<p>/answers.jsonl` | daemon | `{ at, item, card, option, note, by }` |
| `projects/<p>/asks.jsonl` | daemon | `{ at, text, item?, by }` |
| `projects/<p>/journal.jsonl` | daemon | `{ at, kind, item?, text, href?, by }` |
| `projects/<p>/agent-log.jsonl` | agent CLI, under the judgment lock | same shape; the dashboard shows both files as one journal |
| `automerge.json` | daemon | the merge switch: `{ armed, at, by }`; `init` asks whether to arm it |
| `runs/<run>/status.json` | the run's launcher | Run |
| `runs/<run>/<ts>.log` | the run's launcher | readable live steps |
| `hub/index.json` | daemon | `{ sessions: { "<id>": Conversation }, files: { "<path>": { size, offset, mtime } } }` |
| `<workspace>/.lease/` on each machine | lease module (agent CLI and daemon, same code) | Lease, created by an atomic `mkdir` over SSH: the machine arbitrates |
| `leases/queue.json` | lease module, under a host lock | `{ "<machine>": [runId] }`, FIFO |
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
  "permissions": { "mode": "bypass", "allow": [], "deny": [] },
  "projects": [Project],
  "machines": [Machine],
  "channels": [Channel]
}
```

- `permissions.mode`: `bypass` or `allowlist`, asked at init, no default. `deny` adds to the built-in
  deny rules (research R3), it never removes them.
- `version`: checked on load; an update migrates older files (FR-074).
- `owner.tailscaleLogin`: written by `remote enable` from `tailscale status --json`; it may differ from
  the GitHub login (research R7).
- `limits`: written explicitly by `init`; `maxWorkers` caps concurrent workers, `maxRunMinutes` stops a
  run that hangs.

### Project

`{ id, title, mode: "live" | "shadow", repos: [{ slug: "owner/repo", checkout: "<path>" }], folders: ["<path>"], refreshSec: 90 }`

- `mode`: `shadow` lets agents judge and propose while every GitHub write is denied and nothing is merged
  (FR-028).

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

### Run

`{ id, kind: "judge" | "act" | "worker" | "task" | "reply", project, items[], session, cwd, worktree,
leases[], trigger, state, startedAt, endedAt, exitCode, step, summary }`

- `state`: `queued → running → done | failed | stopped`; `running` with a dead pid reads `interrupted`.

### Conversation

`{ id, project, cwd, title, origin: "rusuban" | "claude-desktop" | "cli" | "sdk-cli", run?, forkOf?,
firstAt, lastAt, live, branch, prs[], items[], parseError? }`

### Machine and lease

- **Machine**: `{ name, os: "windows" | "macos" | "linux", ssh: "<alias>" | null, caps: ["display",
  "gpu", "webcam"], workspace, agentUser: "rusuban", owner?: "<login>", maxLeaseMin: 60 }`. `ssh: null`
  is the host itself. The workspace holds `<project>/mirror.git` and one worktree per run.
- **Probe state** (in memory, pushed to the page): `online | offline | unknown`, `checkedAt`.
- **Lease**: `{ machine, run, pid, since, expires, reason }`. Transitions: `free → held → released |
  expired`; a person's desktop goes `requested → held` only through an accepted card.

### Task (`tasks/<id>.md`)

Front matter `title`, `project`, `schedule` (`daily HH:MM,…`, optional), `lock` (group), `cwd`, then the
prompt. Unchanged from today, plus `project`.

### Channel

`{ id, type: "ntfy" | "slack" | "discord" | "teams" | "email", target, urgency: ["now", "digest"],
quietHours?: "22:00-08:00", digestAt?: "18:00" }`
