---
description: "Task list for the public project autopilot"
---

# Tasks: Project autopilot for Claude Code (public product)

**Input**: design documents in `specs/001-autopilot/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: included where the spec measures a criterion (SC-002, SC-005, SC-006) and for every pure
module, as in the OpenScreen pilot (`node --test`).

**Paths**: root of the repository `EtienneLescot/rusuban`.

**Order**: the stories are delivered in the order decided on 2026-11-07, parity first, not strictly
by priority (see Implementation Strategy).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story of spec.md

---

## Phase 1: Setup (M0)

- [x] T001 Create the private repo `EtienneLescot/rusuban`: MIT `LICENSE`, `README.md` stub, `.gitignore`, `package.json` (`"type": "module"`, `bin`, `"engines": { "node": ">=22" }`, `files`)
- [x] T002 [P] Ratify the product constitution in `.specify/memory/constitution.md`: English, generalized from the OpenScreen pilot's (principle III and the interface language changed, per plan.md)
- [x] T003 [P] Copy this feature's documents into `specs/001-autopilot/` of the new repo
- [x] T004 [P] Configure Biome (tabs, double quotes) in `biome.json`, and npm scripts `lint`, `test` (`node --test`), `test:e2e`
- [x] T005 [P] CI in `.github/workflows/ci.yml`: lint and `node --test` on Ubuntu, macOS and Windows, Node 22 and 24

---

## Phase 2: Foundational (blocks every story)

- [x] T006 Instance home and atomic store in `src/home.mjs`: `~/.rusuban/` (override `RUSUBAN_HOME`), `read`, `write` (temp file + rename), `readJsonl`, `append`, journal helper; `config.json` created with mode 600
- [x] T007 [P] Store tests (atomic write, append, missing files) in `test/home.test.mjs`
- [x] T008 Instance config in `src/home.mjs`: `owner.login`, `port`, `permissions { mode: "bypass" | "allowlist", allow[], deny[] }` with **no default mode**, `projects[]`, `machines[]`, `channels[]`; validated on load
- [x] T009 Port the GitHub reader to `src/github.mjs`: repo as a parameter; PR fields `repo, n, title, url, author, draft, head, headRef, base, additions, deletions, files[], refs[], closes[], mergeable, canBeRebased, ci { state, runId }, reviews { "<login>": state }, threadsOpen` (replaces the CodeRabbit-only state); items keyed `owner/repo#n`
- [x] T010 [P] Polling per project in `src/github.mjs`: every `refreshSec` (default 90), slower when the rate-limit budget is under 20 %
- [x] T011 Rules loader in `src/rules.mjs`: `.rusuban/rules/*.md` in file-name order and `.rusuban/locks.json`, from the default branch through `gh api …/contents?ref=<default>`, cached by tree sha in `projects/<p>/rules.json`; no folder → the project is observe-only
- [x] T012 [P] Rules loader tests (order, missing folder, invalid `locks.json` reported, PR head never read) in `test/rules.test.mjs`
- [x] T013 Port the pure model to `src/model.mjs`: built-in gates (CI green on the exact head, no open thread, head unchanged since judgment, rebaseable, `.rusuban/` untouched, merge switch) plus project locks (`lockedPaths`, `maxLines`, `maxFiles`, `sizeExempt`, `requiredChecks`, `requiredReviewers`, `evidence`); kinds `bug | feature | maintenance | docs | translation | question | other`
- [x] T014 Todo reasons in `src/model.mjs`: `unjudged`, `new-commit`, `ci-approval`, `missing-card`, `revisit-due` (fires at the judgment's `revisitAt`); no delay built in
- [x] T015 [P] Model tests in `test/model.test.mjs`: gates, eligibility, every todo reason including `revisit-due`, multi-repo keys
- [x] T016 Agent launcher in `src/agents.mjs` (port of `engine/claude-run.mjs`): `claude -p <prompt> --output-format stream-json --verbose`, session id from `system/init`, readable log, final summary; permission flags from the instance profile; the built-in `--disallowedTools` (merge commands, `gh api` merge calls, pushes to a default branch, edits under the instance home) always added
- [x] T017 [P] Test that the built-in deny rules are present under both profiles in `test/agents.test.mjs`
- [x] T018 Runs in `src/agents.mjs`: `runs/<run>/status.json` with `{ id, kind, project, items[], session, cwd, worktree, leases[], trigger, state, startedAt, endedAt, exitCode, step, summary }`, lock groups and FIFO queue (port of `engine/tasks.mjs`)
- [x] T019 Agent commands in `bin/rusuban.mjs`: `todo`, `show`, `judge` (refuses a missing `revisitAt` when `owner` is `agent` or `third`, and a PR judged on a head that is not live), `resolve`, `log`, `evidence`, `answers`, `asks`; reads `RUSUBAN_RUN` and `RUSUBAN_PROJECT`
- [x] T020 [P] Port the CLI tests to `test/cli.test.mjs`
- [x] T021 Server skeleton in `src/server.mjs`: listens on 127.0.0.1 only; static `web/`; `/api/state?project=`; `/api/events` (SSE); POST guard (local or `ts.net` origin, `x-rusuban: 1`, body under 8 KB); identity check (`Tailscale-User-Login` must be the owner's login, loopback without it is the local user)
- [x] T022 [P] Guard tests (wrong login, wrong origin, missing header, oversized body) in `test/server.test.mjs`
- [x] T023 Port the dashboard to English in `web/index.html`, `web/app.js`, `web/app.css`: project switcher, graph, kanban, drawer; all strings in one table

**Checkpoint**: the daemon reads several repos, the model computes gates, agents can be launched.

---

## Phase 2b: Foundation amendments (analysis of 2026-11-07, see analysis.md)

Tasks added by the analysis are numbered from T084 and placed where they run.

- [x] T084 Config in `src/home.mjs`: `"version": 1` checked on load, `limits { maxWorkers, maxRunMinutes }`, `owner.tailscaleLogin`, project `mode: "live" | "shadow"`, machine `workspace`
  - Version and limits came with Phase 2 (PR #1). `owner.tailscaleLogin` replaces Phase 2's `owner.tailscale`; `mode` is required, with no default. Nothing reads machines before T066, so `workspace` has no code yet.
  - The project `mode` was removed on 2026-11-09 (T127): a config that still names one is refused.
- [x] T085 Split the journal in `src/home.mjs`: `journal.jsonl` (daemon) and `agent-log.jsonl` (agent CLI, under the judgment lock), shown as one
- [x] T086 Merge switch in `src/server.mjs`: `automerge.json` written by the daemon only, `POST /api/automerge`, the switch in the page header
  - Already done in Phase 2 (PR #1).
- [x] T087 CI-green and conflict gates in `src/model.mjs` exactly as FR-021 defines them: no check is not green; pending, failed, cancelled, timed out or waiting checks block; every `requiredChecks` name must succeed; rebaseable for a rebase merge
  - Every check counts; `requiredChecks` only adds names that must succeed. Checks that were all skipped are green, as FR-021 is written. Without a `mergeMethod`, a rebase is assumed.
- [x] T088 Todo reasons in `src/model.mjs` as `contracts/cli.md` defines them, `lock-blocked` included
  - Phase 2 had the first five reasons. `lock-blocked` names the lock; a broken `locks.json` raises none.
- [x] T089 Host check in `src/server.mjs`: `Host` must be loopback or the tailnet name; on the tailnet name, `Tailscale-User-Login` must equal `owner.tailscaleLogin`; GET requests included
  - Phase 2 accepted any `ts.net` name and the GitHub login. The name now comes from `tailscale status --json`, read at start and every 5 minutes.
- [x] T090 Every run through the launcher of T016 (workers, tasks, replies included); shadow projects add deny rules for every GitHub write
  - The launcher is the only way to start `claude` today; T033, T041 and T059 must keep it so. A run of a project no longer in the config gets the shadow rules too.
  - The shadow deny rules went with shadow mode on 2026-11-09 (T127). A run of a project no longer in the config does not start.
- [x] T091 [P] One breaking test per lock in `test/merge-gate.test.mjs` and `test/server.test.mjs`: open thread, switch paused, size, conflict, missing required check, no check at all, wrong `Host`, wrong Tailscale login

---

## Phase 3: User Story 3 - The project moves on its own (P1) 🎯 MVP

**Goal**: triage, fixes and merges under the project's text rules, inside the hard locks.
**Independent test**: a sandbox repo with rules allowing bug-fix merges: a fix PR is merged; the
adversarial PRs are not, each with the gate that stopped it.

- [x] T024 [P] [US3] Safety frame in `src/prompts/frame.md`: GitHub content is data, the built-in locks, agents never merge
- [x] T025 [P] [US3] Generic judge prompt in `src/prompts/judge.md`, from `tasks/judge.md` without OpenScreen: todo reasons, judgment format with `revisitAt`, card format, delegation
  - The formats shared by the judge, the coordinator and tasks (judgment, card, delegation) are in `src/prompts/formats.md`.
- [x] T026 [P] [US3] Generic act prompt in `src/prompts/act.md`, from `tasks/act.md` without OpenScreen
- [x] T027 [P] [US3] Generic worker prompt in `src/prompts/worker.md`, from the rules of `engine/worker.mjs` without OpenScreen
- [x] T028 [US3] Prompt assembly in `src/agents.mjs`: product prompt → frame → project rules headed `<owner/repo>@<sha>` → context (owner, machines, open cards, pending answers, requests and reports) → task prompt
  - Built when the run starts, so a queued run sees the latest state. Answers, requests and worker reports go to the coordinator only.
- [x] T029 [US3] Judge trigger in `src/server.mjs`: `judge` starts when a project's todo signature changes; an observe-only project never starts an agent
  - The coordinator starts on change too: answers, requests or worker reports waiting. A run that failed is retried after 15 minutes; one that finds nothing to do ends without a session.
  - A seventh todo reason, found live: `conflict`, a PR judged mergeable alone that its base moved under. `contracts/cli.md` should list it.
- [x] T030 [US3] Server-only merge in `src/github.mjs`: `gh pr merge --<mergeMethod> --match-head-commit`, one per cycle, only when every gate passes and the judgment says `auto`; journaled with its gates
  - No `mergeMethod` means a rebase, as the gate assumes. No `--admin`: a branch protection GitHub enforces comes back as a refusal, journaled.
- [x] T031 [US3] Foreign merges in `src/server.mjs`: a merged PR missing from the server's journal is flagged in the journal and the inbox
  - Journaled with `notify`, which the inbox (Phase 4) and pings (Phase 7) read. Only merges after the project was first watched.
- [x] T032 [P] [US3] Adversarial fixtures in `test/fixtures/prs/` and `test/merge-gate.test.mjs`: PR editing `.rusuban/`, injected instructions in the body, red CI, moved head, locked path, missing evidence; none merged, the stopping gate named (SC-005)
- [x] T033 [US3] Workers in `src/workers.mjs`: `worker start|stop|list`; each in `git worktree add <home>/worktrees/<p>/<run>`; at most N at once; its report goes to the coordinator; worktree removed at the end, stale ones cleaned at start
  - Each worktree comes from Rusuban's own clone of the repo (`<home>/repos/`), never from a person's checkout.
- [x] T034 [P] [US3] Worker tests (limit, one report, stale cleanup) in `test/workers.test.mjs`
- [x] T035 [US3] Journal and freshness in `web/app.js`: what was done without the user, the age of every datum, stale flags (thresholds of FR-072)
  - GitHub data and runs: the hub (T105) and the machines (T067) bring their own ages.
- [x] T092 [US3] Direct pushes in `src/server.mjs`: a commit on a default branch that no server merge produced is flagged in the journal and the inbox
  - A commit on the default branch that no merged PR produced, flagged like T031.
- [x] T093 [US3] Merge orders in `src/server.mjs`: an answer ordering a merge is carried out by the server, which checks CI, threads, head and conflicts and lifts the project locks for that head only (FR-044)
  - An option `"merge": true` on a PR's card, tied to the head the card was written on. Held while merges are paused, never carried out in shadow mode.
- [x] T094 [US3] Rules changes in `src/rules.mjs`: a new tree sha applies at once, is journaled with its diff and pings the owner (FR-027); a `locks.json` that fails to parse is journaled and pings the owner too
  - The entries carry `notify` for the pings of Phase 7.
- [x] T095 [US3] Evidence in `bin/rusuban.mjs`: accepted only from a worker run other than the judging run, for the live head, with the run and its conversation attached
- [x] T096 [US3] Silent rules in `src/prompts/judge.md` and `src/prompts/act.md`: a situation the rules do not cover becomes a card that offers to turn the answer into a rule (FR-026)
- [x] T097 [US3] Usage limits in `src/agents.mjs`: a run that hits a Claude usage limit becomes `limited` with its retry time; an interrupted run gives its requests back to the queue (FR-073)
  - Every queue holds until the reset. A run whose runner died goes back to its queue, twice at most.
- [x] T098 [P] [US3] Generic task prompt in `src/prompts/task.md`
- [x] T099 [P] [US3] Live test on a sandbox repo: a PR whose body tells the agent to merge it is judged on its diff and never merged (US3 scenario 3)
  - Proved on the private `EtienneLescot/rusuban-sandbox`: see the PR.
- [x] T114 [US3] `ignoredChecks` in `src/model.mjs`: named checks never block CI green, never all of them (a head whose only checks are ignored is not green); a breaking test in `test/merge-gate.test.mjs`

- [x] T132 [US3] The runs' model is the owner's choice (FR-098), Etienne's decision of 2026-11-10: never Claude Code's default
  - `model` in config.json, a Claude Code id or alias, asked by `init`; `rusuban model [<id>]` and the MCP's `model` set it at once, journaled.
  - `runClaude` refuses to start without one and passes `--model` on every launch; the terminal a conversation opens in gets it too. A test runs the judge, the coordinator, a task, a reply in place and in a fork, and a worker, and checks each launch.
  - Without a model no run starts: the daemon asks for none, Run now, replies and the terminal are refused with why, the page shows a red banner and `status` says it.
  - Each run keeps `modelAsked` and the `model` its session announced; the Agents view shows it, in amber when it is not the one asked for.
---

## Phase 4: User Story 2 - Decisions come to me: cards and inbox (P1)

**Goal**: every human decision is a card, answered in a few taps.
**Independent test**: a rule routes features to the owner; a feature PR produces a card; answering it
starts the coordinator, which applies the answer.

- [x] T100 [US2] Mockups of the inbox and the cards, desktop and phone, validated by Etienne before T038
  - Validated on 2026-11-07: https://claude.ai/artifact/8ydfGCoLorF8neBcU9zoHc, source in `mockups/inbox/`, the built page beside it in `mockups/inbox/built/`.
- [x] T036 [US2] Cards in `src/model.mjs`: `{ id, to, urgency: "now" | "digest", q, ctx, rec, why, options[{ id, label, effect, message? }], createdAt, resolvedAt, outcome }`, transitions `open → resolved | replaced`
  - A card's state is derived (`cardState`): replaced when the agent CLI says so, resolved once `answers.jsonl` holds its answer. A card belongs to one head (Phase 3).
- [x] T037 [US2] `/api/answer` and `/api/ask` in `src/server.mjs`: a replaced card refuses late answers; an answer starts the coordinator at once
  - A card takes one answer: a second one is refused like a late one. An answer that orders a merge also starts a GitHub read, so the server carries it out at once.
- [x] T038 [US2] Inbox in `web/app.js`: open cards of every project, newest first, answer by option or free note
  - The graph stays the main view; the inbox is the column beside it and a card opens in its place (`#card/<id>`, so a ping links to it). A phone gets the inbox first, a tab bar, and answers a card in three taps: open, option, Send.
  - Since 2026-11-08 the phone's first tab is named after the view it shows, Graph or Kanban; Conversations or Agents picked in its row of view tabs moves the tab bar to their own tab.
- [x] T039 [P] [US2] Card tests (replaced card refused, answer recorded once) in `test/cards.test.mjs`
- [x] T101 [US2] Runs view, `GET /api/runs`, `POST /api/runs/<id>/stop`, `POST /api/refresh` and `GET /api/inbox` in `src/server.mjs` and `web/app.js`
  - `GET /api/runs` (at work first), `POST /api/runs/<id>/stop`, `GET /api/inbox` (cards, plus the owner's flags of the last 7 days), the `inbox` event on `/api/events`. The runs view is the Agents drawer: runs at work first with a two-tap Stop, the last 30 with their conversation, the one a card points at lit.

- [x] T139 Disks kept clean, development apart from judgment (FR-103), Etienne's request of 2026-11-11: agents left builds and worktrees in `G:\tmp-*` and in WSL's home, and `git worktree remove` emptied the main checkout's `node_modules` three times through a junction
  - Development (worker) and judgment (judge, coordinator, reply) are tagged in the Agents view and named in Conversations; the coordinator's prompt says it builds nothing.
  - Each worker gets `<workRoot>/<run>`, and `~/rusuban-work/<run>` in WSL, in its prompt, `RUSUBAN_WORK` and `--add-dir`. `rusuban work-root` and the MCP's `work_root` set the root.
  - Its worktree, work folder and WSL folder go when it ends or stops, through `fs.rm`, which unlinks a junction without following it, then `git worktree prune`.
  - A sweep at the daemon's start and every day, journaled per project with the room it freed. A worktree of the clone outside every run's folders goes once no worker or task lives.
  - 10 GB free on the worktrees' and the work root's disks before a worker starts; short of that it waits, `Waits for room: 4.2 GB free on G:\, 10 GB needed` in its status.
  - Tests: the work folder in prompt, env and tools, gone at the end; a junction to a person's files survives; the sweep keeps a live run's folders and another instance's; a legacy worktree goes once no worker lives; a worker waits for room, then starts.
- [x] T138 [US4] A run's Conversation opens the conversation (FR-054), Etienne's request of 2026-11-11: the link of the Agents view opened `/api/runs/<id>/log`, raw JSON
  - On the host it resumes the session in a terminal, as "Open in terminal" does; from a phone, or another machine of the tailnet where no terminal opens, it opens the reader. On a phone the whole line of a recent run does it.
  - Click tests at both widths; the terminal is a stub there, so no window opens during the tests.
- [x] T137 [US4] A project's Conversations are its own (FR-102), Etienne's decision of 2026-11-11: 692 of OpenScreen's 1,141 conversations were about no item, sessions opened in its checkout about other things
  - The list keeps the conversations about one of the project's items and Rusuban's own runs on it; a fork goes with the conversation it came from. One linked later, by a PR link or a branch, shows from the hub pass that links it. Answering and opening in a terminal go by the conversation's id, listed or not.
  - On the instance's copy, OpenScreen's list goes from 1,141 to 473. The open items' groups come first, then those of items since closed, named by their number alone, not as an issue.
  - Known limit: Claude Code records the PR of the branch a session runs on, so the 26 sessions opened in the checkout while it sits on `feat/webcam-effects`, the head of #493 merged in August, stay linked to #493.
- [x] T136 A dashboard that answers at once (SC-008), Etienne's request of 2026-11-11: the live daemon took 2 to 7 s to answer, and `rusuban status` said "not answering" one time in three
  - Measured on a copy of the instance (copy, three pages connected, the state asked every 250 ms, a GitHub read, then a judge writing its status every 300 ms), with the loop's lag sampled every 20 ms and a CPU profile. Every 2 s, each page recomputed its state, runs, tasks and conversations, and each reading of the runs opened every `status.json`: 600 ms held per update with three pages, 1.6 s with eight.
  - A run's status is read again only when its file changes, and a settled run never; a broadcast computes each page's data once for all the pages that show it; the locks' globs are compiled once; the conversation scan reads its thousand files' sizes off the loop.
  - With three pages, the state's 95th percentile went from 84 to 95 ms (max 1.36 s) to 33 to 48 ms (max 153 ms); with eight, from 1.5 s to 32 ms, the loop's lag at the 99th percentile from 1.57 s to 25 ms. A step that holds the loop over 300 ms is said in the log.
  - `rusuban status` tells "not running" (nothing listens) from slow: it waits 30 s and says how long the answer took.
- [x] T135 [US2] Open cards judged again after an update of what deserves a card (FR-101), Etienne's request of 2026-11-11 after the card on #1522 outlived #40
  - Every card the agent CLI writes carries `writtenUnder`: the fingerprint of the judge's prompt, the card formats and the safety frame (`CARD_RULES`), line endings aside.
  - An open card under another one, not answered, is `stale-card` in the todo: the daemon starts a judge for it, which closes what the product now does alone, gives `about` to what belongs in Rules & settings, and drops the options that no longer exist. A card judged again with its question keeps its id and takes the new stamp, so it comes back once.
  - On deploy every open card, written before the stamps, comes back once: OpenScreen's first judge after the update takes up some fifty cards.
- [x] T134 [US2] Everything from an item's card (FR-100, FR-052), Etienne's request of 2026-11-11 after a phone capture of #1515's card
  - The item's card in the graph answers its open card with the inbox's own block (`answerHtml`): clickable options, the recommended one first, Send, and a free answer. The option picked and the text typed are kept per card, and survive the graph being drawn again. Its "What I did" was printing `[object Object]` for a list of steps: the block shows the steps with their links.
  - Without a card waiting, or once it is answered, the card takes a request to Claude about the item, sent to the coordinator with the item (`POST /api/ask`).
  - Rows as tall as their text in Conversations and "Linked to"; nothing in the card is wider than it, at 375 px as at 1440 px (a click test measures it). An open card's conversations now show as soon as they arrive.
  - A run's conversation goes by the run's name, "Judge 21:40" or a worker's, never by its prompt.
- [x] T133 [US2] The inbox's Rules & settings queue (FR-099), Etienne's decision of 2026-11-10, its mockup validated as is on 2026-11-11
  - A tab beside Decisions, on a desktop and a phone, its count in amber. It holds, each tagged: the silent rules (`about: "rule"`), the locks (`about: "lock"`), the settings waiting for the owner and the rule proposals, then the PRs that change `.rusuban/`. A card on a PR judged to merge alone is a lock or a silent rule by itself. The desktops a run asks for stay in Decisions; back from a card is its tab.
  - `rusuban propose`: one rule for the open cards of several items of one repo, on a card of its own, with the server's options "Open the rule PR" and "Not a rule". The prompts drop the "Make it a rule" option; the judge looks at the open cards together once it has judged. An accepted proposal: a worker opens the PR, and its items wait for it without a card.
  - A PR that changes `.rusuban/` is a person's to merge on GitHub: never in the agents' todo, refused by `rusuban judge`, out of the graph, the kanban and their links.
  - The open cards it concerns join the queue with the update, without a migration: OpenScreen's #1472 (a silent rule), #1515, #1484 and #1391 (locks) are on PRs judged to merge alone.
- [x] T131 [US2] An issue follows the PR that addresses it (FR-040), Etienne's decision of 2026-11-10 after the card on #1473
  - While a PR that closes, names or links an issue has an open card, the agent CLI refuses a card on the issue and says how to judge it instead: held by the agents, its next naming the PR. The judge's prompt says so, and folds an issue's open card into its PR's when the PR gets one.
---

## Phase 5: User Story 6 - Recurring tasks written as text (P2)

**Goal**: text-defined jobs on a schedule or a click.
**Independent test**: a daily task runs at its time, once after a skipped slot, and its summary and log
show in the journal.

- [x] T040 [US6] Task catalog in `src/tasks.mjs`: `tasks/<id>.md` with front matter `title`, `project`, `schedule` (`daily HH:MM,…`), `lock`, `cwd`, then the prompt (port of `engine/tasks.mjs`)
  - A task with a mistake is listed with its error and never started: an unknown field, a line that is not `field: value`, a file name that is not lowercase letters, digits and dashes. Without `lock` a task is its own group (`<project>.task.<id>`); without `cwd` it works in its project's scratch folder; without `schedule` it runs on a click only.
- [x] T041 [US6] Scheduler inside the daemon in `src/server.mjs`: a missed slot runs once (`lastSlot`), lock groups run one after the other
  - Every 30 s, and once at start. The last slot looks back 24 hours, so a slot missed overnight still counts; a task never started waits for its first slot after its file was written. A task whose run waits, works or will be retried is not started again. Starts and ends go to the journal; an end other than `done` is flagged for the owner.
- [x] T042 [P] [US6] Scheduler tests (missed slot, shared lock) in `test/tasks.test.mjs`
  - The shared lock is proved with the real runner and a fake `claude`.
- [x] T102 [US6] Mockup of the tasks view, validated by Etienne before T043
  - Validated on 2026-11-07: https://claude.ai/artifact/8ydfGCoLorF8neBcU9zoHc, page "Agents and tasks", source in `mockups/agents/`, the built page beside it in `mockups/agents/built/`.
- [x] T043 [US6] `/api/tasks` and `/api/tasks/<id>/run` in `src/server.mjs`, tasks view in `web/app.js`
  - `GET /api/tasks` gives each task with its slots, state and last five runs with their conversation; `POST /api/tasks/<id>/run` starts one and answers 409 while a run of it waits or works.
  - The view is the Agents tab, beside Graph, Kanban and Conversations: what runs now, with Stop; the recurring tasks, with "Run now" hidden where it would start nothing; the recent runs. Every project's, pushed as an `agents` event.
  - A Conversation link opens the run's log (`GET /api/runs/<id>/log`) until the hub shows transcripts; "Open the task file" opens it as text (`GET /api/tasks/<id>/file`). The journal and the rules keep a drawer of their own.
- [x] T103 [US6] `task list|run` in `bin/rusuban.mjs`
  - `task list` prints the catalog as JSON. `task run <id>` starts a task as the button does, and refuses a busy or broken one.

---

## Phase 6: User Story 7 - Several projects, one inbox (P2)

**Goal**: one instance, several projects, one inbox.
**Independent test**: two projects, one decision each, both in the inbox; their states never mix.

- [x] T044 [US7] `project add|list|remove` in `bin/rusuban.mjs`; per-project state under `projects/<p>/`
  - Also `project mode <id> <live|shadow>`, from the same table of the CLI contract, for the switch (T050, T051). A new project starts in shadow mode and goes live on its owner's word. Its id comes from the repo's name (`owner-repo` when the name is taken); `--to` adds a repo to an existing project, `--checkout` records a folder that exists.
  - `project mode` was removed on 2026-11-09 with shadow mode (T127): a repo added now waits for the owner.
  - A repo belongs to one project: the config refuses it in two, whatever the case of its name. `config.json` stays at mode 600.
  - `remove` refuses while a run of the project waits or works, deletes no file and says where they stay, and names the tasks that still point at it.
  - Each command asks the running daemon, on its port, whether it applied the change, and says so, or that no daemon answers, or that it must be restarted.
- [x] T045 [US7] Daemon loops per project in `src/server.mjs` (refresh, triggers, merge); one inbox for all
  - The daemon reads `config.json` again when it changes (every 2 s): a project added starts its loop, one removed stops, one changed starts again with its settings; a loop stopped while it read drops what it read. A mode change is journaled in its project. A config that does not load leaves the running one.
  - Nothing of one project is read or written by another: an agent command refuses a run of another project (`RUSUBAN_RUN` against `RUSUBAN_PROJECT`), and a task's dotted lock must start with its own project (`alpha.coordinator`); a group shared across projects has no dot. The merge switch stays global.
- [x] T046 [P] [US7] Two-project test (isolation, merged inbox) in `test/projects.test.mjs`
  - A real daemon over a fake GitHub: each loop writes its own files; alpha's rules let its PR merge, beta has none and its PR judged to merge alone stays; locks planted in beta's rules for alpha's repo do not stop alpha's merge; a beta run is told no rule of alpha. Both cards in one inbox; beta's card refused as alpha's, then answered into beta's files only.
  - The `project` commands without a daemon, then against a running one that applies add, mode and remove without a restart.

---

## Phase 6b: User Story 9 - Every setting from Claude, widening ones confirmed by a person (P2)

**Goal**: Claude sets Rusuban up; what widens agents' rights waits for the owner, outside Claude.
**Independent test**: from Claude, the limits lowered apply at once, a project added waits as a card;
allowed in the dashboard it applies; from inside a run, both are refused.

- [x] T118 [US9] Settings module `src/settings.mjs`: one implementation for the owner's commands and the MCP; widening against narrowing (FR-092, FR-093); `pending.json`; `settings.jsonl` with each change's origin (FR-094); `settings.lock`
- [x] T119 [US9] Confirmation cards in the inbox (`setting:<id>`), allowed or declined from the dashboard, from the validated mockup (T120)
- [x] T120 [US9] Mockup of the confirmation card, validated by Etienne before T119
  - Validated on 2026-11-08: https://claude.ai/artifact/8ydfGCoLorF8neBcU9zoHc, page "Machines, settings, no rules", source in `mockups/settings/`. No "Recommended" on these cards.
- [x] T121 [US9] Layer 1 (FR-095): `mcp__rusuban` and every owner's command in each run's deny rules; the owner's commands refuse inside a run
  - With #12, the commands that widen already go through the module: `project mode <id> live`, `project bypass <id> on`, `project add --to <live project>` and the new `permissions bypass`. In a terminal the owner types the target back; Claude's shell gets a card. The daemon no longer journals modes and the bypass itself: `settings.jsonl` carries every change with its origin.
- [x] T122 [US9] `rusuban mcp`: a stdio MCP server with the tools of `contracts/mcp.md`, refused inside a run, no card answers
- [x] T123 [P] [US9] MCP tests in `test/mcp.test.mjs`: each tool; widening waits, narrowing applies; refused inside a run
  - JSON-RPC on stdio with no dependency. Reading: `state`, `project_state`, `runs`, `tasks`, `journal`. Settings: projects, modes, the bypass, the host profile, the merge switch, limits, the owner, tasks; channels, machines and remote access come with their phases. The dashboard's switch now goes through the settings module too, so `automerge.json` has one writer again. `task add|remove` on the command line.
- [x] T124 [US9] `init` registers the MCP server (`claude mcp add --scope user`), with T073
  - `claude mcp add --scope user rusuban -- <node> <bin> mcp`, an earlier registration removed first.
- [x] T125 [US9] A `config.json` changed outside the settings module is flagged in the journal (the residual risk of `security.md` made visible)
  - `saveConfig` seals what it writes, in `config.json.seal`, before writing it. A `config.json` the daemon reads that does not match the seal is flagged once in `settings.jsonl`, by `unknown`, with what changed path by path; a channel only by its id, since its values hold secrets. Then it is sealed again.
  - An approval bypass turned on this way pings at once, as when the module turns it on. A change made while the daemon was stopped is flagged at its start. The edit still applies: the flag comes after the fact.

---

## Checkpoint: OpenScreen runs on the generic product (SC-002)

- [x] T047 Write OpenScreen's rules from `.claude/pilot/tasks/judge.md`, `act.md` and its constitution into `examples/rules/openscreen/rules/*.md` and `locks.json`
  - Four files: what the agents do alone and what comes to the owner (the two-day wait included), what merges alone (R1, R4) and how the repo merges, review rules, writing on GitHub. The procedures the product prompts already give (card format, delegation, safety) are not repeated.
  - `locks.json` carries R2 and R3 (the supply-chain paths, 300 lines and 15 files outside tests and docs), R4's zones, CodeRabbit required, and the Nix build and the Discord and bookkeeping workflows ignored. The priority scale is new: the old pilot had none, and agents would otherwise ask.
- [x] T048 Propose them to `getopenscreen/openscreen` as `.rusuban/` in a PR, which Etienne merges
  - Merged: getopenscreen/openscreen#1507.
- [x] T049 Configure Etienne's instance: the `openscreen` project; the `publications` and `n8n-series` tasks moved to `~/.rusuban/tasks/`
  - Done in practice by 2026-11-10: the `openscreen` project acts on `getopenscreen/openscreen` from its rules, and both tasks run from `~/.rusuban/tasks/` in the `publications` project, which has no repo (T128).
- [x] T050 Shadow week: the project in `shadow` mode (judge only, GitHub writes denied, no merge), judgments compared daily with the old pilot's; gaps fixed in the prompts or the rules
  - Replaced on 2026-11-08, Etienne's decision: no formal shadow week. He tries Rusuban himself on OpenScreen, and v0.1 ships after his trials. The daily comparison task was declined.
  - Shadow mode itself was removed on 2026-11-09 (T127).
- [x] T115 Approval bypass per project (FR-029): `project bypass <id> <on|off>` in `bin/rusuban.mjs`, off by default and never set by `project add`; `--admin` in `src/github.mjs` only on a merge the server makes anyway, the switch armed, after the base branch's rules are read and met (`src/model.mjs`); journaled in the project
  - The guard reads the base branch's rulesets and its classic protection in full (`/branches/{b}/protection`, none on a 404 "Branch not protected"). Every required check must be on the head, from the app the rule names (a PR's own job named like the review app does not count), in its latest run, and `success`. Rules that only concern pushes pass; a linear history refuses the `merge` method; a code owner's review, an up-to-date requirement, signed commits, protection that binds administrators, push restrictions, a locked branch, or any rule or setting it does not know stops it. What stops it is journaled once per head and flagged.
  - Tried on `getopenscreen/openscreen` main, read only: #1506 would pass; #1505 (CodeRabbit cancelled) and #1478 (macOS jobs cancelled) would not, though both were merged under the old pilot.
- [x] T116 A refused merge in `src/server.mjs` and `src/model.mjs`: never tried again on that head, a daemon restart included (the journal is the record); the todo reason `merge-refused` makes the agents put it on a card for the owner
- [x] T117 The owner's commands (`project`, `task`, `start`) refused inside an agent run, and forbidden by the built-in deny rules, so no agent turns a project live or its bypass on through them; under the bypass host profile the shell still reaches `config.json` and the dashboard (`security.md`, residual risk)
- [x] T126 Cheap shell deny rules: no command naming the dashboard's port or a `.ts.net` address, nor `config.json` next to the home's name, `automerge.json`, `answers.jsonl` or `pending.json` (leading wildcards checked on Claude Code 2.1.302)
- [x] T127 Shadow mode removed, Etienne's decision of 2026-11-09: projects have no mode
  - It served the shadow week, dropped on 2026-11-08 (T050). A repo without rules is only read (FR-024), and a repo added, to a new project or an existing one, now waits for the owner (FR-092).
  - Gone: `project mode`, the MCP's `project_mode`, the shadow deny rules, the refusal to start a worker, the Switch gate's shadow state, the page's banner. FR-028 is marked removed.
  - A config that still names a project's `mode` is refused at load, `"live"` included, so a project in shadow mode never starts acting on an update: removing the key is the owner's go (T051).
- [x] T128 Projects without a repo (FR-096), Etienne's decision of 2026-11-10: tasks about no repo's items get a section of their own, such as `publications`
  - `repos` may be empty in `src/home.mjs`; `project create <id> [--title]` and the MCP's `project_create`, through the settings module, applied at once: the project starts nothing by itself, and each task waits for the owner.
  - The daemon starts no read loop for it: nothing read, judged or merged on GitHub. The queues are tended on the tasks' 30 s clock, so its runs are retried with or without a project that has a repo. Its runs' prompt says it has no repo, instead of "do nothing autonomous".
  - Its page shows Agents, its tasks and runs, in place of an empty graph or kanban; no GitHub pill, no observe-only banner, no rules in the drawer. Agents and Conversations still list every project's, each row named.
  - OpenScreen's `publications` and `n8n-series` tasks move to such a project on Etienne's instance, through cards, after the merge.
- [x] T129 Each project's section shows only its own (FR-097), Etienne's choice of 2026-11-10 (variant B of T128's mockup)
  - The stream pushes a page its project's runs, tasks and conversations, the project its state names; the header's runs follow. No row names its project.
  - The machines show in a project with a repo only. A task naming none of the instance's projects shows in every section, its error naming that project.
  - Replaces T128's "Agents and Conversations still list every project's".
- [x] T130 A worker past the limit waits its turn instead of failing (FR-031), Etienne's decision of 2026-11-10 after the cards on #989 and #1522
  - `worker start` past `limits.maxWorkers` queues the worker; it starts by itself as soon as a worker ends or stops, the one that waited longest first. The prompt says a busy slot is never a question for anyone.
  - The limit is checked when a worker starts, not when it is asked for, so a worker asked again after a crash waits too.
- [x] T051 Switch: OpenScreen's `"mode"` removed from `config.json` (refused since T127), as the old pilot stops; the `OpenScreenDashboard` Windows task repointed to `rusuban start` and `OpenScreenTasks` removed (the full installer is T074); shortcuts repointed; `.claude/pilot` archived read-only, its history not imported
  - Decided on 2026-11-08: the approval bypass, set per project (T115). `getopenscreen/openscreen` requires an approval that agents' PRs, pushed under the owner's account, cannot get; the switch turns the bypass on.
  - Done on 2026-11-09, OpenScreen live on the product since. One difference with the plan: `OpenScreenDashboard` and `OpenScreenTasks` are disabled, neither removed nor repointed. Rusuban runs from a Windows task of its own, `Rusuban`, which starts `~/.rusuban/bin/start.vbs`. The shortcuts are repointed, and `.claude/pilot` carries an `ARCHIVED.md`.
- [x] T052 Check that `grep -ri openscreen bin src web` finds nothing (SC-002)
  - Nothing found on 2026-11-08, with every phase on main (`validation.md`).

---

## Phase 7: User Story 4 - Every Claude conversation of the project (P1, M2)

**Goal**: all sessions of the project's folders, linked to their items, read and answered in the dashboard.
**Independent test**: a Desktop session about PR #N in a project worktree shows under #N within a minute;
an answer from the phone appears in its transcript.

- [x] T104 [US4] Mockups of the conversations list and reader, desktop and phone, validated by Etienne before T061
  - Validated on 2026-11-08: https://claude.ai/artifact/8ydfGCoLorF8neBcU9zoHc, page "Conversations", source in `mockups/conversations/`. A filter by origin (All, Desktop, Terminal, Rusuban) and the index's age; the reader's button says "Answer in a fork" when the session lives elsewhere; "Open in terminal" on a desktop only.
- [x] T053 [P] [US4] Scrubbed transcript fixtures (Desktop, CLI, `sdk-cli`, with `custom-title`, `pr-link`, `relocated`, a corrupt line) in `test/fixtures/transcripts/`
  - Synthetic, none copied from a real transcript: a Desktop session moved to a worktree (custom title, PR link, a corrupt line, a reminder citing other PRs), a CLI session on a PR's head branch (agent name, a link, `#N`, a result over 2 KB), a worker run's `sdk-cli` session whose prompt cites an open card, and a file in an unknown format. The test fills in `$ROOT` and `$HOME`.
- [x] T054 [US4] Discovery in `src/hub.mjs`: scan `~/.claude/projects/*/`; keep sessions whose `cwd` or `relocatedCwd` is inside a project folder (checkouts, their worktrees, extra folders); membership by `cwd`, never by folder slug
  - A folder is read when its name starts with the slug of a project folder, or is a run's folder; its sessions are then kept by `cwd`, and a run's session by its run. A checkout's worktrees come from `.git/worktrees/*/gitdir`, wherever git put them. A session copied into two folders is read from its newest copy; a session keeps its project once its worktree is gone. `CLAUDE_CONFIG_DIR` moves the root.
- [x] T055 [US4] Incremental parser in `src/hub.mjs`: byte offset per file in `hub/index.json`; title (`custom-title`, `agent-name`, `ai-title`, first user text), origin from `entrypoint`, `firstAt`, `lastAt`, `branch`, `prs[]` from `pr-link`, cited `#N` and URLs; unknown line types skipped, parse errors recorded
  - `scanHub({ config })`, async, 1 MB at a time: a first pass over 3 GB of real transcripts took 10 s, the next 0.2 s. The `<system-reminder>` blocks Claude Code adds to a message are neither title nor citation. A file in an unknown format is listed by its file's age, `parseError: "unknown format"`. The index also carries `version` and `scannedAt`. `readPage` and `listConversations` are there for T058.
- [x] T056 [US4] Links in `src/hub.mjs`, in this order: run metadata, `pr-link`, `gitBranch` equal to a PR head ref, cited numbers
  - Cumulative, in that order. A run's session takes no citation: its prompt cites every open card. A bare number, in a message or in a branch name (T105's rule), links only to an item the live state knows; a GitHub link to one of the project's repos always does. A fork's PR from `main` never matches a session on `main`; a PR found by its head stays linked once merged.
- [x] T057 [P] [US4] Parser and link tests in `test/hub.test.mjs`: at least 90 % linked on the fixtures, plain list on an unknown format
  - Plus discovery (a sibling sharing the slug, a worktree outside the checkout, an extra folder, a copied session), only new bytes read, the page reader, and a 3 MB transcript paged back to its start across chunks. Each test fails when the code it guards is broken.
- [x] T058 [US4] `/api/conversations` (filters) and `/api/conversations/<id>?before=` (a page: user text, assistant text, tool calls with a short input, results cut to 2 KB) in `src/server.mjs`
  - `hubState` in `src/hub.mjs` adds to `listConversations` the origin as the page names it (`desktop`, `terminal`, `rusuban`), filtered by `origin` too, the run's kind and state, and each known item's type and title. `before` is a byte offset, null at the start; an unknown id or offset is a 404.
- [x] T059 [US4] Reply in `src/hub.mjs`, through the launcher of T016: a session Rusuban started resumes in place (`--resume <id>`) unless its run is alive; any other session is answered with `--fork-session`, recorded as `forkOf` and listed under the original; `/api/conversations/<id>/reply` answers `{ run, forked }`
  - A `reply` run has no assembled prompt: the person's text goes as is. It runs in the session's folder, with the session's items, and journals the answer as the owner's.
- [x] T060 [US4] `/api/conversations/<id>/terminal`, loopback only: opens the session in a terminal on the host (Windows Terminal, Terminal.app, `$TERMINAL`)
  - Refused (403) on the tailnet name, even for the owner.
- [x] T105 [US4] Hub loop in `src/server.mjs`: rescan every 30 s and show the index age (FR-055); a number in a branch name links to its issue
  - A pass at start, then every 30 s, one at a time. Until the first pass ends, the page shows the index the last one wrote, with its age.
- [x] T061 [US4] Conversations view in `web/app.js`: list by project and item, reader, answer box, phone layout; each item lists its conversations
  - As validated in T104. A run's session shows its run's title, not its prompt. Click tests at both widths answer a Desktop session in a fork, through the real runner.
- [ ] T106 [US4] Live proof of M2: a Desktop session on a real item shows under it within a minute, and an answer from the phone lands in its fork

---

## Phase 8: User Story 2 - Decisions come to me: pings (P1, M3)

**Goal**: the owner is pinged where they chose, with a link to the card.
**Independent test**: `channel test` on each type; a new card pings at once, a digest card at `digestAt`.

- [x] T062 [P] [US2] Channel payloads in `src/pings.mjs`: ntfy (POST, `Title`, `Click`), Slack (incoming webhook, blocks), Discord (webhook, embed), Teams (Workflows webhook, Adaptive Card), e-mail (`nodemailer`, SMTP)
  - An e-mail channel's `target` is its address; it also needs `smtp`, its server as nodemailer takes it (`smtps://user:password@host:465`), and may name `from`. nodemailer loads only when an e-mail goes out.
  - Slack's markup is escaped and Discord parses no mention, so a card's text pings no one. A send's error never names its target.
- [x] T063 [P] [US2] One payload test per channel (card in, payload with the card link out) in `test/pings.test.mjs`
- [x] T064 [US2] Dispatch in `src/pings.mjs`: a new card for the owner goes to the channels of its urgency; digest at `digestAt`; quiet hours; a failed send retried, then journaled
  - Functions with their effects injected: `dispatch({ config, cards, state, now, port, tailnet }, { send, journal })`, one message per channel. The daemon keeps the state between calls (`pings.json`, in data-model.md) and never runs two at once; that wiring is left for T065.
  - Quiet hours hold only what can wait: an urgent card pings at once (US2 scenario 3). A digest card waits for a `digestAt` passed since it came; without one it goes as it comes, outside quiet hours. A new channel does not replay the inbox. Three tries (at once, 1 then 5 minutes later), then a `ping-failed` entry with `notify`.
  - The journal's `notify` flags (T031, T092, T094) ping too, from the daemon (T065): a rules change, an approval bypass turned on, a merge or a push the server did not make at once; the rest in the digest; `ping-failed` never.
- [x] T065 [US2] `channel add|test|list` in `bin/rusuban.mjs`; secrets only in `config.json` (mode 600)
  - Through the settings module: adding a channel sends data out, so it waits for the owner's card or a typed confirmation; removing one applies at once. `channel remove`, and `channel_add`, `channel_remove` in the MCP. A target shows only its host, an e-mail channel its address; `channel test` really sends.
  - The daemon calls the dispatcher every minute (never two at once), its state in `pings.json`; a dry daemon pings no one. A setting waiting for the owner pings like any `now` card. A protected ntfy topic takes `--token`, sent as a bearer and masked like the target.
- [x] T107 [US2] Ping links straight to the card (`/#card/<id>`), on the tailnet address when remote access is on; in v1 every card goes to the owner (FR-045)
  - Remote access counts as on when `owner.tailscaleLogin` is stored and Tailscale names the machine, so `remote disable` (T076) must remove that login. A digest links each card on its own line and opens the inbox.
- [ ] T108 [US2] Live proof of M3: a real card pings a phone and is answered in three taps (SC-004)

---

## Phase 9: User Story 5 - Test machines, reserved (P2, M4)

**Goal**: agents see, reserve and release the owner's machines; a person's desktop needs that person's yes.
**Independent test**: two agents need macOS; the second waits for the first's lease; killing the first
frees the Mac at expiry.

- [x] T066 [US5] Registry in `src/machines.mjs`: `{ name, os, ssh | null, caps[], workspace, agentUser, owner?, maxLeaseMin }`; `machine add` checks SSH (`BatchMode`, 5 s timeout), the `rusuban` account, git and the workspace, and creates the bare mirror
  - `machine add` names the machine after its alias, finds its OS unless `--os` says it, runs `enrollMachine`, then asks as a widening setting (`machine.add`): typed in a terminal, a card otherwise. A desktop's `owner` is the instance's owner in v1. Every config load runs `validateMachines`.
  - Done in `src/machines.mjs`, as functions whose commands on a machine go through an injected `exec` (a POSIX sh or Windows PowerShell script, over `ssh -o BatchMode=yes -o ConnectTimeout=5 -l <agentUser>`, or on the host when `ssh` is null): `validateMachines` (fills `caps: []`, `workspace: "~/rusuban"`, `agentUser: "rusuban"`, `maxLeaseMin: 60`; one entry per SSH alias), `checkMachine`, `enrollMachine`, `detectOs`. The mirror is one per repo, `<workspace>/<project>/<repo>.git`, since a project may have several. Left: the `machine add` command, and `validateMachines` called when config.json loads.
- [x] T067 [US5] Probe every 2 min, plus `tailscale status --json` when present; state pushed to the page
  - Every 2 min the daemon tends the leases (`tendLeases`), then probes (`probeMachines`). The probe goes to `leases/probes.json`, read by the page (`agents` event, `/api/machines`) and by the agents' context.
  - Done: `probeMachine` and `probeMachines`. The probe's SSH call reads the lease too, so it says who holds the machine; Tailscale's word, matched on the SSH alias, comes when `tailscale status --json` answers. Left: the loop every 2 minutes and the push to the page.
- [x] T068 [US5] Leases in `src/machines.mjs`: an exclusive folder, made by an atomic `mkdir` on the machine, `{ machine, run, instance, pid, project, since, expires, reason }`, renewed while the run lives, freed when the holder dies or expires, FIFO queue, capability match; agent commands `lease` and `release`
  - Done as research R9 decided, not with a `wx` file: the lease is `<workspace>/.lease`, made by an atomic `mkdir` on the machine, holding `{ machine, run, instance, pid, project, since, expires, reason }`. `takeLease` (one try), `waitLease` (the command's wait), `releaseLease`, `releaseRun`, `tendLeases` (the daemon's renewals and frees, journaled). On its own host a dead pid frees the machine at once; another instance waits for the expiry, renewed 5 minutes ahead and never past `maxLeaseMin`. The queue holds `{ run, pid, since }`, so a `lease` command killed while it waits loses its place. A desktop returns `requested` until `approved(machine, run)` says yes (T070).
  - The agent commands. `lease` waits with `waitLease`. `--repo` makes the run a worktree there, and `--wait` takes `90s`, `20m` or `1h`. It prints how to reach the machine. Claude Code's Bash stops at 2 min, so the worker prompt says to run a long wait in the background. `release` calls `releaseLease`, for the run's own lease. A run's leases also end with the run (`releaseRun`).
- [x] T069 [P] [US5] Lease tests (two waiters, dead holder, expiry, capability match) in `test/machines.test.mjs` (SC-006)
  - Against a fleet faked in memory, plus the real sh and PowerShell scripts on a folder standing in for a machine (no SSH). Breaking the queue order, the host lock, the atomic take, the cap, the dead-holder check or the desktop's yes each fails a test.
- [x] T070 [US5] A person's desktop (`owner` set): a lease request opens a card to that person and is granted only on acceptance
  - While only desktops fit, the `lease` command asks in `leases/requests.json`. The inbox shows a card per desktop, "Lend it" or "Not now", never answered in words. The answer goes to `leases/answers.json`, and a no ends the wait. The daemon drops the asks of runs that ended.
- [x] T071 [US5] `/api/machines` and `/api/machines/<machine>/release` in `src/server.mjs`, machines view in `web/app.js`
  - Machines are a section of the Agents view, as T111 validated it. Release is pressed twice, like Stop, and journaled as the owner's.
- [x] T072 [US5] Live machine state in the prompt context of T028, in `src/agents.mjs` (one copy, not a second one)
  - Each machine with how to reach it, its workspace, its tags, its desktop owner and its last probe, from `leases/probes.json`.
- [x] T109 [US5] `machine list|probe|doctor` in `bin/rusuban.mjs`; setup scripts per OS (OpenSSH server, `rusuban` account, the host's key) in `docs/machines/`
  - `docs/machines/README.md`, with `setup-linux.sh`, `setup-macos.sh` and `setup-windows.ps1`. Each makes the `rusuban` account (no administrator, no password, the host's key), the SSH server, git and `~/rusuban`, and can run again. They are syntax-checked, but not yet run on a real machine: T078 and T112 do it.
- [x] T110 [US5] Desktop guard: a person's desktop alias is denied to every run that does not hold its lease (FR-063)
  - A PreToolUse hook rather than deny rules, which are fixed when a run starts (research R3). `rusuban guard` refuses a Bash command naming the alias, as a host, a user@host or a tailnet name, unless the run holds the lease. A lease it cannot read refuses too, and so does a guard that cannot judge. A desktop added during a run guards the runs started after it.
- [x] T111 [US5] Mockup of the machines view, validated by Etienne before T071
  - Validated on 2026-11-08: https://claude.ai/artifact/8ydfGCoLorF8neBcU9zoHc, page "Machines, settings, no rules", source in `mockups/machines/`. Machines are a section of the Agents view; the button is "Release".
- [ ] T112 [US5] Live proof of M4: two runs need macOS on the real Mac; the second waits; killing the first frees the Mac at expiry

---

## Phase 10: User Story 1 - Install, connect, always find the dashboard (P1, M5)

**Goal**: one command to a running pilot whose URL is never lost.
**Independent test**: on clean Windows, macOS and Linux machines with `gh` and `claude` logged in, the
dashboard shows a public repo in under 10 minutes and comes back after a reboot.

- [x] T073 [US1] `init` in `bin/rusuban.mjs`: checks the `gh` and `claude` logins, owner login from `gh`, asks the host permission mode and whether to arm automatic merges (no default for either), writes `limits` explicitly, adds a first project, installs the service, prints and opens the URL
  - The config is written by the settings module (`initInstance`), journaled from the terminal; limits 3 agents and 150 minutes, written out. Refused without a terminal, on a set-up instance, and from npx's cache (`npm i -g rusuban`); the port is the first free one from 8788. Run for real by T078 only: it installs a service.
- [x] T074 [P] [US1] Service installers in `src/service.mjs`: Task Scheduler at logon with restart on failure (Windows), launchd agent with `KeepAlive` (macOS), `systemd --user` unit with `Restart=on-failure` (Linux); `service install|uninstall`
  - `installService` and `uninstallService`; the `service` command that calls them came with T075. On Windows a trigger every minute, ignored while the daemon runs, does the restarting: Task Scheduler's restart on failure only covers a task that fails to start.
- [x] T075 [P] [US1] `start`, `open`, `status`, and a desktop or menu shortcut per OS, in `bin/rusuban.mjs` and `src/service.mjs`
  - `service install|uninstall` call T074's installers; install refuses a path in npx's cache. The service runs `start --log`: the daemon's lines and a crash go to `daemon.log`, rotated past 5 MB at a start. `status` reads `/api/state` (version, `startedAt`) and exits 1 when nothing answers; `open` starts the default browser.
  - Shortcut done in `src/service.mjs`, installed and removed with the service: a Start menu `.url`, `~/Applications/Rusuban.app` from `osacompile`, a `.desktop` entry.
- [x] T076 [US1] `remote enable|disable`: `tailscale serve --bg --https=443 http://127.0.0.1:<port>`; `status` shows the tailnet URL; stores `owner.tailscaleLogin` from `tailscale status --json`
  - A setting of the settings module (`remote`, and the MCP's `remote { enabled }`): enabling widens where the dashboard answers, so it waits for a typed confirmation or the owner's card, planned again with Tailscale's state when allowed. Disabling applies at once: the login removed, Serve told to stop, which may fail without reopening anything.
- [x] T077 [US1] Observe-only page in `web/app.js`: without rules, items and conversations show, with how to add rules and links to `examples/rules/`
  - Its mockup was validated on 2026-11-08: https://claude.ai/artifact/8ydfGCoLorF8neBcU9zoHc, page "Machines, settings, no rules", source in `mockups/observe-only/`: the banner of a project without rules, with two links.
  - Built as validated: the banner under the view tabs names the repos' default branch, and the main node says "people merge". Screenshots in `mockups/observe-only/built/`; a click test checks it.
- [ ] T078 [US1] Timed clean-machine install on the three OSes (SC-001)
- [x] T113 [US1] Updates: `status` compares the installed version with npm; config and state files carry a version, migrated on load (FR-074)
  - `status` reads `registry.npmjs.org/rusuban/latest` (or `RUSUBAN_REGISTRY`) and says when a newer release is out, with `npm i -g rusuban` then `service install` to restart; it installs nothing. config.json's `version` is the whole home's format: a newer one is refused on load, and the first format change brings its migration.

---

## Phase 11: Polish and release

- [x] T079 [P] Docs in `docs/`: writing rules, locks reference, security model (deny rules, identity check, residual risks), machines, FAQ
  - `writing-rules.md`, `locks.md`, `security.md` and `faq.md`, checked against the code on main, the approval bypass (T115) included, linked from the README. The machines are documented with their phase, in `docs/machines/` (T109).
- [x] T080 [P] Generic rule examples in `examples/rules/` next to OpenScreen's
  - `cautious`: agents judge and ask, and every path is locked, so only the owner's merge order merges. `solo-maintainer`: bug fixes, docs, tests and maintenance merge alone within path and size locks; features, API changes and dependencies go to the owner.
  - `test/examples.test.mjs` loads every folder of `examples/rules/` through the real `loadRules`, as a repo's `.rusuban/`: valid locks, rules present, no file the loader would skip.
- [x] T081 [P] Playwright tests in `test/e2e/`: answer a card, answer a conversation, release a machine
  - Started in Phase 6: `npm run test:e2e`, a CI job on Ubuntu with Chromium. Each test starts the real server on a free port over a seeded home of two projects; a run goes through the real runner with fake-claude. At 1440×900 and 390×844, with real clicks and taps: every view tab shows its view; a card opens and closes; an answered option leaves the cards to answer and is written to `answers.jsonl`; a filter changes the list; Agents shows Run now on a task at rest, none on a task at work, and Run now starts it. With the #7 click bug put back, five of the ten fail.
  - Answering a conversation came with Phase 7, at both widths: a Desktop session answered in a fork, through the real runner. Releasing a machine came with Phase 9: Release pressed twice ends the lease. A desktop's card lent is checked too.
- [x] T082 Run every check of quickstart.md (SC-001 to SC-007) and record the results in `specs/001-autopilot/validation.md`
  - Recorded on 2026-11-08. Passed: SC-002's code, SC-003's time, SC-005, and SC-006 on the tests. To do with Etienne, each with its reason: SC-001, SC-004, SC-007, SC-003's links on real data, SC-006's live proof, and SC-002 from OpenScreen's rules once getopenscreen/openscreen#1507 merges.
  - Recorded again on 2026-11-11, on main at `a473351`, with SC-008. Passed: SC-002 (OpenScreen live on the product since 2026-11-09), SC-003's time on real data, SC-005, SC-006 on the tests, SC-008. To do with Etienne: SC-004 before 0.1.0 (T106, T108), SC-003's links on a labelled sample; after 0.1.0, by his decision: SC-001 (T078), SC-006's live proof and SC-007 (T112).
- [ ] T083 Remove `"private": true` from `package.json`, publish v0.1.0 on npm and write the release notes (the repo is public since M0)

**After v1**: first the machine runner for graphical tests, screenshots and recordings (reflection P4);
then team claims (US8, FR-081), machine lending (reflection P6), answers from the channels, an
agent-only GitHub token with a repository ruleset.

---

## Dependencies

- Setup → Foundational → Foundation amendments (2b) → US3 → US2 (cards) → US6 → US7 → **OpenScreen
  switch** → US4 → US2 (pings) → US5 → US1 → Polish.
- Every interface phase starts with its mockup task, validated by Etienne (T100, T102, T104, T111).
- After the switch, US4, US2 (pings) and US5 touch different modules (`hub.mjs`, `pings.mjs`,
  `machines.mjs`) and can run in parallel; the order above is the default.
- US1 installs what the other stories built, so it comes last.

## Parallel examples

- **Foundational**: T007, T012, T015, T017, T020, T022 (tests in separate files) once their module exists.
- **US3**: the four prompts T024 to T027 together; T032 and T034 alongside the implementation.
- **US4**: T053 fixtures while T054 is written; T057 once T055 and T056 exist.
- **US2 pings**: the five payloads of T062 and their tests T063.
- **US1**: the three service installers of T074 and the commands of T075.

## Implementation Strategy

- **MVP** = Phases 1 to 6 plus the OpenScreen switch: the old pilot is retired, and OpenScreen runs on
  the generic product from its own rules. Parity first was chosen on 2026-11-07, before the
  conversations hub, which comes right after (Phase 7).
- Each later phase ships alone, tested on OpenScreen before moving on.
- The repo is public since M0 (free CI on the three OSes); Phase 11 publishes v0.1 on npm.
