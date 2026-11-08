# What merges alone

## A PR may merge alone (`pr.auto: true`)

Whoever wrote it, judged on the head you read, a PR merges alone only when it is one of these:

- a bug fix, with a test that fails without it;
- documentation;
- tests;
- maintenance that changes no behavior: a refactor, a typo, a comment.

It never merges alone when it is:

- a feature, or a change of a behavior someone may rely on;
- a change to the public API or to a default value;
- a new or upgraded dependency;
- a fix mixed with anything above. Ask the author to split it.

**A bug** is behavior that contradicts the documentation or the obvious intent: a crash, a wrong
result, an error message that lies. A new option is a feature, even a small one.

The locks file adds what the server checks alone:

- the CI workflows, the dependency files and the license never merge alone;
- at most 200 changed lines and 10 files, tests and documentation excluded. A larger fix goes to the
  owner with a card.

## Squash

This repo merges by squash: the PR's title becomes the commit on the default branch. Keep it an
imperative summary. A closing keyword (`Fixes #N`) goes in the description, and only when the PR
completes the issue.
