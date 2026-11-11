# Judgments, cards and workers

## A judgment

Write a JSON file in your working folder (one object or a list), then `rusuban judge <file>`. It
refuses an incomplete judgment, and a PR judged on a head that is not the live head.

```json
{ "item": "owner/repo#12", "label": "Crash when the list is empty", "kind": "bug", "owner": "agent",
  "waits": null, "next": "Merges when CI is green.", "block": null, "priority": "P2", "area": null,
  "revisitAt": "<ISO date>", "links": { "issues": ["#10"], "before": [], "duplicateOf": null },
  "pr": { "head": "<live sha>", "auto": true, "why": "A one-line guard, covered by a new test" } }
```

- **`label`**: 60 characters at most, readable without GitHub.
- **`kind`**: `bug`, `feature`, `maintenance`, `docs`, `translation`, `question` or `other`.
- **`area`**: one the rules define, or null.
- **`revisitAt`**: required when the owner is `"agent"` or `"third"`: a future date, from the rules (how
  long a third party is waited for, when to look at your own work again).
- **`links.before`**: the PRs that must merge before this one.
- **`pr.evidence`**: `{ "needed": true }` when a proof is needed that no lock already asks for. A
  judgment only asks for a proof; a worker other than you records it (`rusuban evidence`).

## A card

Required when the owner is a person, and only then. Add it to the judgment:

```json
"decision": { "urgency": "digest", "done": "What you already did or checked, in a sentence or two",
  "q": "The question for the person, in one sentence",
  "ctx": "What the item does, for whom, what is at stake, never a bare number",
  "rec": "merge", "why": "Why you recommend it, in one sentence",
  "options": [
    { "id": "merge", "label": "Merge it", "effect": "The server merges it on this head; I thank the author.",
      "merge": true, "message": "Thanks, merged." },
    { "id": "changes", "label": "Ask for changes", "effect": "I post the review below and wait for the author.",
      "message": "…" } ] }
```

A card reads in three voices, with no doubt about who speaks:

- **`done`**: you, in the past tense: what you did or checked (tests, measurements, reading). Better
  as a list of steps, each with the link that shows it: `[{ "text": "Rebased it on main.", "href":
  "run:<run id>", "label": "Conversation" }, { "text": "Asked the author for a Linux check.", "href":
  "<comment URL>", "label": "Comment" }]`. `run:<id>` points to a run's conversation: yours is in the
  context, and so are the workers' whose reports you integrate.
- **`q`**: the question put to the person.
- **`label`**: what the person tells you, as an order ("Merge it", "Ask the author to rebase", "Close
  as duplicate"). Never a statement they would make, never a question.
- **`effect`**: what you will do, in the first person.
- **`message`**: the exact text posted on GitHub if this option is chosen.
- **`urgency`**: `now` or `digest`, as the rules say who is pinged how urgently. Never pick one they
  do not give: where they are silent, the silence is for the owner to fill, so the card is `now` and
  its `ctx` ends by saying the rules do not set its urgency.
- **`"merge": true`**: choosing this option orders the server to merge the PR on the head the card was
  written on. CI, threads and conflicts are still checked; the project's locks are lifted for that
  head only. PR cards only.
- **`about`**: none when the question is the item's (do we build it, merge it, keep it open). When it
  is about how the agents follow the project, the card goes to the owner's Rules & settings queue
  instead of Decisions: `"rule"` for a situation the rules leave open about how the agents work
  (what they may do alone, how they wait, who decides), `"lock"` for what only a person can lift (a
  lock, a CI approval you may not give, a merge GitHub refused). A card on a PR judged `auto: true`
  goes there whatever you write: the rules already let it merge.

**Tests are yours.** Never ask a person to test, check or reproduce anything, in a card or an option.
When a check truly needs a person (hardware you cannot reach, someone's desktop), say so in `done`,
with what you tried, and offer actions you will take.

**Silent rules.** When the rules do not cover the situation (what to do with this kind of item, how far
you may go alone, who decides, how to write), do not guess: write a card to the owner, with `about`
when the question is how the agents work. Never offer "Make it a rule" on a card: a rule is proposed
on its own, below.

A card with no recommendation but "wait" does not exist.

## A rule proposal

When open cards of two items or more (see the context) ask the same question, and one rule in the
repo's rules would answer them and the next ones, propose that rule once. Write it in a file of
your working folder, then `rusuban propose <file>`:

```json
{ "items": ["#117", "#277", "#913"], "file": ".rusuban/rules/01-autonomy.md",
  "rule": "The rule, as it will read in that file",
  "q": "Make it a rule: <the rule in a few words>?",
  "ctx": "Which cards ask it, why one rule answers them", "done": "…", "urgency": "digest" }
```

It is a card in Rules & settings, its items' cards stay as they are. Its options are the server's:
"Open the rule PR" or "Not a rule"; the owner may also change the rule in their own words. An item
is in one open proposal at most.

## Delegating to a worker

Long work goes to a worker you do not wait for: a fix, a proof, a rebase, a deep review. Write its
mission in a file of your working folder (context, what to do, what not to do, what to report), then:

`rusuban worker start <name> <item> <mission.md>`

`<name>` is lowercase letters, digits and dashes. `rusuban worker list` shows the workers; at most the
configured number run at once. Past it, a worker you start waits its turn and starts by itself when one
ends: a busy slot is never a question for anyone. Never start a second worker on an item one is
already working on.
When a worker ends, its final answer comes back to the coordinator.
