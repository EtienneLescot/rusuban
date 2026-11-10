# Contract: the MCP server (`rusuban mcp`)

Every setting from Claude (US9, FR-090 to FR-095). A stdio MCP server, started by Claude Code as
`rusuban mcp`; `init` registers it with `claude mcp add --scope user rusuban -- <node> <bin> mcp`, absolute
paths that no shell's PATH or Windows `.cmd` shim changes. Its tools
call the same settings module as the owner's commands (`src/settings.mjs`): one implementation.

## Refusals

- Inside a Rusuban run (`RUSUBAN_RUN` in its environment), the server refuses to start, and every tool
  refuses. Every run also has `mcp__rusuban` in its disallowed tools (layer 1).
- No tool answers a card, approves, merges or confirms a setting (FR-091).

## Tools

Reading:

| Tool | Returns |
|---|---|
| `state` | The instance: owner, host profile, limits, the merge switch, projects with their bypass and repos, and the settings waiting for a confirmation. |
| `project_state` | One project: its items with their judgments, open cards, freshness, rules and locks. |
| `runs` | Runs at work and recent ones, with their conversation. |
| `tasks` | The task catalog with each task's schedule, next slot, state and last runs. |
| `journal` | A project's journal, settings changes included, newest first. |

Settings. Each one returns `{ state, text }`, where `state` is:

- `applied` when it applies at once;
- `pending` when it waits for the owner's confirmation in the dashboard (FR-092), with the `id` of its
  card;
- `unchanged` when nothing would change.

| Tool | Widens (waits for a confirmation) when |
|---|---|
| `project_add { slug, checkout?, to? }` | always: agents act on the repo as its rules say |
| `project_create { id, title? }` | never: a project without a repo starts nothing by itself (FR-096) |
| `project_remove { project }` | never |
| `project_bypass { project, on }` | `on` is true |
| `host_profile { mode }` | `mode` is `bypass` |
| `merge_switch { armed }` | `armed` is true |
| `limits { maxWorkers?, maxRunMinutes? }` | either one goes up |
| `owner { login }` | always |
| `task_write { id, title, project, schedule?, lock?, cwd?, prompt }` | always: its card shows the task, or the diff of its file |
| `task_remove { id }` | never: the task stops, its file is kept as `<id>.md.removed` |
| `channel_add { type, target, urgency?, quietHours?, digestAt?, smtp?, from?, token? }` | always: data leaves to its target |
| `channel_remove { id }` | never |
| `remote { enabled }` | `enabled` is true: the dashboard answers on the tailnet |

These arrive with their phases, through the same module:

| Tool | Phase | Widens when |
|---|---|---|
| `machine_add { alias, os, caps?, workspace?, owner? }`, `machine_remove { name }` | 9 | add: always; remove: never |

A setting waiting for a confirmation is listed by `state`. Once the owner allows or declines it, the
journal says so, and the next call to `state` shows the outcome.
