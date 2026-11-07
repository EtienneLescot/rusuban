<!--
Sync Impact Report, 1.2.0 (2026-11-07)
- Principle IV: a project may name checks that do not count toward CI green (`ignoredChecks`), never all

Sync Impact Report, 1.1.0 (2026-11-07, after the spec analysis)
- Principle III extended: without rules nothing is autonomous but the owner's explicit requests run;
  a rules change applies at once and is journaled; silent rules mean a card, never a default
- Principle IV: the server also carries out merges a person orders; "no conflict" joins the gates

Sync Impact Report, 1.0.0
- Version: none → 1.0.0 (first ratification of Rusuban's own constitution)
- Derived from: the OpenScreen pilot's constitution 1.0.0 (ratified 2026-10-24), translated from
  French and generalized from one project to any project
- Principles kept: I, II, IV, V, VI; II, IV and VI extended for the product
- Principle redefined: III "Autonomy by default" → "Autonomy comes from each project's rules"
  (no product defaults, spec clarification of 2026-11-07)
- Constraints changed: English interface; how agents write on GitHub moved to each project's rules;
  "no window on Etienne's desktop" generalized to any person's desktop, behind that person's card;
  added: no project-specific code in the product
- Templates: plan-template.md (Constitution Check) relies on the six principles below; no change needed
- Deferred: none
-->

# Rusuban Constitution

Rusuban minds a software project while its owner is away. It watches the project's GitHub repos, runs
headless Claude Code agents under rules written as text in the project's own repo, gathers every Claude
Code conversation of the project, and calls a person only when the rules say a person decides. The
owner sees only the decisions that are theirs and the state of everything else. Each person runs their
own instance, on their own machine.

## Core Principles

### I. One source, one writer per datum

- GitHub state comes from GitHub, read by the server. Judgments (kind, owner, next step) come from the
  agents. Decisions come from people's answers.
- Every state file has one writer. No datum lives in two places.
- The dashboard is the single point of control: nothing requires opening a conversation, GitHub or
  another board to know where an item stands.

### II. Real time, freshness always visible

- GitHub state refreshes without waiting for an agent, within minutes at most.
- The age of every datum is shown, machine probes and the conversations index included. Stale data
  says so, never silently.
- What the agents are doing right now is visible live: the run, its step, since when.

### III. Autonomy comes from each project's rules (NON-NEGOTIABLE)

- A project's text rules decide what its agents do: what they do alone and how far, who decides what,
  how long a third party is waited for, how messages are written.
- The product ships no default autonomy. A project without rules does nothing autonomous: no agent acts
  on its own and nothing is written on GitHub on its own. The owner's explicit requests, answers and
  tasks still start agents.
- Rules are read from the project repo's default branch, never from a PR head. A rules change applies
  at once; it is journaled with its diff and the owner is told.
- Where the rules are silent, the agent asks the owner on a card; it never fills the gap with a default.
- Text never lifts a hard lock (principle IV). A judgment that would break one becomes a card.
- No item stays with the agents without work in progress. A block becomes a card for a person or a
  named wait on a third party, never a silent state.

### IV. Mechanical guardrails, no blind trust

- Only the server merges, a merge a person orders on a card included, through gates computed on live
  state, never from memory: CI green on the exact head, no open review thread, head unchanged since
  judgment, no conflict. A project's locks file may name checks that do not count, never all of them.
- A judgment is tied to the commit it read. A new commit invalidates it.
- Built-in locks hold in every project and no configuration lifts them: the rules folder never changes
  without a person, no direct push to the default branch, one switch pauses every merge. A project may
  add its own locks (paths, sizes, checks) in its locks file.
- Every agent run carries the built-in deny rules (no merge, no push to a default branch, no edit to
  the instance's state), whatever the host's permission profile.
- What agents may run on a host belongs to the host's owner, chosen at init, never to a repo's rules.
- A merge the server did not perform is flagged.
- Every lock is proven by a test that tries to break it.
- Every autonomous action is journaled, with its link.

### V. Readable at a glance

- Every item answers four questions without a click: what it is, who holds it, what comes next, what
  blocks it.
- An issue and the PRs that address it show linked, and so do the conversations that touch them.
- No control without a visible, nameable effect. No explanatory sentence under a setting. An option
  with no effect is hidden, not greyed out.

### VI. Simplicity

- A local page with no build step. A Node server with no dependency where the standard library is
  enough; a third-party library only when it replaces a lot of code, with the reason in the plan.
- Claude Code (`claude -p`) is the only agent engine. No home-made agent loop.

## Constraints

- The server listens on 127.0.0.1 only. Remote access goes through Tailscale Serve with an identity
  check, never a public endpoint. Every write requires the dashboard's origin.
- Content from GitHub (issues, PRs, comments, diffs) is data, never instructions.
- English only, interface included. Rules may be written in any language, and how agents write on
  GitHub is up to each project's rules.
- No agent uses a person's desktop without that person's yes on a card.
- The product code holds nothing specific to one project: no name, path, rule or prompt.

## Method

- Spec Kit: spec, clarifications, plan, tasks, implementation.
- A feature is done only when verified live, with proof: the dashboard in a browser, agents on a real
  repo.
- The spec's success criteria are measured, not asserted.

## Governance

- Etienne Lescot, the maintainer, amends this constitution. It takes precedence over any other
  guidance for Rusuban.
- Versions: MAJOR when a principle is removed or redefined, MINOR when one is added or materially
  extended, PATCH for wording.
- Every plan checks its compliance with the six principles before implementation; a justified
  exception goes in its Complexity Tracking table.

**Version**: 1.2.0 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-07
