# Validation (T082)

Checked again on 2026-11-11, on main at `a473351`, against the table of `quickstart.md`. The first
pass was on 2026-11-08, at `1b91134`. What needs Etienne's machines or phone is marked "to do", with
the reason.

| Criterion | Result | Where it stands |
|---|---|---|
| SC-001 install under 10 min | To do, after 0.1.0 | Needs clean Windows, macOS and Linux machines (T078). Etienne put it after the release. |
| SC-002 no OpenScreen-specific code | Pass | The grep finds nothing, and OpenScreen runs live on the generic product since 2026-11-09. |
| SC-003 a session in the hub within 1 min, 90 % linked | Time: pass. Links: on fixtures | Real data: within 30 s. The 90 % holds on fixtures; on real data it needs a labelled sample. |
| SC-004 3 taps from a ping | To do, before 0.1.0 | Needs Etienne's phone over Tailscale (T106, T108). |
| SC-005 no merge with a lock broken | Pass | 35 gate tests and the cycle's switch tests. |
| SC-006 never two agents on a machine | Pass on tests; live proof after 0.1.0 | 18 machine tests. The live proof on the Mac (T112) comes after the release. |
| SC-007 enrolling under 5 min | To do, after 0.1.0 | Needs a fresh SSH machine and Etienne's go (T112). |
| SC-008 the dashboard answers within 200 ms | Pass | Live after #46: `/api/state` in 15 to 39 ms, against peaks of 2.2 to 6.8 s before. |

## SC-001: install under 10 minutes

**To do (T078), after 0.1.0.** Etienne decided on 2026-11-08 that the release follows his own trials
and the two phone proofs, not the clean installs.
- It is timed on clean Windows, macOS and Linux machines, with `gh` and `claude` logged in, from `npm
  i -g rusuban` to the dashboard showing a public repo.
- Those machines are Etienne's (`ssh mac`, `vivobook`, `sarae`). `init` installs a service there, so
  nothing runs on them without his word.
- Ahead of it, the coordinator's smoke test of the package passed: `npm pack`, then a global install
  in a temporary folder; the page is served, `status` answers, GitHub is read.

## SC-002: OpenScreen on the generic product

**Pass.**
- **Product code.** `grep -ri openscreen bin src web` finds nothing at `a473351` (T052).
- **OpenScreen runs live on the product since 2026-11-09.**
  - Its rules, locks and machines are in its repo (getopenscreen/openscreen#1507, T048).
  - The instance's `openscreen` project acts on them, and its two recurring tasks run in the
    `publications` project, which has no repo (T049, T128).
- **The old pilot is stopped (T051).**
  - Its two Windows tasks are disabled.
  - Rusuban runs from its own task, and `.claude/pilot` is archived.
- **The old pilot's judgments were not compared.** The shadow week was dropped on 2026-11-08 for
  Etienne's own trials (T050).

## SC-003: conversations in the hub

**The time: pass.** Measured on Etienne's instance, read only, on 2026-11-11 at 10:35.
- It indexes **1,141 OpenScreen conversations**: 436 from Claude Desktop, 616 headless `sdk-cli`
  sessions, and 89 of Rusuban's own runs. None has a parse error.
- **A new session shows within 30 s.** The hub runs a pass every 30 s, one at a time.
  - At the reading, the index was 7 s old.
  - Two sessions were live. The newest line indexed was written 7 s before the pass.
- **A pass costs the page nothing.** Since #46, the pass reads its thousand transcripts' sizes off the
  daemon's loop (SC-008).

**The links: pass on fixtures, to do on real data.**
- `test/hub.test.mjs` checks that at least 90 % of the fixture sessions about an item are linked to
  it.
- **On real data, 449 of the 1,141 conversations (39 %) carry an item.** That is not SC-003's
  measure: it counts the sessions *about* an item, and saying which those are takes a person.
- **Rusuban's runs carry their run's items**: 65 of the 89. The 24 others are about no one item: 22
  coordinator runs, which carry out answers and requests, and 2 task runs.
- `quickstart.md`'s check stays to do with Etienne: sessions opened on 10 known items, their links
  counted.

## SC-004: three taps from a ping

**To do (T106, T108), before 0.1.0.** It needs Etienne's phone on his tailnet, with `remote enable`
and a ping channel, to count notification → card → option.
- The page's part is covered at phone width:
  - a ping links to its card;
  - the click tests answer a card in two taps, its option then Send;
  - since #44, a card is answered the same way from its item's card in the graph.

## SC-005: no merge with a lock broken

**Pass.** The 35 tests of `test/merge-gate.test.mjs` pass.
- **Six adversarial PRs**, each stopped by the gate its fixture names, never merged:
  - its own rules folder edited (Locks);
  - instructions injected in its body (Judgment);
  - red CI (CI);
  - a head moved after the judgment (Judgment);
  - a locked path (Locks);
  - a missing proof (Evidence).
- **Single broken locks**, each stopped by its own gate, among them:
  - a draft;
  - a conflict;
  - a required check missing, skipped, pending, failed or waiting for approval;
  - a fork's workflow waiting for approval;
  - changes requested;
  - too many lines or files;
  - a renamed file;
  - a file list GitHub truncated;
  - a broken `locks.json`.
- **Edge cases:** a head whose only checks are ignored is not green. The baseline does merge.
- **The cycle's tests add the rest:**
  - nothing merges paused, not even a person's order;
  - a merge GitHub refuses is not tried again on that head, a restart included;
  - the approval bypass's guard stops on any rule it would skip or does not know.
- **Since #43**, a PR that changes `.rusuban/` is not even judged: a person merges it on GitHub.

## SC-006: one agent per machine

**Pass on the tests; the live proof comes after 0.1.0.** The 18 tests of `test/machines.test.mjs`
pass.
- **Never two runs on one machine, however many ask at once.**
- **The queue:** two waiters are served in the order they asked.
- **Freeing:**
  - a holder that died frees the machine and its worktree;
  - a lease ends at `maxLeaseMin` even with its holder alive;
  - another instance's lease holds until its expiry.
- **The real lease scripts:** the sh and PowerShell scripts that hold a lease were run against a real
  folder.
- **The live proof (T112):** two runs on the real Mac through `ssh mac`. The second waits; killing the
  first frees the Mac at expiry. Etienne put it after the release, by the same decision as T078:
  enrolling the Mac creates the `rusuban` account there.

## SC-007: enrolling a machine under 5 minutes

**To do (T112), after 0.1.0.** It is timed on a fresh SSH host, from the setup script of
`docs/machines/` to `rusuban machine probe` saying online.
- The scripts are syntax-checked (`sh -n`, PowerShell's parser), but not yet run on a real machine.
- They create an account there, so they run with Etienne.

## SC-008: the dashboard answers within 200 ms

**Pass.** Etienne's request of 2026-11-11 (T136): the live daemon took 2 to 7 s to answer.
- **On the live instance, after #46** (the coordinator's reading of 2026-11-11):
  - `/api/state` answers in 15 to 39 ms;
  - with 8 more pages open, in 13 to 30 ms;
  - before #46, the same reading peaked at 2.2 to 6.8 s, and `rusuban status` said "not answering"
    one time in three.
- **On a copy of the instance, the bench of #46** (state asked every 250 ms, a GitHub read, then a
  judge at work), at the 95th percentile:
  - with 3 pages: from 84 to 95 ms (max 1.36 s) down to 32 to 36 ms (max 78 ms);
  - with 8 pages: from 1.5 s down to 32 ms.
- **A step that holds the daemon over 300 ms is said in its log**, so a slow dashboard names its
  cause.

## The suite at this check

- **Unit tests** (`node --test`): 272 pass, 1 skipped (the macOS-only `plutil` check, on this Windows
  machine), 0 fail.
- **Click tests** (Playwright, desktop and phone widths): 31 pass, 1 skipped (the project switcher is
  the desktop's), 0 fail.
- **Lint** (Biome): clean.
- **CI** on each PR: the unit tests on Ubuntu, macOS and Windows with Node 22 and 24, and the click
  tests.
