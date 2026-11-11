# Locks

Locks are what the server checks itself, on live GitHub state, before it merges. No model is asked
and no text lifts them. Some are built in and hold in every project; a repo adds its own in
`.rusuban/locks.json`.

## The gates

For every open PR the server computes eight gates. The PR's node shows the first one that stops it,
and its drawer lists them all. A PR merges alone only when every gate passes.

| Gate | Stops a merge when |
|---|---|
| CI | There is no check on the head, or only ignored ones; a check failed, was cancelled or timed out; a check is still running or waits for an approval, such as a fork's workflow; a required check is missing, or was only skipped. |
| Reviews | A reviewer's latest review of the head requests changes; a required reviewer has not reviewed the head. |
| Threads | A review thread is unresolved. Threads past the first hundred count as unresolved. |
| Mergeable | The PR is a draft, conflicts with its base, or GitHub has not computed it yet; for a rebase merge, it cannot be rebased. |
| Judgment | The repo has no rules; the PR is not judged, or was judged on another commit; it was judged not to merge alone (`pr.auto: false`). |
| Locks | It touches `.rusuban/` or a locked path; it is over the size limits; it renames a file; it changes more files than GitHub lists (100); the repo's `locks.json` does not validate. |
| Evidence | It touches an `evidence` zone, or its judgment asked for a proof, and no successful proof is recorded on its head. |
| Switch | Merges are paused. |

## Built-in locks

They hold in every project, and no setting lifts them:

- **CI green on the exact head**: at least one check; every check run and status `success`, `neutral`
  or `skipped`; none pending, failed, cancelled, timed out or waiting for an approval.
- **No open review thread.**
- **The head unchanged since the judgment**: a new commit sends the PR back to the judge.
- **No conflict**, and rebaseable when the repo merges by rebase.
- **`.rusuban/` never changes without a person**: a PR that touches it never merges alone. A person
  merges it on GitHub; the agents never judge it, and the dashboard lists it under **Rules &
  settings**, out of the graph and the kanban.
- **No direct push to a default branch**: denied to agents, and a commit that reaches the branch outside
  a PR is flagged.
- **The merge switch**, in the dashboard's header, for the whole instance. Merges start paused.

The server also refuses on its own a draft, a PR with changes requested on its head, a PR that renames
a file (a rename could move a file out of a locked path unseen), and a PR whose files it cannot all
see.

## How the server merges

- **At most one merge per read of the project.**
- **A person's merge order first**, then a PR judged `auto` on its head whose every gate passes, the
  switch read again just before.
- **Exactly the head it checked**: `gh pr merge --<mergeMethod> --match-head-commit <head>`.
- **Journaled**, with its gates.
- **A merge GitHub refuses is never tried again on that head.** It is journaled and flagged, and the
  agents put it on a card. Only a merge order given after the refusal, or the approval bypass turned
  on since, tries once more.
- **What the server did not do is flagged**: a PR merged by someone else, a commit pushed straight to
  a default branch.

### Merge orders

A PR's card may offer an option with `"merge": true`. When you pick it, the server merges the PR on
the head the card was written on, once:

- merges are armed: a paused switch holds the order until it is armed again;
- CI is green on that head, with the `requiredChecks` and `ignoredChecks` of `locks.json`;
- no review thread is open;
- the PR is mergeable, with no conflict;
- the head has not moved since the card.

Your order lifts the rest, for that head only: the Reviews, Judgment, Locks and Evidence gates. On a
PR judged to merge alone, which only a lock holds, the card waits in the inbox's **Rules & settings**
tab, marked **Lock**.

### The approval bypass

A branch that requires an approving review refuses the server's merges until someone approves.
`rusuban project bypass <id> on` lets the server merge with `--admin` in that project, after it checks
the branch's other rules itself. It is the owner's command, off for every new project, and never read
from a repo. See [security](security.md#the-approval-bypass).

## `locks.json`

Optional. Without it, only the built-in locks hold.

```json
{
	"mergeMethod": "squash",
	"lockedPaths": [".github/**", "package.json", "*.lock"],
	"maxLines": 300,
	"maxFiles": 15,
	"sizeExempt": ["*.test.*", "docs/**"],
	"requiredChecks": ["test"],
	"ignoredChecks": ["Deploy preview"],
	"requiredReviewers": ["review-bot"],
	"evidence": [{ "paths": ["src/engine/**"], "what": "a benchmark within 5 % of the base branch" }]
}
```

| Field | Value | Effect |
|---|---|---|
| `mergeMethod` | `"merge"`, `"squash"` or `"rebase"` | How the server merges. Without it, `rebase`, and a PR must then be rebaseable. |
| `lockedPaths` | globs | A PR that touches one never merges alone. |
| `maxLines` | a positive integer | The most changed lines, added plus deleted, a PR may have and merge alone. |
| `maxFiles` | a positive integer | The most changed files a PR may have and merge alone. |
| `sizeExempt` | globs | Files left out of `maxLines`, `maxFiles` and the `evidence` zones. |
| `requiredChecks` | names | Each must be on the head, and not only skipped. A name is a check's or a whole workflow's. |
| `ignoredChecks` | names | Checks that never count toward CI green, a fork's workflow waiting for approval included. Never all of them: a head whose only checks are ignored is not green. |
| `requiredReviewers` | GitHub logins | Each must have approved or commented on the head. Case and a `[bot]` suffix are ignored. |
| `evidence` | `[{ "paths": [globs], "what": "text" }]` | A PR that touches these paths needs a proof recorded on its head, by a worker run other than the one that judged it. `what` tells the agents which proof. |

### Validation

The server validates the file at every read. One mistake (invalid JSON, an unknown field, a wrong
type, an empty string in a list, a name both required and ignored) and the file yields no locks at all,
only errors:

- every merge of the repo stops, at the Locks gate;
- the error is journaled and flagged in your inbox, and the agents see it in their context;
- fixing the file on the default branch lifts it at the next read.

A typo never leaves a lock silently missing.

### Globs

| Pattern | Matches | Does not match |
|---|---|---|
| `.github/**` | `.github/workflows/ci.yml` | `src/.github/x.yml` |
| `docs/**` | `docs/a.md`, `docs/img/b.png` | `src/docs/a.md` |
| `*.md` | `README.md`, `docs/guide/a.md` | `a.mdx` |
| `package.json` | `package.json`, `web/package.json` | |
| `/package.json` | `package.json` | `web/package.json` |
| `src/*.js` | `src/a.js` | `src/lib/a.js` |
| `src/**/*.js` | `src/a.js`, `src/lib/a.js` | |

- `*` stays within a folder, `?` is one character within a folder, `**` crosses folders.
- A pattern without a slash matches a file name at any depth, as in `.gitignore`. A pattern with a
  slash starts at the repo's root; a leading `/` is dropped.
- A folder is written `folder/**`: `folder/` alone matches nothing.
- Nothing else is special: `[ab]` and `{a,b}` match those characters as they are. Case counts.
