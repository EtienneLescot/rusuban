# Validation (T082)

Checked on 2026-11-08, on main at `1b91134` with T125 on top, against the table of `quickstart.md`.
What needs Etienne's machines or phone is marked "to do", with the reason.

| Criterion | Result | Where it stands |
|---|---|---|
| SC-001 install under 10 min | To do | Needs clean Windows, macOS and Linux machines (T078). |
| SC-002 no OpenScreen-specific code | Pass, in part | The grep finds nothing. Running from OpenScreen's rules waits for getopenscreen/openscreen#1507. |
| SC-003 a session in the hub within 1 min, 90 % linked | Time: pass. Links: on fixtures | Real data: about 30 s. The 90 % holds on fixtures; on real data it needs a labelled sample. |
| SC-004 3 taps from a ping | To do | Needs Etienne's phone over Tailscale (T106, T108). |
| SC-005 no merge with a lock broken | Pass | 36 gate tests and the cycle's switch tests. |
| SC-006 never two agents on a machine | Pass, on tests | 18 machine tests. The live proof on the Mac (T112) is to do. |
| SC-007 enrolling under 5 min | To do | Needs a fresh SSH machine and Etienne's go (T112). |

## SC-001: install under 10 minutes

**To do (T078).** It is timed on clean Windows, macOS and Linux machines, with `gh` and `claude`
logged in, from `npm i -g rusuban` to the dashboard showing a public repo.
- Those machines are Etienne's (`ssh mac`, `vivobook`, `sarae`). `init` installs a service there, so
  nothing runs on them without his word.
- Ahead of it, the coordinator's smoke test of the package passed: `npm pack`, then a global install
  in a temporary folder; the page is served, `status` answers, GitHub is read.

## SC-002: OpenScreen on the generic product

- **Product code: pass.** `grep -ri openscreen bin src web` finds nothing (T052).
- **Running from its rules: waits.** OpenScreen's rules, locks and machines are proposed in
  getopenscreen/openscreen#1507, still open. Until Etienne merges it, Etienne's instance reads the
  project observe-only, in shadow mode, which is what a repo without rules gets.
- **The old pilot's judgments: replaced.** The shadow-week comparison was dropped on 2026-11-08 for
  Etienne's own trials (T050).

## SC-003: conversations in the hub

**The time: pass.** Measured on Etienne's instance, read only, on main at `1b91134`.
- It indexes **1,016 OpenScreen conversations**: 425 from Claude Desktop, 591 headless `sdk-cli`
  runs. None has a parse error.
- **A new session shows within about 30 s.** The hub runs a pass every 30 s, one at a time.
  - At the reading, the index was 6 s old.
  - This session was listed live, its last line indexed 1 s before the pass.
- **A pass is fast.** Over the same transcripts, in a temporary home, it read 1,016 files, 3.2 GB of
  the 11 GB in `~/.claude/projects`: 13.6 s cold, 0.2 s the next time. After a daemon start, the
  page shows the last index, with its age, while the first pass reads.

**The links: pass on fixtures, to do on real data.**
- `test/hub.test.mjs` checks that at least 90 % of the fixture sessions about an item are linked to
  it.
- On real data, 383 of the 1,016 conversations (38 %) carry an item. That is not SC-003's measure:
  it counts the sessions *about* an item, and saying which those are takes a person.
- `quickstart.md`'s check stays to do with Etienne: sessions opened on 10 known items, their links
  counted.
- These numbers come before EtienneLescot/rusuban#30, under which a compaction's summary no longer
  counts as citations.

## SC-004: three taps from a ping

**To do (T106, T108).** It needs Etienne's phone on his tailnet, with `remote enable` and a ping
channel, to count notification → card → option.
- The page's part is covered at phone width: a ping links to its card, and the click tests answer a
  card in two taps, its option then Send.

## SC-005: no merge with a lock broken

**Pass.** The 36 tests of `test/merge-gate.test.mjs` pass.
- **Six adversarial PRs**, each stopped by the gate its fixture names, never merged:
  - its own rules folder edited (Locks);
  - instructions injected in its body (Judgment);
  - red CI (CI);
  - a head moved after the judgment (Judgment);
  - a locked path (Locks);
  - a missing proof (Evidence).
- **29 single broken locks**, each stopped by its own gate, among them:
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
  - nothing merges paused or in shadow mode, not even a person's order;
  - a merge GitHub refuses is not tried again on that head, a restart included;
  - the approval bypass's guard stops on any rule it would skip or does not know.

## SC-006: one agent per machine

**Pass on the tests; the live proof is to do.** The 18 tests of `test/machines.test.mjs` pass.
- **Never two runs on one machine, however many ask at once.**
- **The queue:** two waiters are served in the order they asked.
- **Freeing:**
  - a holder that died frees the machine and its worktree;
  - a lease ends at `maxLeaseMin` even with its holder alive;
  - another instance's lease holds until its expiry.
- **The real lease scripts:** the sh and PowerShell scripts that hold a lease were run against a real
  folder.
- **The live proof (T112):** two runs on the real Mac through `ssh mac`. The second waits; killing the
  first frees the Mac at expiry. It waits for Etienne's go, since enrolling the Mac creates the
  `rusuban` account there.

## SC-007: enrolling a machine under 5 minutes

**To do (T112).** It is timed on a fresh SSH host, from the setup script of `docs/machines/` to
`rusuban machine probe` saying online.
- The scripts are syntax-checked (`sh -n`, PowerShell's parser), but not yet run on a real machine.
- They create an account there, so they run with Etienne.

## The suite at this check

- **Unit tests** (`node --test`): 249 pass, 1 skipped (the macOS-only `plutil` check, on this
  Windows machine), 0 fail.
- **Click tests** (Playwright, desktop and phone widths): 19 pass, 1 skipped (the project switcher
  is the desktop's), 0 fail.
- **Lint** (Biome): clean.
