# Implementation Plan: Project autopilot for Claude Code (public product)

**Branch**: `001-autopilot` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-autopilot/spec.md`

## Summary

Turn the OpenScreen pilot (`.claude/pilot`, about 3,000 lines of Node with no dependency) into a
generic product in a new public repo. The engine is kept: GitHub read by GraphQL, a pure model for
gates, headless `claude -p` runs, a vanilla dashboard over SSE. Everything OpenScreen-specific moves
out: rules and locks go to the project's repo (`.rusuban/`), machines and tasks to the instance's
config. Four things are new: the conversations hub (every Claude Code session of a project, read and
answered from the dashboard), pings on five channels, a machine registry with leases, and an install
that starts the pilot on its own and gives a URL that is never lost.

## Technical Context

**Language/Version**: JavaScript (ES modules) on Node.js ≥ 22, no build step (research R1)

**Primary Dependencies**: `nodemailer` only (SMTP). External tools: `gh`, `claude` (Claude Code ≥ 2.1),
`git`, OpenSSH, optionally `tailscale`

**Storage**: JSON and JSONL files in the instance home `~/.rusuban/`, one writer per file, atomic writes
(data-model.md)

**Testing**: `node:test` for units and fixtures (adversarial PRs, real transcripts), Playwright for the
dashboard, a shadow week on OpenScreen for real behavior

**Target Platform**: host on Windows 10/11, macOS 13+, Linux with systemd; test machines are any OS
with OpenSSH

**Project Type**: local daemon + CLI + web dashboard, one npm package

**Performance Goals**: GitHub state at most 90 s old per project; the page updates within 2 s of a
change; a new session shows in the hub within 60 s; transcripts parsed incrementally (files up to 16 MB)

**Constraints**: listens on 127.0.0.1 only, remote access through Tailscale Serve with identity check;
no public endpoint; GitHub content is data; agents never merge

**Scale/Scope**: one person, up to 10 projects and 20 repos, 500 open items per repo, 5 agents at once,
thousands of transcripts

## Constitution Check

*Checked against the OpenScreen pilot's constitution, the only one that exists. M0 ratifies the
product's own constitution, generalized from it.*

| Principle | Status |
|---|---|
| I. One source, one writer per datum | Pass: kept, in the instance home. |
| II. Real time, freshness visible | Pass: kept, plus probe age for machines and index age for the hub. |
| III. Autonomy by default | **Changed, justified**: autonomy is now whatever each project's text rules say (spec clarification: no product defaults). Built-in locks stay. |
| IV. Mechanical guardrails | Pass, stronger: server-only merge, deny rules on every run (verified under bypass), the rules folder locked, merges the server did not do are flagged. |
| V. Readable at a glance | Pass: every card and node still answers what, who, next, blocked. |
| VI. Simplicity | Pass: no build, one dependency (justified below), Claude Code as the only engine. |
| Constraint: French interface | **Changed, justified**: English only (spec clarification). |
| Constraint: 127.0.0.1 only | Pass: Tailscale Serve proxies to loopback. |
| Constraint: no window on Etienne's desktop | Generalized: no use of a person's desktop without that person's card (FR-063). |

**After design**: no new violation. The deny rules (research R3) and the identity check (R7) are the
two places where security depends on an outside tool behaving as verified; both are covered by tests.

## Project Structure

### Documentation (this feature)

```text
specs/001-autopilot/
├── spec.md
├── plan.md            # this file
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/         # Phase 1: cli.md, http.md, project-files.md
└── tasks.md           # next: /speckit-tasks
```

### Source Code (new repository)

```text
bin/rusuban.mjs        CLI: owner and agent commands            ← pilot.mjs
src/
  home.mjs            instance home, config, atomic store       ← store.mjs
  github.mjs          live state per repo; merge, server only   ← github.mjs
  rules.mjs           rules and locks from the default branch   (new)
  model.mjs           gates, todo reasons, graph; pure, tested  ← model.mjs
  agents.mjs          claude -p, deny rules, queue, locks       ← engine/claude-run, run-task, tasks
  workers.mjs         worktrees, worker lifecycle, reports      ← engine/worker.mjs
  tasks.mjs           task catalog, schedule inside the daemon  ← engine/tasks, run-due
  hub.mjs             sessions: discover, parse, link, reply    (new)
  machines.mjs        registry, probes, leases                  (new)
  pings.mjs           routing, digest, five channel payloads    (new)
  server.mjs          HTTP, SSE, identity, daemon loops         ← serve.mjs
  service.mjs         autostart on Windows, macOS, Linux        (new)
  prompts/            frame, judge, act, worker, task (generic) ← tasks/judge.md, act.md
web/                  index.html, app.js, app.css (English)    ← app/
examples/rules/       generic examples, then OpenScreen's
test/                 units, fixtures, e2e/
docs/
```

**Structure Decision**: one package, one module per concern, as today. A fresh repository rather than
the history of `.claude/pilot`: the code is ported to English and its comments, prompts and history are
OpenScreen's.

## Delivery order

| Milestone | Content | Stories |
|---|---|---|
| **M0** Foundation | Name, new repo (MIT), product constitution, CI on the three OSes | |
| **M1** Parity | Multi-project config, rules and locks from the repo, generic prompts, server merge gate, cards, tasks in the daemon, English dashboard with an inbox. OpenScreen's rules proposed to its repo, shadow week, switch | US3, US6, US7, US2 (cards) |
| **M2** Conversations | The hub: index, links, reading, answering | US4 |
| **M3** Pings | Five channels, routing, digest, quiet hours | US2 |
| **M4** Machines | Registry, probes, leases, enrollment, a person's desktop by card | US5 |
| **M5** Release | `init`, the service per OS, Tailscale, docs, npm v0.1 | US1 |
| After v1 | Team claims, answers from channels, an agent-only GitHub token | US8 |

Decided on 2026-11-07: parity first (M1 before M2); the repo lives under Etienne's personal account
(`EtienneLescot/rusuban`) and is public since M0: made public on 2026-11-07 so that CI runs free on the
three OSes.

## Complexity Tracking

| Choice | Why needed | Simpler option rejected because |
|---|---|---|
| `nodemailer` | e-mail is one of the five channels asked for | SMTP by hand is hundreds of lines |
| Three service installers | the pilot must start on its own (FR-002) | there is no autostart mechanism common to the three OSes |
| Parsing an internal format | the hub must see Desktop and terminal sessions (FR-050) | no public API lists Claude Code sessions; parsing is defensive and degrades to a plain list |
