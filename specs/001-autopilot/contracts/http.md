# Contract: dashboard HTTP API

The server listens on `127.0.0.1:<port>`. Every request's `Host` must be `127.0.0.1:<port>`,
`localhost:<port>` or the instance's tailnet name; a request on the tailnet name must carry
`Tailscale-User-Login` equal to the owner's Tailscale login (research R7). GET requests included. Every POST also needs the
dashboard's origin (local or `ts.net`) and the `x-rusuban: 1` header, and a body under 8 KB.

## Read

| Method | Path | Answer |
|---|---|---|
| GET | `/`, `/app.js`, `/app.css` | the page, no build |
| GET | `/api/state?project=<id>` | the project's model: nodes, edges, cards, runs, freshness, journal |
| GET | `/api/inbox` | open cards of every project, the settings waiting for a confirmation (`type: "setting"`, card id `setting:<id>`) and the desktops a run asks for (`type: "lease"`, card id `lease:<run>:<machine>`), newest first; both are answered allow or deny. With the rule proposals (`type: "rule"`, card id `rule:<id>`). Each card's `about` says where it waits (FR-099): `proposal`, `rule`, `lock` or `setting` in Rules & settings, none in Decisions. `rulesPrs` lists the open PRs that change `.rusuban/`: `{ project, item, title, url, author, draft, ci, updatedAt }` |
| GET | `/api/events` | SSE: `state`, `inbox`, `agents` (the project's runs and tasks, a task naming no project included, and the machines when the project has a repo) and `hub` (the project's conversations, the index's age), the project being the one the `state` names (FR-097) on each change, `: ping` every 15 s |
| GET | `/api/conversations?project=&item=&origin=&q=` | Conversation list, newest activity first, with the index's age and the titles of the items they name |
| GET | `/api/conversations/<id>?before=<offset>` | one page of a transcript: user text, assistant text, tool calls (name and short input), results cut to 2 KB; its `before` is the byte offset of the page before it, null at the start |
| GET | `/api/machines` | `{ checkedAt, error, machines }`: each machine of the registry with its last `probe` (its lease included) and its `queue` |
| GET | `/api/runs?project=` | runs, running first: kind, items, step, age, summary, conversation |
| GET | `/api/runs/<id>/log` | the run's log, as text: what its conversation did, until the hub shows transcripts |
| GET | `/api/tasks` | the task catalog and last runs |
| GET | `/api/tasks/<id>/file` | the task's file, as text |

## Write

| Method | Path | Body | Effect |
|---|---|---|---|
| POST | `/api/answer` | `{ project, item, card, option, note? }` | records the answer, starts the coordinator; refuses a replaced card. On a `setting:<id>` card, `option` is `allow` or `deny` (never a note): the owner's confirmation (FR-092). A `rule:<id>` card needs no `item`: the proposal stands for its own |
| POST | `/api/ask` | `{ project, text, item? }` | records a request, starts the coordinator |
| POST | `/api/automerge` | `{ armed }` | the global merge switch, stored in `automerge.json` |
| POST | `/api/refresh` | `{ project? }` | immediate GitHub read |
| POST | `/api/conversations/<id>/reply` | `{ text }` | a reply run: in place for a session Rusuban started whose run has ended, in a fork otherwise; answers `{ run, forked }` |
| POST | `/api/conversations/<id>/terminal` | | loopback only: opens the session in a terminal on the host |
| POST | `/api/runs/<id>/stop` | | stops a run, frees its leases |
| POST | `/api/machines/<machine>/release` | | frees a lease by hand |
| POST | `/api/tasks/<id>/run` | | starts a task now |
