# FAQ

## Rules

### Does Rusuban do anything before I write rules?

No. A repo without `.rusuban/rules/*.md` is observed only: its items show in the dashboard, no agent
judges them, nothing merges, and nothing is written on GitHub on the agents' own initiative. Your own
requests and tasks still run.

### Where do the rules go?

In `.rusuban/rules/*.md` on the default branch of each repo, with an optional `.rusuban/locks.json`.
Rusuban reads them nowhere else. See [Writing rules](writing-rules.md).

### Can a PR change the rules it is judged by?

No. Rules are read from the default branch only, and a PR that touches `.rusuban/` never merges alone.

### When does a rules change apply?

At the next read of the repo, 90 seconds by default, without a restart. Runs already at work keep the
rules they started with. The change is journaled with its diff and flagged in your inbox.

### What do the agents do where my rules say nothing?

They ask you on a card, with an option to turn your answer into a rule.

### How do I try rules without risk?

A new project starts in shadow mode: agents judge and propose, every GitHub write is denied, nothing
merges. Run `rusuban project mode <id> live` once you trust them. `rusuban start --dry` goes further:
the dashboard reads and shows, and starts no agent.

## Merges

### Can an agent merge?

No. Only the server merges, after its [gates](locks.md), on the exact head it checked.

### Why did a PR not merge?

Its node shows the first gate that stops it, and its drawer lists them all. Common reasons: merges are
paused, it was judged not to merge alone, a lock, CI not green yet, or GitHub refused the merge.

### How do I merge a PR the locks stop?

Pick its card's merge option: the server merges that head once CI, threads and conflicts allow (see
[merge orders](locks.md#merge-orders)). Or merge it yourself on GitHub, and Rusuban flags it as a merge
it did not make.

### My branch requires an approving review. Can the server merge?

Not on its own: GitHub refuses, the refusal goes on a card, and that head is not tried again. The
[approval bypass](security.md#the-approval-bypass) lets the server merge with `--admin` in a project,
after it checks the branch's other rules.

### How do I stop everything?

- **The switch** in the dashboard's header pauses the server's merges in every project. A merge order
  you give on a card still runs.
- **The Agents view** stops a run.
- **`rusuban project mode <id> shadow`** stops the project's merges and denies every GitHub write to
  its next runs.

## Your machine and accounts

### What runs on my machine, and where?

Headless `claude -p` sessions, under the [host profile](security.md#the-host-profile) you chose. The
judge, the coordinator and tasks work in `~/.rusuban/scratch/<project>/`, unless a task names its own
folder. Each worker gets a worktree of Rusuban's own clone of the repo, never your checkout.

### Whose Claude plan do the agents use?

Yours: they run on your `claude` login, within its usage limits. A run that hits a limit waits for the
reset, and the dashboard says until when.

### Who do the agents act as on GitHub?

You. They use your `gh` login, so their comments and PRs appear under your account.

### Where is the state?

In `~/.rusuban/` (`RUSUBAN_HOME` overrides it), never in your repos.

### Can several people share an instance?

No. An instance is one person's, and every card shows in its owner's inbox. A card can name another
GitHub login, and then says so.

### Can I use another forge, or another agent?

No. GitHub only, through `gh`, and Claude Code only.

### In what language do the agents write?

Your rules may be in any language. Cards, the journal and final answers are in English; messages on
GitHub follow your rules.
