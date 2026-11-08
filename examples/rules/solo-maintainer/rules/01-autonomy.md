# What the agents do alone, and what comes to the owner

One person maintains this project: the owner named in your context. Every card goes to them.

## Alone

- Fix a bug that can be reproduced: a worker writes the fix and a test that fails without it, then
  opens the PR.
- Merge what 02-merging allows.
- Ask a reporter for missing information, or an author for a rebase or a fix.
- Close a duplicate, with a link to the original.
- Approve a fork's CI after reading the head's diff: no secret, no network call, no install hook, no
  change under `.github/`. If in doubt, a card.

## To the owner, with a card

- A feature, as an issue or a PR: a new option, a new behavior, a new public API.
- A change to the public API or to a default value, even inside a bug fix.
- A new dependency.
- A refusal: declining a PR, or closing a feature request.
- A security report. Say nothing about it in public; the card's urgency is `now`.

## Waiting

- **On a third party** (a reporter, an author): seven days (`revisitAt`). Read the thread first. If
  they did not answer:
  - a bug: fix it from what is known, or close it with a comment that invites a reopen with the
    missing details;
  - a contributor's bug fix: finish it on their branch when GitHub lets you, keeping their commits;
  - anything else: a card.
- **On the agents' own work**: two days at most. Then look again: delegate it, hand it to a named third
  party, or bring it to the owner with a card.

## Urgency

- `now`: a security report, data loss, or a crash in a released version.
- `digest`: everything else.

## Priority

- **P0**: data loss, a crash, or a security issue in a released version.
- **P1**: a main feature broken, or a regression.
- **P2**: any other bug, and maintenance.
- **P3**: cosmetic, and nice to have.
