# Changelog

## 0.1.0

The first release.

- **Rules in your repo**: free text under `.rusuban/rules/`, read from the default branch, applied at
  once and journaled with their diff. Without rules, Rusuban only observes.
- **Agents**: Claude Code judges every issue and PR, a coordinator acts on the judgments, workers fix
  in their own worktrees. Built-in deny rules on every run.
- **Server-side merges only**, on the exact head that was judged, behind hard locks: CI green, no open
  thread, head unchanged, no conflict, the rules folder never merged alone, the merge switch. An
  approval bypass per project, off by default, that skips only the approval.
- **Cards and one inbox** for all projects, answered on a desktop or a phone.
- **Pings** to ntfy, Slack, Discord, Teams and e-mail.
- **Every Claude conversation** of a project, linked to its items, read and answered in the dashboard.
- **Recurring tasks** written as text.
- **Test machines** reserved over SSH, one agent at a time; a person's desktop only after their yes.
- **Settings from Claude** through an MCP server; what widens what agents may do waits for the owner's
  card.
- **Install**: `rusuban init`, a service on Windows, macOS and Linux, remote access through Tailscale
  Serve.
