# Changelog

## Unreleased

- **Fixed**: `rusuban init` with Claude Code installed but logged out says to log in
  (`claude auth login`), instead of asking to install Claude Code.

## 0.1.0

The first release.

- **Rules in your repo**: free text under `.rusuban/rules/`, read from the default branch, applied at
  once and journaled with their diff. Without rules, Rusuban only observes.
- **Agents**: Claude Code judges every issue and PR, a coordinator acts on the judgments, workers fix
  in their own worktrees. Every run uses the model the owner chose, never Claude Code's default. A
  worker past the limit waits its turn. Built-in deny rules on every run.
  - Development and judgment are kept apart: a worker builds, a judge or the coordinator builds
    nothing.
  - **Disks kept clean**: each worker builds in its worktree and a work folder of its own
    (`rusuban work-root` places them), removed when it ends or stops. A sweep at start and every day
    removes what ended runs left, and says how much room it freed. A worker waits while a disk has
    less than 10 GB free.
- **Server-side merges only**, on the exact head that was judged, behind hard locks: CI green, no open
  thread, head unchanged, no conflict, the merge switch. A PR that changes `.rusuban/` is never judged:
  a person merges it. An approval bypass per project, off by default, that skips only the approval.
- **Cards and one inbox** for all projects, answered on a desktop or a phone, from the inbox or from
  the item's own card.
  - An issue that a PR addresses follows that PR, without a card of its own.
  - Questions on how the agents follow a project wait apart, under Rules & settings. When several
    cards ask the same, the agents propose the rule that would answer them.
  - Open cards are judged again once when an update changes what deserves one.
- **Pings** to ntfy, Slack, Discord, Teams and e-mail.
- **The Claude conversations about a project's items**, linked to them, and its agents' runs, read and
  answered in the dashboard. A run's conversation opens in a terminal on the host, in the reader from
  a phone.
- **Projects**: each project's page shows its own items, tasks, runs and conversations; a project may
  have no repo, for tasks about none.
- **Recurring tasks** written as text.
- **Test machines** reserved over SSH, one agent at a time; a person's desktop only after their yes.
- **Settings from Claude** through an MCP server; what widens what agents may do waits for the owner's
  card.
- **Install**: `rusuban init`, a service on Windows, macOS and Linux, remote access through Tailscale
  Serve. `rusuban status` tells a slow daemon from a stopped one.
- **A quick dashboard**: the daemon builds again only what changed, so the page stays quick while
  agents build.
