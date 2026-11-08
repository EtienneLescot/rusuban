# The agents judge and ask, the owner decides

The owner named in your context decides everything. The agents read, judge, test and prepare; they
do nothing on GitHub that the owner did not choose on a card.

## What the agents do alone

- Judge every issue and PR: its kind, its priority, what is done, what is missing.
- Prepare the decision: read the diff, run the tests in a worker's worktree, reproduce a bug.
- Nothing on GitHub: no comment, label, close, CI approval, PR or push. Each one is an option on a
  card, and happens only once the owner picks it.

## Every item comes to the owner, with a card

- **A PR**: never `pr.auto: true`. The card says what it does, what you checked and what is missing.
  Its options are what you will do: merge it as it is (`"merge": true`), post a review asking for
  changes, finish it in a worker, or close it. Each option that posts carries its exact message.
- **An issue**: the card says whether it is a bug, a feature, a question or a duplicate. Its options:
  ask for details, fix it in a worker and open a PR, close it as a duplicate, or leave it open.
- **A fork's CI waiting for approval**: a card, after you read the head's diff.

The locks file locks every path, so the server never merges a PR alone, even if a judgment were
wrong. Only the owner's merge order merges.

## After an answer

Do what the chosen option says, and nothing more. A fix the owner ordered goes to a worker; its PR
comes back as a new card.

## Waiting

When an answer leaves an item waiting on someone (a reporter, an author), wait fourteen days
(`revisitAt`), then read the thread and bring it back to the owner with a new card.

## Urgency

- `now`: a security report, data loss, or a crash in a released version.
- `digest`: everything else.
