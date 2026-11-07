# Reflection: several machines, several people

**Status**: decided on 2026-11-07 for P1 to P4 (see the last table); P5 and P6 stay open until after v1.
Asked for during the spec: "start thinking about multi-user collaboration, and about making access to
several machines standard: reaching several machines for e2e tests is what makes the current system
effective."

## Why this matters

The OpenScreen pilot is effective because one host reaches a Mac, a Linux laptop, a Windows PC and a
desktop over SSH and Tailscale, so agents run real end-to-end tests on every platform. All of it is hand
made: SSH aliases, checkouts, toolchains, and OS tricks written into prompts. Rusuban should make it a
standard a new maintainer sets up in minutes, and that several maintainers can later share safely.

## Part 1: machines

### What a test machine is (the contract)

- **Reachable**: an OpenSSH server behind a stable name. Tailscale is recommended (names that work
  across networks, no port forwarding), not required.
- **A dedicated agent account**: a `rusuban` user, key-only login, no admin rights where the tests allow.
  Agents never work in a person's own account or checkout.
- **A workspace**: `~/rusuban/<project>/`, holding a bare mirror of the repo and one git worktree per run.
- **Capabilities**: tags such as `os`, `arch`, `gpu`, `display`, `webcam`, `mic`, `screen-capture`.
  Detected when possible, declared otherwise.
- **The toolchain** a project needs is project knowledge: it goes in the project's rules, and
  `machine doctor` checks it.

### The hard part: graphical tests over SSH

A process started over SSH does not reach the logged-in desktop, on any OS:

- **Windows**: OpenSSH children run in a non-interactive session; a GUI app never shows. The usual fix is
  a scheduled task marked interactive, run in the logged-in user's session.
- **macOS**: SSH runs outside the GUI session; `launchctl asuser <uid>` gets in, and screen recording or
  accessibility permissions must already be granted to the binary that asks.
- **Linux**: the job needs the user's `DISPLAY` or `WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR` and session bus.

Today each project solves this by hand (OpenScreen: node-driven clicks on the Mac, Windows tasks). Four
ways to make it standard:

| Option | How | For | Against |
|---|---|---|---|
| **A. SSH only** | Rusuban gives SSH, leases, worktrees; how to start a GUI test stays in the project's rules and scripts | nothing to install on machines | every project solves the OS quirks again |
| **B. A Rusuban runner** | a small process started at login inside the user session of each machine (same installers as the host); it runs jobs in that session, takes screenshots and recordings, streams logs back over SSH | GUI tests become the same on the three OSes; screenshots and videos become evidence agents can read | software to install and keep up to date on each machine; a new attack surface |
| **C. Remote desktop driven from the host** | a VNC or RDP window on the host, operated by computer-use | nothing new on the machines | takes the host's own desktop, slow, one machine at a time |
| **D. GitHub self-hosted runners** | each machine is a runner with labels; agents dispatch workflows | standard, queues and artifacts for free | GitHub advises against self-hosted runners on public repos (forks run code on them); same GUI-session problem; minutes of latency |

**Recommendation**: A in v1, as planned, and B as the industrialization step right after v1. B is what
turns hand-made e2e into a standard, and its screenshots and recordings feed the `evidence` locks
(pixel-identical export, timings).

### Enrollment

- `rusuban machine add <alias>`: SSH in batch mode, OS and arch, git, disk space, the workspace and the
  bare mirror; capabilities detected or asked.
- `rusuban machine doctor <name>`: the same checks plus the project's toolchain and, for GUI machines, a
  logged-in session and the needed permissions.
- Documented setup scripts per OS (PowerShell, bash): OpenSSH server, the `rusuban` user, the host's key.
  Opt-in: Rusuban never changes a machine's system settings on its own.

### Leases

- v1 as planned: exclusive leases with expiry, a FIFO queue, matching by capability.
- **Proposal**: keep the lease **on the machine itself** (an atomic `mkdir` in the workspace over SSH,
  holding the run, the instance, the expiry) instead of on the host. Same cost in v1, and it is what
  lets two instances share a machine later with no server: the machine is the only truth about who
  holds it.
- Later: shared slots for headless jobs (builds) next to the exclusive GUI slot.

## Part 2: several people

| Level | What | When |
|---|---|---|
| **L0 Solo** | one instance; every owner and card already names a GitHub login | v1 |
| **L1 Several maintainers, one instance each** | instances coordinate through GitHub | after v1 (US8) |
| **L2 Shared machines** | a maintainer lends a machine to another's instance | after L1 |
| **L3 Team server** | one shared server, API key, accounts | not planned: revisit on demand |

### L1: how instances stay out of each other's way

- **Claims**: before working on an item, an instance assigns its owner on GitHub and adds a
  `rusuban:working` label; it removes both when the run ends. Others skip claimed items. GitHub
  assignment is not atomic, so a rare double start is possible; merges stay safe because the merge pins
  the head commit and GitHub serializes them.
- **Who judges**: today every instance would judge every item, twice the cost and possibly two
  verdicts. Proposal: the instance that claims an item judges it and posts a short machine-readable
  summary (owner, next step) where the others can read it, for instance a hidden comment.
- **Routing**: the shared rules name people per area (`@alice owns translations`). Each instance shows
  and pings only the cards addressed to its owner.
- **Rules**: one set, in the repo, changed only through a human-merged PR. Personal settings (channels,
  quiet hours, machines) stay in each instance.

### L2: lending machines

- Tailscale already lets someone share one device with another person's tailnet.
- With leases on the machine, the borrower's instance takes a lease like the owner's does.
- The lender keeps control: borrowers listed per machine, their keys on the `rusuban` account only,
  sharing revoked in one step, and every borrowed run journaled on both sides.

## Changes to the spec

| # | Change | Status | Touches |
|---|---|---|---|
| P1 | Leases stored on the machine (atomic `mkdir` over SSH) | **decided, v1** | research R9, data model (Lease), T068 |
| P2 | A `workspace` per machine with a bare mirror and per-run worktrees, replacing `checkout` | **decided, v1** | data model (Machine), T066 |
| P3 | A `rusuban` agent account and `machine doctor`; documented setup scripts | **decided, v1** | FR-064, T066, T079 |
| P4 | The Rusuban runner for GUI jobs, screenshots and recordings (option B) | **decided, right after v1** | a new story |
| P5 | Claims, claimer judges, routing per owner (L1) | open, after v1 | US8 |
| P6 | Machine lending (L2) | open, after L1 | a new story |
