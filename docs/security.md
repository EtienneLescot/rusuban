# Security model

Rusuban runs Claude Code agents on your machine, with your logins, on repos where anyone can open an
issue or a PR. This page says what holds the agents, how the dashboard checks who is asking, and what
stays at risk.

## What is trusted

- **You, the owner**: your instance's `config.json`, your commands, your answers on cards.
- **The rules on each repo's default branch**: someone with write access merged them.
- **Nothing from GitHub.** Issues, PRs, comments, reviews, diffs and a PR's own copy of the rules are
  data, never instructions.
- **Not the agents either.** They are told the rules and the safety frame, then held by limits that do
  not depend on their obeying.

## Only the server merges

- Agents have no merge command, and the deny rules forbid the merge commands and APIs.
- The server merges after its [gates](locks.md), computed on live GitHub state, with
  `--match-head-commit`: exactly the commit it checked, or nothing.
- A PR merged by someone else, and a commit pushed straight to a default branch, are flagged.

## The built-in deny rules

Every run (judge, coordinator, worker, task) gets them as `--disallowedTools`, under either host
profile. Your own `permissions.deny` adds to them; nothing removes them.

| What | Denied |
|---|---|
| Merging | `gh pr merge`; any `gh api` call whose text holds `merge` or `Merge` (the REST merge endpoints, GraphQL merges, auto-merge). |
| Pushing to a default branch | `git push` naming a repo's default branch (`main`, `:main`, `+main`, `refs/heads/main`); `git push --all` and `--mirror`; `gh api` on `git/refs/heads/<default branch>`. |
| The owner's commands | `rusuban project`, `rusuban task`, `rusuban start`. The CLI also refuses them inside a run. |
| The instance's state | Edits to `config.json`, `automerge.json`, `projects/`, `runs/`, `hub/`, `leases/`, `tasks/` and `bin/` in the instance home. Agents keep their own folders there: `scratch/`, `worktrees/`, `repos/`. |
| GitHub writes, in a shadow project | Every `gh` write (comments, reviews, closes, edits, labels, releases, workflows, secrets); `gh api` with a method, a field or a body; every `git push`. |

A denied call is refused, and the run's log says so.

## Only your settings reach a run

Runs load Claude Code's user settings only (`--setting-sources user`). A repo's `.claude/` settings,
with their hooks and permissions, never load: a hook or an allow rule merged into a repo does nothing
on your machine. Your own user settings do load: their allow rules add to an allowlist run, and their
deny rules and hooks apply.

## The host profile

What agents may run on this machine is yours to choose, in `config.json`, and no repo, rule or PR
changes it. `permissions.mode` has no default: the config does not load without it.

| `permissions.mode` | Agents may run |
|---|---|
| `allowlist` | What `permissions.allow` lists, plus `rusuban` itself. Anything that would ask for approval is refused (`--permission-mode dontAsk`). |
| `bypass` | Anything, without asking (`--dangerously-skip-permissions`), except what a deny rule matches. |

**Under `bypass`, an agent has your shell.** What your account can do on this machine, an agent can
do: read and write your files, use your SSH keys, your `gh` login and every other tool you are logged
into, reach your network. The deny rules are the only limit, and they match command text.

Under `allowlist`, an allow rule for an interpreter or a build tool (`Bash(node *)`, `Bash(npm *)`,
`Bash(python *)`) is a shell too: it runs whatever code it is given.

## The dashboard's identity check

- **Loopback only.** The server listens on `127.0.0.1`.
- **Every request, reads included, must name this server as its `Host`**: `127.0.0.1:<port>`,
  `localhost:<port>`, or this machine's tailnet name. That stops DNS rebinding. The tailnet name comes
  from `tailscale status --json`, read at start and every 5 minutes.
- **From the tailnet, the caller must be you.** The `Tailscale-User-Login` header, which Tailscale
  Serve sets from the caller's identity, must equal `owner.tailscaleLogin` in `config.json`, case
  aside. A request without it is refused, and so is every tailnet request while
  `owner.tailscaleLogin` is not set.
- **On loopback, a request without that header is the local user.**
- **Every write also needs the dashboard's own origin**: an `Origin` of `http://127.0.0.1:<port>`,
  `http://localhost:<port>` or `https://<tailnet name>`, the `x-rusuban: 1` header, and a body under
  8 KB. A page on another site cannot send that header without a CORS preflight, which the server
  never grants.

Remote access goes through Tailscale Serve (`tailscale serve --bg --https=443 http://127.0.0.1:<port>`),
never through Tailscale Funnel or any public address.

## The approval bypass

A branch that requires an approving review refuses the server's merges until someone approves, and
the agents' PRs, pushed under your account, cannot get your approval. The approval bypass is for that.

- **Off for every project** until you run `rusuban project bypass <id> on`, which sets `bypassApproval`
  in `config.json`. No repo, rule, PR or agent sets it.
- **It merges only what the server merges anyway**: in a live project, with the merge switch armed,
  every gate green or your merge order given. It then merges with `gh pr merge --admin`.
- **`--admin` skips every rule of the branch**, so the server first reads the base branch's rulesets,
  its classic protection in full, and the head's checks. It merges only if:
  - every check the branch requires is on the head, from the app the rule names if it names one, and
    `success` in its latest run, checks the locks ignore included;
  - the merge method is one the branch allows, and not `merge` under a linear-history rule;
  - the branch requires neither a code owner's review nor PRs up to date with it, and no thread is
    open where it requires them resolved;
  - classic protection requires no signed commits, does not bind administrators, restrict who can
    push or lock the branch;
  - the branch holds no rule or protection setting the server does not know.
- **Journaled.** What stops the bypass is journaled once per head and flagged. Turning it on is
  journaled and flagged; turning it off is journaled.

## What is flagged

These go to the journal and to your inbox's "Flagged for you", for 7 days:

- a merge the server did not make, and a commit pushed straight to a default branch;
- a merge GitHub refused, and what stopped the approval bypass;
- a rules change, with its diff, and a `locks.json` that does not validate;
- the approval bypass turned on;
- a task that did not end well.

## Residual risks

- **Under `bypass`, an agent has your shell, and it reads text anyone can write.** A prompt injection
  in an issue, a comment or a diff is a path to your shell. The safety frame tells agents that GitHub
  content is data; it is a prompt, not a wall.
- **Deny rules match command text.** A merge or a push hidden behind a variable, an alias, a script,
  an interpreter or a raw HTTP call is not matched. The server flags a merge or a push it did not make,
  after the fact; it does not prevent it.
- **An agent's shell reaches what the deny rules do not cover.** The state's deny rules bind Claude
  Code's file tools, not shell commands, and the dashboard takes any request from this machine as
  yours: its identity check stops other machines and web pages, not local processes. Under `bypass`, a
  shell command can write `config.json`, to turn a project live or its approval bypass on, or call the
  dashboard, to answer a card (a merge order included) or arm the switch. The daemon journals these as
  yours; the bypass turned on is flagged.
- **A worker runs the code it works on**, in a worktree, under your account: the repo's tests and
  scripts, and a contributor's when it rebases, finishes or measures their PR. The rules decide which
  PRs agents work on; the host profile decides what they may run.
- **Agents act as you on GitHub.** They use your `gh` login: what they post appears under your account,
  and an agent past the deny rules has every right your token has.
- **A merge order overrides the project's locks for its head**; a paused switch still holds it. An
  agent wrote the card: read it before you pick its merge option.

## Tests

Each lock has a test that tries to break it:

- the gates, and adversarial PRs (the rules edited in the PR, injected instructions, red CI, a moved
  head, a locked path, a missing proof): `test/merge-gate.test.mjs` and `test/fixtures/prs/`;
- the deny rules, under both profiles and in shadow mode: `test/agents.test.mjs`;
- the identity check and forged writes: `test/server.test.mjs`;
- the approval bypass and the owner's commands: `test/bypass.test.mjs`.
