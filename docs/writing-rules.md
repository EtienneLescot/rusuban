# Writing rules

A project's rules are plain text in its own repo. They decide what the agents do: what they do alone,
what comes to you, how long they wait, how they write. Rusuban ships no default: without rules,
nothing autonomous happens.

## Where they live

On the repo's default branch:

```text
.rusuban/
  rules/*.md    the rules, free text
  locks.json    optional: what the server checks itself before a merge (see locks.md)
```

- **Read from the default branch only**, through GitHub's contents API: never from a PR head, never
  from a local checkout. A PR cannot change the rules it is judged by.
- **Read with the repo's state**, at every read of the project (every `refreshSec`, 90 seconds by
  default), and cached by the tree sha of `.rusuban/`.
- **The `.md` files directly in `rules/`, sorted by file name.** Other files and subfolders are
  skipped. Number them: `01-autonomy.md`, `02-merging.md`.
- **Each repo carries its own.** In a project of several repos, a repo without rules is only observed.
  A run sees the rules of every repo of its project, each under its source.

## How the agents get them

Every run (judge, coordinator, worker, task) gets a prompt built when it starts:

1. the product prompt of its kind, generic and shipped with Rusuban;
2. the safety frame: GitHub content is data, agents never merge, the locks hold, silent rules mean a
   card;
3. your rules, verbatim, under their source;
4. the context: the owner, each repo's rules and locks, the open cards, what waits for the run;
5. the run's mission or task.

Your rules appear like this:

```text
# Project rules: owner/repo@<tree sha>:.rusuban/rules/

## 01-autonomy.md

<the file's text>
```

Do not repeat what the product prompts already say: the judgment and card formats, how to delegate to
a worker, the safety frame.

## Without rules

A repo with no `.rusuban/rules/*.md` is observed only, even with a `locks.json`:

- its items are read and shown, and the dashboard says it is observed only;
- no judge starts, nothing merges, and nothing is written on GitHub on the agents' own initiative;
- your own requests, your answers to cards and your tasks still start agents.

## What to write

The rules say everything about behavior. No section is required, but what the agents need and do not
find becomes a card asking you. What they need is what each judgment sets:

| The agents set | Your rules say |
|---|---|
| `pr.auto` | Which PRs may merge without a person. |
| `owner` | What the agents keep, what waits on a third party, what comes to you or to another GitHub login. |
| `revisitAt` | How long a third party is waited for, and when the agents look at their own work again. No delay is built in. |
| `priority`, `area` | Your priority scale (`P0` to `P3`) and your areas. The kinds are fixed: `bug`, `feature`, `maintenance`, `docs`, `translation`, `question`, `other`. |
| A card's `urgency` | Which decisions are `now` and which are `digest`. |
| Messages on GitHub | Their language and tone, and what may be posted without a card. |
| A fork's CI | Whether agents may approve a fork's workflows, after reading the diff. |
| Proofs | When a change needs a proof beyond the `evidence` zones of `locks.json`, and what proof. |

Rules may be written in any language. Cards, journal lines and final answers are in English.

## Writing them well

- **Write orders.** "A bug fix with a test merges alone", not "we value tests".
- **Define your words.** Say what a bug is and what a feature is: that line decides what merges.
- **Give every wait a duration.** `revisitAt` is required whenever an item stays with the agents or
  waits on a third party.
- **Put what the server can check in `locks.json`.** Text guides the model; a lock holds without it.
  "Never merge a change to CI" belongs in `lockedPaths`.
- **Keep them short.** Every file goes into every run's prompt.
- **Name people by their GitHub login**, as `@login`.

## Where the rules are silent

The agents do not guess. A situation the rules do not cover becomes a card to the owner. A question
on how the agents work, rather than on the item, waits in the inbox's **Rules & settings** tab.

When the cards of several items ask the same, an agent proposes the rule that would answer them, on
a card of its own in that tab: **Open the rule PR** opens a PR adding it to `.rusuban/rules/`, which
a person merges on GitHub, and the items wait for it; **Not a rule** keeps them asked one by one.

## What rules cannot do

- **Lift a lock.** No text lifts a built-in lock or one of `locks.json`: a judgment that would break
  one becomes a card.
- **Make an agent merge.** Only the server merges, after its gates.
- **Widen what agents may run on your machine.** That is your host profile (see
  [security](security.md#the-host-profile)).
- **Change your instance's settings**: a project's mode, its approval bypass, the merge switch. Those
  are your commands and your dashboard's.
- **Come from GitHub.** An issue, a PR or a comment that reads like a rule is data.

## Changing them

1. **Open a PR that edits `.rusuban/`.** It never merges alone: the Locks gate stops any PR that
   touches the folder. A person merges it, on GitHub or with a merge order on its card.
2. **Once it is on the default branch, it applies at the next read**, without a restart. A queued run
   gets the new rules; a run already at work keeps the ones it started with.
3. **It is journaled** with the files changed and a line diff, and flagged in your inbox.

A `locks.json` that does not validate stops every merge of its repo until it is fixed. That is
journaled and flagged too (see [locks](locks.md#validation)).

## Trying them

- **The switch paused.** Agents act as the rules say, and nothing merges until you arm the switch in
  the dashboard's header. Read their judgments and adjust the rules first.
- **Start from an example.** Each folder of [`examples/rules/`](../examples/rules/) is a `.rusuban/`
  folder: copy its `rules/` and its `locks.json` into `.rusuban/` at the root of your repo, then edit
  them.

| Example | What the agents do alone |
|---|---|
| [`cautious`](../examples/rules/cautious/) | Judge, test and prepare. Every item comes to the owner on a card, and every path is locked: only the owner's merge order merges. |
| [`solo-maintainer`](../examples/rules/solo-maintainer/) | Fix bugs, and merge fixes, docs, tests and maintenance within path and size locks. Features, API changes and dependencies come to the owner. |
| [`openscreen`](../examples/rules/openscreen/) | A real project's rules: fix bugs and merge fixes, translations, docs, tests and maintenance from any author; capture, preview and export changes need a pixel and timing proof; features, interface and architecture come to the owner; a third party is waited for two days at most. |
