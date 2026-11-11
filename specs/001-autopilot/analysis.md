# Specification analysis (2026-11-07)

A read-only Spec Kit analysis by an independent agent (passes A to F of `speckit-analyze`), plus the
gaps Etienne and Claude had already named. Every finding is resolved below; the decisions Etienne took
are recorded in the spec's Clarifications.

**Before**: 34 FRs, 83 tasks, 21 findings (4 critical, 9 high, 7 medium, 1 low) + 6 known gaps.
**After**: 42 FRs, 113 tasks (T084 to T113 added), constitution 1.1.0, plan re-checked against it.

## Findings and resolutions

| ID | Sev. | Finding | Resolution |
|---|---|---|---|
| D1 | critical | The merge switch had no task, file or default | `automerge.json` (daemon), `init` asks whether to arm it; T086 |
| D2 | critical | "No push to the default branch" relied on a bypassable deny rule; locks without breaking tests | Direct pushes flagged (T092); one breaking test per lock (T091) |
| D3 | critical | One-writer rule broken: journal, leases, card resolution | Journal split (T085); resolution derived; leases as a lock primitive (Complexity Tracking) |
| D4 | critical | Constitution Check run against the OpenScreen pilot's constitution | Re-run against Rusuban 1.1.0 in plan.md |
| F1 | high | An agent command lifts the evidence lock | Etienne kept agent attestation: only a worker other than the judging run, with its conversation (T095) |
| E1 | high | "A judgment that breaks a lock becomes a card" had no task; two reasons undefined | Reasons defined in contracts/cli.md, `lock-blocked` added (T088) |
| B1 | high | Observe-only enforced at one trigger only | Etienne: nothing autonomous without rules, owner requests still run (FR-024, constitution III) |
| B2 | high | Identity compared to the GitHub login; no `Host` check, GET open | Tailscale login stored, `Host` checked on every request (FR via research R7, T089) |
| F2 | high | Rules merged by anyone go straight into prompts | Etienne: rules apply at once, journaled with their diff and pinged; the host is protected by the instance profile, which no rule widens (FR-027) |
| F3 | high | The shadow week would act on the live repo | Project `shadow` mode: judge only, GitHub writes denied, no merge (FR-028, T050, T090). Removed on 2026-11-09 with the shadow week: a repo without rules is only read, and a repo added waits for the owner |
| F4 | high | The switch depended on Phase 9 and 10 work | Switch repoints the existing Windows task; machines stay as text until Phase 9; US6 test fixed |
| C1 | high | A person's desktop protected only by agent goodwill | Its alias denied to runs without its lease (FR-063, T110) |
| B3 | high | "CI green" undefined; rebaseable missing from FR-021 | Defined in FR-021, gate T087 |
| E2 | medium | Endpoints and commands without tasks | T098, T101, T103, T109 |
| C2 | medium | Replies and workers could skip the deny rules; no worker-limit key | Every run through one launcher (FR-030, T090); `limits.maxWorkers` |
| F5 | medium | Hub: no cadence, branch numbers unlinked, risky in-place resume | 30 s loop (FR-055, T105); numbers in branch names; foreign sessions answered through a fork (FR-053, T059) |
| E3 | medium | Usage limits, requeue, stale remote checkouts, lease cap | FR-073, T097; mirror fetched at lease time; lease capped at `maxLeaseMin` |
| C3 | medium | Ping links without base URL or card anchor; cards to others unanswerable | FR-045, T107 |
| F6 | medium | Terms drift: coordinator, `sdk` origin, owners, machine context twice | Aligned: `act`, `sdk-cli`, FR-080 reworded, T072 merged into T028 |
| E4 | medium | No staleness thresholds; no live proof for M2 to M4; scenario US3-3 untested | FR-072 thresholds; T106, T108, T112; T099 |
| F7 | low | Stale wording, `"private": true` blocks npm publish | Paths line fixed; T083 removes it |

## Gaps named before the analysis

| Gap | Resolution |
|---|---|
| No mockups for the new views | A mockup validated by Etienne before each interface phase: T100, T102, T104, T111 |
| How an agent applies rules it does not know in advance | Silent rules mean a card; the cards of several items one rule would answer, a rule proposal (FR-026, FR-099, T096, T133) |
| The reflection on several people and several machines | [reflection-team-and-machines.md](reflection-team-and-machines.md); P1 to P3 in v1, the runner (P4) first after v1 |
| The worker limit had no field | `limits { maxWorkers, maxRunMinutes }` in the instance config (T084) |
| The old pilot's history | Not imported; archived read-only (assumption, open to change) |
| Updates and file versions | `version` in config and state, migrated on load (FR-074, T113) |
