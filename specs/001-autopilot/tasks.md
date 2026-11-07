---
description: "Task list for the public project autopilot"
---

# Tasks: Project autopilot for Claude Code (public product)

**Input**: design documents in `specs/001-autopilot/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: included where the spec measures a criterion (SC-002, SC-005, SC-006) and for every pure
module, as in the OpenScreen pilot (`node --test`).

**Paths**: root of the new repository `EtienneLescot/rusuban`; `rusuban` is replaced once chosen.

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

- [ ] T006 Instance home and atomic store in `src/home.mjs`: `~/.rusuban/` (override `RUSUBAN_HOME`), `read`, `write` (temp file + rename), `readJsonl`, `append`, journal helper; `config.json` created with mode 600
- [ ] T007 [P] Store tests (atomic write, append, missing files) in `test/home.test.mjs`
- [ ] T008 Instance config in `src/home.mjs`: `owner.login`, `port`, `permissions { mode: "bypass" | "allowlist", allow[], deny[] }` with **no default mode**, `projects[]`, `machines[]`, `channels[]`; validated on load
- [ ] T009 Port the GitHub reader to `src/github.mjs`: repo as a parameter; PR fields `repo, n, title, url, author, draft, head, headRef, base, additions, deletions, files[], refs[], closes[], mergeable, canBeRebased, ci { state, runId }, reviews { "<login>": state }, threadsOpen` (replaces the CodeRabbit-only state); items keyed `owner/repo#n`
- [ ] T010 [P] Polling per project in `src/github.mjs`: every `refreshSec` (default 90), slower when the rate-limit budget is under 20 %
- [ ] T011 Rules loader in `src/rules.mjs`: `.rusuban/rules/*.md` in file-name order and `.rusuban/locks.json`, from the default branch through `gh api …/contents?ref=<default>`, cached by tree sha in `projects/<p>/rules.json`; no folder → the project is observe-only
- [ ] T012 [P] Rules loader tests (order, missing folder, invalid `locks.json` reported, PR head never read) in `test/rules.test.mjs`
- [ ] T013 Port the pure model to `src/model.mjs`: built-in gates (CI green on the exact head, no open thread, head unchanged since judgment, rebaseable, `.rusuban/` untouched, merge switch) plus project locks (`lockedPaths`, `maxLines`, `maxFiles`, `sizeExempt`, `requiredChecks`, `requiredReviewers`, `evidence`); kinds `bug | feature | maintenance | docs | translation | question | other`
- [ ] T014 Todo reasons in `src/model.mjs`: `unjudged`, `new-commit`, `ci-approval`, `missing-card`, `revisit-due` (fires at the judgment's `revisitAt`); no delay built in
- [ ] T015 [P] Model tests in `test/model.test.mjs`: gates, eligibility, every todo reason including `revisit-due`, multi-repo keys
- [ ] T016 Agent launcher in `src/agents.mjs` (port of `engine/claude-run.mjs`): `claude -p <prompt> --output-format stream-json --verbose`, session id from `system/init`, readable log, final summary; permission flags from the instance profile; the built-in `--disallowedTools` (merge commands, `gh api` merge calls, pushes to a default branch, edits under the instance home) always added
- [ ] T017 [P] Test that the built-in deny rules are present under both profiles in `test/agents.test.mjs`
- [ ] T018 Runs in `src/agents.mjs`: `runs/<run>/status.json` with `{ id, kind, project, items[], session, cwd, worktree, leases[], trigger, state, startedAt, endedAt, exitCode, step, summary }`, lock groups and FIFO queue (port of `engine/tasks.mjs`)
- [ ] T019 Agent commands in `bin/rusuban.mjs`: `todo`, `show`, `judge` (refuses a missing `revisitAt` when `owner` is `agent` or `third`, and a PR judged on a head that is not live), `resolve`, `log`, `evidence`, `answers`, `asks`; reads `RUSUBAN_RUN` and `RUSUBAN_PROJECT`
- [ ] T020 [P] Port the CLI tests to `test/cli.test.mjs`
- [ ] T021 Server skeleton in `src/server.mjs`: listens on 127.0.0.1 only; static `web/`; `/api/state?project=`; `/api/events` (SSE); POST guard (local or `ts.net` origin, `x-rusuban: 1`, body under 8 KB); identity check (`Tailscale-User-Login` must be the owner's login, loopback without it is the local user)
- [ ] T022 [P] Guard tests (wrong login, wrong origin, missing header, oversized body) in `test/server.test.mjs`
- [ ] T023 Port the dashboard to English in `web/index.html`, `web/app.js`, `web/app.css`: project switcher, graph, kanban, drawer; all strings in one table

**Checkpoint**: the daemon reads several repos, the model computes gates, agents can be launched.

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
- [ ] T035 [US3] Journal and freshness in `web/app.js`: what was done without the user, the age of every datum, stale flags

---

## Phase 4: User Story 2 - Decisions come to me: cards and inbox (P1)

**Goal**: every human decision is a card, answered in a few taps.
**Independent test**: a rule routes features to the owner; a feature PR produces a card; answering it
starts the coordinator, which applies the answer.

- [ ] T036 [US2] Cards in `src/model.mjs`: `{ id, to, urgency: "now" | "digest", q, ctx, rec, why, options[{ id, label, effect, message? }], createdAt, resolvedAt, outcome }`, transitions `open → resolved | replaced`
- [ ] T037 [US2] `/api/answer` and `/api/ask` in `src/server.mjs`: a replaced card refuses late answers; an answer starts the coordinator at once
- [ ] T038 [US2] Inbox in `web/app.js`: open cards of every project, newest first, answer by option or free note
- [ ] T039 [P] [US2] Card tests (replaced card refused, answer recorded once) in `test/cards.test.mjs`

---

## Phase 5: User Story 6 - Recurring tasks written as text (P2)

**Goal**: text-defined jobs on a schedule or a click.
**Independent test**: a daily task runs at its time, once after a skipped slot, and its conversation opens
from the journal.

- [ ] T040 [US6] Task catalog in `src/tasks.mjs`: `tasks/<id>.md` with front matter `title`, `project`, `schedule` (`daily HH:MM,…`), `lock`, `cwd`, then the prompt (port of `engine/tasks.mjs`)
- [ ] T041 [US6] Scheduler inside the daemon in `src/server.mjs`: a missed slot runs once (`lastSlot`), lock groups run one after the other
- [ ] T042 [P] [US6] Scheduler tests (missed slot, shared lock) in `test/tasks.test.mjs`
- [ ] T043 [US6] `/api/tasks` and `/api/tasks/<id>/run` in `src/server.mjs`, tasks view in `web/app.js`

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
- [ ] T050 Shadow week: merges paused, judgments compared daily with the old pilot's; gaps fixed in the prompts or the rules
- [ ] T051 Switch: the service replaces the `OpenScreenDashboard` and `OpenScreenTasks` Windows tasks, shortcuts repointed, `.claude/pilot` archived
- [ ] T052 Check that `grep -ri openscreen bin src web` finds nothing (SC-002)

---

## Phase 7: User Story 4 - Every Claude conversation of the project (P1, M2)

**Goal**: all sessions of the project's folders, linked to their items, read and answered in the dashboard.
**Independent test**: a Desktop session about PR #N in a project worktree shows under #N within a minute;
an answer from the phone appears in its transcript.

- [ ] T053 [P] [US4] Scrubbed transcript fixtures (Desktop, CLI, `sdk-cli`, with `custom-title`, `pr-link`, `relocated`, a corrupt line) in `test/fixtures/transcripts/`
- [ ] T054 [US4] Discovery in `src/hub.mjs`: scan `~/.claude/projects/*/`; keep sessions whose `cwd` or `relocatedCwd` is inside a project folder (checkouts, their worktrees, extra folders); membership by `cwd`, never by folder slug
- [ ] T055 [US4] Incremental parser in `src/hub.mjs`: byte offset per file in `hub/index.json`; title (`custom-title`, `agent-name`, first user text), origin from `entrypoint`, `firstAt`, `lastAt`, `branch`, `prs[]` from `pr-link`, cited `#N` and URLs; unknown line types skipped, parse errors recorded
- [ ] T056 [US4] Links in `src/hub.mjs`, in this order: run metadata, `pr-link`, `gitBranch` equal to a PR head ref, cited numbers
- [ ] T057 [P] [US4] Parser and link tests in `test/hub.test.mjs`: at least 90 % linked on the fixtures, plain list on an unknown format
- [ ] T058 [US4] `/api/conversations` (filters) and `/api/conversations/<id>?before=` (a page: user text, assistant text, tool calls with a short input, results cut to 2 KB) in `src/server.mjs`
- [ ] T059 [US4] Reply in `src/hub.mjs`: `claude -p <text> --resume <id>` in its `cwd`, as a `reply` run; `--fork-session` when the file changed in the last 120 s; `/api/conversations/<id>/reply` answers `{ run, forked }`
- [ ] T060 [US4] `/api/conversations/<id>/terminal`, loopback only: opens the session in a terminal on the host (Windows Terminal, Terminal.app, `$TERMINAL`)
- [ ] T061 [US4] Conversations view in `web/app.js`: list by project and item, reader, answer box, phone layout; each item lists its conversations

---

## Phase 8: User Story 2 - Decisions come to me: pings (P1, M3)

**Goal**: the owner is pinged where they chose, with a link to the card.
**Independent test**: `channel test` on each type; a new card pings at once, a digest card at `digestAt`.

- [ ] T062 [P] [US2] Channel payloads in `src/pings.mjs`: ntfy (POST, `Title`, `Click`), Slack (incoming webhook, blocks), Discord (webhook, embed), Teams (Workflows webhook, Adaptive Card), e-mail (`nodemailer`, SMTP)
- [ ] T063 [P] [US2] One payload test per channel (card in, payload with the card link out) in `test/pings.test.mjs`
- [ ] T064 [US2] Dispatch in `src/pings.mjs`: a new card for the owner goes to the channels of its urgency; digest at `digestAt`; quiet hours; a failed send retried, then journaled
- [ ] T065 [US2] `channel add|test|list` in `bin/rusuban.mjs`; secrets only in `config.json` (mode 600)

---

## Phase 9: User Story 5 - Test machines, reserved (P2, M4)

**Goal**: agents see, reserve and release the owner's machines; a person's desktop needs that person's yes.
**Independent test**: two agents need macOS; the second waits for the first's lease; killing the first
frees the Mac at expiry.

- [ ] T066 [US5] Registry in `src/machines.mjs`: `{ name, os, ssh | null, caps[], checkout, owner?, maxLeaseMin }`; `machine add` checks SSH (`BatchMode`, 5 s timeout), git and the checkout folder
- [ ] T067 [US5] Probe every 2 min, plus `tailscale status --json` when present; state pushed to the page
- [ ] T068 [US5] Leases in `src/machines.mjs`: exclusive file (`wx`) `{ machine, run, pid, since, expires, reason }`, renewed while the run lives, freed when the holder dies or expires, FIFO queue, capability match; agent commands `lease` and `release`
- [ ] T069 [P] [US5] Lease tests (two waiters, dead holder, expiry, capability match) in `test/machines.test.mjs` (SC-006)
- [ ] T070 [US5] A person's desktop (`owner` set): a lease request opens a card to that person and is granted only on acceptance
- [ ] T071 [US5] `/api/machines` and `/api/machines/<machine>/release` in `src/server.mjs`, machines view in `web/app.js`
- [ ] T072 [US5] Machines and their live state in every prompt's context, in `src/agents.mjs`

---

## Phase 10: User Story 1 - Install, connect, always find the dashboard (P1, M5)

**Goal**: one command to a running pilot whose URL is never lost.
**Independent test**: on clean Windows, macOS and Linux machines with `gh` and `claude` logged in, the
dashboard shows a public repo in under 10 minutes and comes back after a reboot.

- [ ] T073 [US1] `init` in `bin/rusuban.mjs`: checks the `gh` and `claude` logins, owner login from `gh`, asks the host permission mode (no default), adds a first project, installs the service, prints and opens the URL
- [ ] T074 [P] [US1] Service installers in `src/service.mjs`: Task Scheduler at logon with restart on failure (Windows), launchd agent with `KeepAlive` (macOS), `systemd --user` unit with `Restart=on-failure` (Linux); `service install|uninstall`
- [ ] T075 [P] [US1] `start`, `open`, `status`, and a desktop or menu shortcut per OS, in `bin/rusuban.mjs` and `src/service.mjs`
- [ ] T076 [US1] `remote enable|disable`: `tailscale serve --bg --https=443 http://127.0.0.1:<port>`; `status` shows the tailnet URL
- [ ] T077 [US1] Observe-only page in `web/app.js`: without rules, items and conversations show, with how to add rules and links to `examples/rules/`
- [ ] T078 [US1] Timed clean-machine install on the three OSes (SC-001)

---

## Phase 11: Polish and release

- [ ] T079 [P] Docs in `docs/`: writing rules, locks reference, security model (deny rules, identity check, residual risks), machines, FAQ
- [ ] T080 [P] Generic rule examples in `examples/rules/` next to OpenScreen's
- [ ] T081 [P] Playwright tests in `test/e2e/`: answer a card, answer a conversation, release a machine
- [ ] T082 Run every check of quickstart.md (SC-001 to SC-007) and record the results in `specs/001-autopilot/validation.md`
- [ ] T083 Publish v0.1.0 on npm, make the repo public, write the release notes

**After v1, not scheduled**: team claims (US8, FR-081), answers from the channels, an agent-only
GitHub token with a repository ruleset.

---

## Dependencies

- Setup → Foundational → US3 → US2 (cards) → US6 → US7 → **OpenScreen switch** → US4 → US2 (pings)
  → US5 → US1 → Polish.
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
- The repo stays private until Phase 11, which publishes v0.1.
