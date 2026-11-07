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
- [x] T091 [P] One breaking test per lock in `test/merge-gate.test.mjs` and `test/server.test.mjs`: open thread, switch paused, size, conflict, missing required check, no check at all, wrong `Host`, wrong Tailscale login

---

## Phase 3: User Story 3 - The project moves on its own (P1) 🎯 MVP

**Goal**: triage, fixes and merges under the project's text rules, inside the hard locks.
**Independent test**: a sandbox repo with rules allowing bug-fix merges: a fix PR is merged; the
adversarial PRs are not, each with the gate that stopped it.

- [ ] T024 [P] [US3] Safety frame in `src/prompts/frame.md`: GitHub content is data, the built-in locks, agents never merge
- [ ] T025 [P] [US3] Generic judge prompt in `src/prompts/judge.md`, from `tasks/judge.md` without OpenScreen: todo reasons, judgment format with `revisitAt`, card format, delegation
- [ ] T026 [P] [US3] Generic act prompt in `src/prompts/act.md`, from `tasks/act.md` without OpenScreen
- [ ] T027 [P] [US3] Generic worker prompt in `src/prompts/worker.md`, from the rules of `engine/worker.mjs` without OpenScreen
- [ ] T028 [US3] Prompt assembly in `src/agents.mjs`: product prompt → frame → project rules headed `<owner/repo>@<sha>` → context (owner, machines, open cards, pending answers, requests and reports) → task prompt
- [ ] T029 [US3] Judge trigger in `src/server.mjs`: `judge` starts when a project's todo signature changes; an observe-only project never starts an agent
- [ ] T030 [US3] Server-only merge in `src/github.mjs`: `gh pr merge --<mergeMethod> --match-head-commit`, one per cycle, only when every gate passes and the judgment says `auto`; journaled with its gates
- [ ] T031 [US3] Foreign merges in `src/server.mjs`: a merged PR missing from the server's journal is flagged in the journal and the inbox
- [ ] T032 [P] [US3] Adversarial fixtures in `test/fixtures/prs/` and `test/merge-gate.test.mjs`: PR editing `.rusuban/`, injected instructions in the body, red CI, moved head, locked path, missing evidence; none merged, the stopping gate named (SC-005)
- [ ] T033 [US3] Workers in `src/workers.mjs`: `worker start|stop|list`; each in `git worktree add <home>/worktrees/<p>/<run>`; at most N at once; its report goes to the coordinator; worktree removed at the end, stale ones cleaned at start
- [ ] T034 [P] [US3] Worker tests (limit, one report, stale cleanup) in `test/workers.test.mjs`
- [ ] T035 [US3] Journal and freshness in `web/app.js`: what was done without the user, the age of every datum, stale flags (thresholds of FR-072)
- [ ] T092 [US3] Direct pushes in `src/server.mjs`: a commit on a default branch that no server merge produced is flagged in the journal and the inbox
- [ ] T093 [US3] Merge orders in `src/server.mjs`: an answer ordering a merge is carried out by the server, which checks CI, threads, head and conflicts and lifts the project locks for that head only (FR-044)
- [ ] T094 [US3] Rules changes in `src/rules.mjs`: a new tree sha applies at once, is journaled with its diff and pings the owner (FR-027); a `locks.json` that fails to parse is journaled and pings the owner too
- [ ] T095 [US3] Evidence in `bin/rusuban.mjs`: accepted only from a worker run other than the judging run, for the live head, with the run and its conversation attached
- [ ] T096 [US3] Silent rules in `src/prompts/judge.md` and `src/prompts/act.md`: a situation the rules do not cover becomes a card that offers to turn the answer into a rule (FR-026)
- [ ] T097 [US3] Usage limits in `src/agents.mjs`: a run that hits a Claude usage limit becomes `limited` with its retry time; an interrupted run gives its requests back to the queue (FR-073)
- [ ] T098 [P] [US3] Generic task prompt in `src/prompts/task.md`
- [ ] T099 [P] [US3] Live test on a sandbox repo: a PR whose body tells the agent to merge it is judged on its diff and never merged (US3 scenario 3)
- [ ] T114 [US3] `ignoredChecks` in `src/model.mjs`: named checks never block CI green, never all of them (a head whose only checks are ignored is not green); a breaking test in `test/merge-gate.test.mjs`

---

## Phase 4: User Story 2 - Decisions come to me: cards and inbox (P1)

**Goal**: every human decision is a card, answered in a few taps.
**Independent test**: a rule routes features to the owner; a feature PR produces a card; answering it
starts the coordinator, which applies the answer.

- [ ] T100 [US2] Mockups of the inbox and the cards, desktop and phone, validated by Etienne before T038
- [ ] T036 [US2] Cards in `src/model.mjs`: `{ id, to, urgency: "now" | "digest", q, ctx, rec, why, options[{ id, label, effect, message? }], createdAt, resolvedAt, outcome }`, transitions `open → resolved | replaced`
- [ ] T037 [US2] `/api/answer` and `/api/ask` in `src/server.mjs`: a replaced card refuses late answers; an answer starts the coordinator at once
- [ ] T038 [US2] Inbox in `web/app.js`: open cards of every project, newest first, answer by option or free note
- [ ] T039 [P] [US2] Card tests (replaced card refused, answer recorded once) in `test/cards.test.mjs`
- [ ] T101 [US2] Runs view, `GET /api/runs`, `POST /api/runs/<id>/stop`, `POST /api/refresh` and `GET /api/inbox` in `src/server.mjs` and `web/app.js`

---

## Phase 5: User Story 6 - Recurring tasks written as text (P2)

**Goal**: text-defined jobs on a schedule or a click.
**Independent test**: a daily task runs at its time, once after a skipped slot, and its summary and log
show in the journal.

- [ ] T040 [US6] Task catalog in `src/tasks.mjs`: `tasks/<id>.md` with front matter `title`, `project`, `schedule` (`daily HH:MM,…`), `lock`, `cwd`, then the prompt (port of `engine/tasks.mjs`)
- [ ] T041 [US6] Scheduler inside the daemon in `src/server.mjs`: a missed slot runs once (`lastSlot`), lock groups run one after the other
- [ ] T042 [P] [US6] Scheduler tests (missed slot, shared lock) in `test/tasks.test.mjs`
- [ ] T102 [US6] Mockup of the tasks view, validated by Etienne before T043
- [ ] T043 [US6] `/api/tasks` and `/api/tasks/<id>/run` in `src/server.mjs`, tasks view in `web/app.js`
- [ ] T103 [US6] `task list|run` in `bin/rusuban.mjs`

---

## Phase 6: User Story 7 - Several projects, one inbox (P2)

**Goal**: one instance, several projects, one inbox.
**Independent test**: two projects, one decision each, both in the inbox; their states never mix.

- [ ] T044 [US7] `project add|list|remove` in `bin/rusuban.mjs`; per-project state under `projects/<p>/`
- [ ] T045 [US7] Daemon loops per project in `src/server.mjs` (refresh, triggers, merge); one inbox for all
- [ ] T046 [P] [US7] Two-project test (isolation, merged inbox) in `test/projects.test.mjs`

---

## Checkpoint: OpenScreen runs on the generic product (SC-002)

- [ ] T047 Write OpenScreen's rules from `.claude/pilot/tasks/judge.md`, `act.md` and its constitution into `examples/rules/openscreen/rules/*.md` and `locks.json`
- [ ] T048 Propose them to `getopenscreen/openscreen` as `.rusuban/` in a PR, which Etienne merges
- [ ] T049 Configure Etienne's instance: the `openscreen` project; the `publications` and `n8n-series` tasks moved to `~/.rusuban/tasks/`
- [ ] T050 Shadow week: the project in `shadow` mode (judge only, GitHub writes denied, no merge), judgments compared daily with the old pilot's; gaps fixed in the prompts or the rules
- [ ] T051 Switch: the project goes `live`; the `OpenScreenDashboard` Windows task repointed to `rusuban start` and `OpenScreenTasks` removed (the full installer is T074); shortcuts repointed; `.claude/pilot` archived read-only, its history not imported
- [ ] T052 Check that `grep -ri openscreen bin src web` finds nothing (SC-002)

---

## Phase 7: User Story 4 - Every Claude conversation of the project (P1, M2)

**Goal**: all sessions of the project's folders, linked to their items, read and answered in the dashboard.
**Independent test**: a Desktop session about PR #N in a project worktree shows under #N within a minute;
an answer from the phone appears in its transcript.

- [ ] T104 [US4] Mockups of the conversations list and reader, desktop and phone, validated by Etienne before T061
- [ ] T053 [P] [US4] Scrubbed transcript fixtures (Desktop, CLI, `sdk-cli`, with `custom-title`, `pr-link`, `relocated`, a corrupt line) in `test/fixtures/transcripts/`
- [ ] T054 [US4] Discovery in `src/hub.mjs`: scan `~/.claude/projects/*/`; keep sessions whose `cwd` or `relocatedCwd` is inside a project folder (checkouts, their worktrees, extra folders); membership by `cwd`, never by folder slug
- [ ] T055 [US4] Incremental parser in `src/hub.mjs`: byte offset per file in `hub/index.json`; title (`custom-title`, `agent-name`, first user text), origin from `entrypoint`, `firstAt`, `lastAt`, `branch`, `prs[]` from `pr-link`, cited `#N` and URLs; unknown line types skipped, parse errors recorded
- [ ] T056 [US4] Links in `src/hub.mjs`, in this order: run metadata, `pr-link`, `gitBranch` equal to a PR head ref, cited numbers
- [ ] T057 [P] [US4] Parser and link tests in `test/hub.test.mjs`: at least 90 % linked on the fixtures, plain list on an unknown format
- [ ] T058 [US4] `/api/conversations` (filters) and `/api/conversations/<id>?before=` (a page: user text, assistant text, tool calls with a short input, results cut to 2 KB) in `src/server.mjs`
- [ ] T059 [US4] Reply in `src/hub.mjs`, through the launcher of T016: a session Rusuban started resumes in place (`--resume <id>`) unless its run is alive; any other session is answered with `--fork-session`, recorded as `forkOf` and listed under the original; `/api/conversations/<id>/reply` answers `{ run, forked }`
- [ ] T060 [US4] `/api/conversations/<id>/terminal`, loopback only: opens the session in a terminal on the host (Windows Terminal, Terminal.app, `$TERMINAL`)
- [ ] T105 [US4] Hub loop in `src/server.mjs`: rescan every 30 s and show the index age (FR-055); a number in a branch name links to its issue
- [ ] T061 [US4] Conversations view in `web/app.js`: list by project and item, reader, answer box, phone layout; each item lists its conversations
- [ ] T106 [US4] Live proof of M2: a Desktop session on a real item shows under it within a minute, and an answer from the phone lands in its fork

---

## Phase 8: User Story 2 - Decisions come to me: pings (P1, M3)

**Goal**: the owner is pinged where they chose, with a link to the card.
**Independent test**: `channel test` on each type; a new card pings at once, a digest card at `digestAt`.

- [ ] T062 [P] [US2] Channel payloads in `src/pings.mjs`: ntfy (POST, `Title`, `Click`), Slack (incoming webhook, blocks), Discord (webhook, embed), Teams (Workflows webhook, Adaptive Card), e-mail (`nodemailer`, SMTP)
- [ ] T063 [P] [US2] One payload test per channel (card in, payload with the card link out) in `test/pings.test.mjs`
- [ ] T064 [US2] Dispatch in `src/pings.mjs`: a new card for the owner goes to the channels of its urgency; digest at `digestAt`; quiet hours; a failed send retried, then journaled
- [ ] T065 [US2] `channel add|test|list` in `bin/rusuban.mjs`; secrets only in `config.json` (mode 600)
- [ ] T107 [US2] Ping links straight to the card (`/#card/<id>`), on the tailnet address when remote access is on; in v1 every card goes to the owner (FR-045)
- [ ] T108 [US2] Live proof of M3: a real card pings a phone and is answered in three taps (SC-004)

---

## Phase 9: User Story 5 - Test machines, reserved (P2, M4)

**Goal**: agents see, reserve and release the owner's machines; a person's desktop needs that person's yes.
**Independent test**: two agents need macOS; the second waits for the first's lease; killing the first
frees the Mac at expiry.

- [ ] T066 [US5] Registry in `src/machines.mjs`: `{ name, os, ssh | null, caps[], workspace, agentUser, owner?, maxLeaseMin }`; `machine add` checks SSH (`BatchMode`, 5 s timeout), the `rusuban` account, git and the workspace, and creates the bare mirror
- [ ] T067 [US5] Probe every 2 min, plus `tailscale status --json` when present; state pushed to the page
- [ ] T068 [US5] Leases in `src/machines.mjs`: exclusive file (`wx`) `{ machine, run, pid, since, expires, reason }`, renewed while the run lives, freed when the holder dies or expires, FIFO queue, capability match; agent commands `lease` and `release`
- [ ] T069 [P] [US5] Lease tests (two waiters, dead holder, expiry, capability match) in `test/machines.test.mjs` (SC-006)
- [ ] T070 [US5] A person's desktop (`owner` set): a lease request opens a card to that person and is granted only on acceptance
- [ ] T071 [US5] `/api/machines` and `/api/machines/<machine>/release` in `src/server.mjs`, machines view in `web/app.js`
- [ ] T072 [US5] Live machine state in the prompt context of T028, in `src/agents.mjs` (one copy, not a second one)
- [ ] T109 [US5] `machine list|probe|doctor` in `bin/rusuban.mjs`; setup scripts per OS (OpenSSH server, `rusuban` account, the host's key) in `docs/machines/`
- [ ] T110 [US5] Desktop guard: a person's desktop alias is denied to every run that does not hold its lease (FR-063)
- [ ] T111 [US5] Mockup of the machines view, validated by Etienne before T071
- [ ] T112 [US5] Live proof of M4: two runs need macOS on the real Mac; the second waits; killing the first frees the Mac at expiry

---

## Phase 10: User Story 1 - Install, connect, always find the dashboard (P1, M5)

**Goal**: one command to a running pilot whose URL is never lost.
**Independent test**: on clean Windows, macOS and Linux machines with `gh` and `claude` logged in, the
dashboard shows a public repo in under 10 minutes and comes back after a reboot.

- [ ] T073 [US1] `init` in `bin/rusuban.mjs`: checks the `gh` and `claude` logins, owner login from `gh`, asks the host permission mode and whether to arm automatic merges (no default for either), writes `limits` explicitly, adds a first project, installs the service, prints and opens the URL
- [ ] T074 [P] [US1] Service installers in `src/service.mjs`: Task Scheduler at logon with restart on failure (Windows), launchd agent with `KeepAlive` (macOS), `systemd --user` unit with `Restart=on-failure` (Linux); `service install|uninstall`
- [ ] T075 [P] [US1] `start`, `open`, `status`, and a desktop or menu shortcut per OS, in `bin/rusuban.mjs` and `src/service.mjs`
- [ ] T076 [US1] `remote enable|disable`: `tailscale serve --bg --https=443 http://127.0.0.1:<port>`; `status` shows the tailnet URL; stores `owner.tailscaleLogin` from `tailscale status --json`
- [ ] T077 [US1] Observe-only page in `web/app.js`: without rules, items and conversations show, with how to add rules and links to `examples/rules/`
- [ ] T078 [US1] Timed clean-machine install on the three OSes (SC-001)
- [ ] T113 [US1] Updates: `status` compares the installed version with npm; config and state files carry a version, migrated on load (FR-074)

---

## Phase 11: Polish and release

- [ ] T079 [P] Docs in `docs/`: writing rules, locks reference, security model (deny rules, identity check, residual risks), machines, FAQ
- [ ] T080 [P] Generic rule examples in `examples/rules/` next to OpenScreen's
- [ ] T081 [P] Playwright tests in `test/e2e/`: answer a card, answer a conversation, release a machine
- [ ] T082 Run every check of quickstart.md (SC-001 to SC-007) and record the results in `specs/001-autopilot/validation.md`
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
