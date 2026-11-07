# Quickstart and validation

How a first user gets going, then how each success criterion of the spec is checked.

## First run

```bash
npx rusuban init
```

1. `init` finds the `gh` and `claude` logins, takes the owner login from `gh`, and asks how agents may
   use this machine: a tool allowlist or full bypass.
2. It asks for a first repo (`owner/repo`) and its local checkout, installs the service, and opens the
   dashboard at `http://127.0.0.1:8788`.
3. With no `.rusuban/rules/` in the repo, the dashboard shows the items and the conversations, and says
   how to add rules. Nothing is written on GitHub.
4. Optional: `rusuban remote enable` (Tailscale), `rusuban channel add ntfy <topic>`,
   `rusuban machine add mac`.

## Validation

| Criterion | How it is checked |
|---|---|
| SC-001 install under 10 min | A clean VM per OS (Windows, macOS, Linux) with `gh` and `claude` logged in: time from `npx` to the dashboard showing a public repo. |
| SC-002 OpenScreen with no specific code | `grep -ri openscreen src/ web/ bin/` finds nothing; the OpenScreen project runs from its rules, locks, machines and tasks only, and matches the old pilot's judgments during the shadow week. |
| SC-003 conversations within 1 min, 90 % linked | Open sessions in Desktop and the terminal on 10 known items; measure the time until they appear and count the correct links. |
| SC-004 3 taps from a ping | On a phone over Tailscale: notification → card → option. |
| SC-005 no merge with a lock broken | Adversarial fixtures in the test suite: a PR editing `.rusuban/`, injected instructions in a body, red CI, a moved head, a locked path, a missing evidence. Each must stay unmerged, with the gate that stopped it. |
| SC-006 leases | Two workers asking for the same machine: the second waits; kill the first: the lease is freed at expiry. |
| SC-007 enrollment under 5 min | `rusuban machine add` on a fresh SSH host until it shows online. |

## Switching OpenScreen (the first user)

1. Write OpenScreen's rules and locks from `tasks/judge.md`, `tasks/act.md` and the constitution, and
   propose them to `getopenscreen/openscreen` as `.rusuban/` (a PR Etienne merges).
2. Register `mac`, `vivobook`, `sarae` and Etienne's desktop (`--owner EtienneLescot`); move the
   `publications` and `n8n-series` tasks to the instance.
3. Shadow week: the new pilot observes; its judgments are compared with the old pilot's.
4. Switch: the new service replaces the `OpenScreenDashboard` and `OpenScreenTasks` Windows tasks, the
   shortcuts are repointed, and `.claude/pilot` is archived.
