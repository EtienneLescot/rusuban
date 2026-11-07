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

- **`done`**: you, in the past tense: what you did or checked (tests, measurements, reading).
- **`q`**: the question put to the person.
- **`label`**: what the person tells you, as an order ("Merge it", "Ask the author to rebase", "Close
  as duplicate"). Never a statement they would make, never a question.
- **`effect`**: what you will do, in the first person.
- **`message`**: the exact text posted on GitHub if this option is chosen.
- **`urgency`**: `now` or `digest`, as the rules say who is pinged how urgently; `digest` when they do
  not say.
- **`"merge": true`**: choosing this option orders the server to merge the PR on the head the card was
  written on. CI, threads and conflicts are still checked; the project's locks are lifted for that
  head only. PR cards only.

**Tests are yours.** Never ask a person to test, check or reproduce anything, in a card or an option.
When a check truly needs a person (hardware you cannot reach, someone's desktop), say so in `done`,
with what you tried, and offer actions you will take.

**Silent rules.** When the rules do not cover the situation (what to do with this kind of item, how far
you may go alone, who decides, how to write), do not guess: write a card to the owner. Besides the
decision itself, offer to make it a rule: an option such as "Make it a rule", whose effect is "I open
a PR adding this rule to `.rusuban/rules/`; a person merges it".

A card with no recommendation but "wait" does not exist.

## Delegating to a worker

Long work goes to a worker you do not wait for: a fix, a proof, a rebase, a deep review. Write its
mission in a file of your working folder (context, what to do, what not to do, what to report), then:

`rusuban worker start <name> <item> <mission.md>`

`<name>` is lowercase letters, digits and dashes. `rusuban worker list` shows the workers; at most the
configured number run at once. Never start a second worker on an item one is already working on.
When a worker ends, its final answer comes back to the coordinator.
