# Rusuban

Rusuban minds your project while you're away. It follows the rules you write in your repo, keeps every
Claude conversation of the project in one place, and calls you only when your rules say so.

Rusuban (留守番) is the Japanese word for whoever minds the house while you are out.

![A decision card beside the project's graph](specs/001-autopilot/mockups/inbox/built/desktop-2-card.png)

## What it does

- **Judges every issue and PR against your rules**, with Claude Code, and acts where they let it: it
  asks for a rebase, fixes a bug in its own worktree, and merges what your rules and its locks allow.
- **Brings you only the decisions your rules keep for you**, as cards with options and their effects,
  in one inbox for all your projects. It pings you on ntfy, Slack, Discord, Teams or e-mail.
- **Keeps every Claude conversation** held in your project's folders, linked to the issue or PR it is
  about. You read and answer them from the dashboard, on your desktop or your phone.
- **Runs recurring tasks** written as text.
- **Reserves your test machines** over SSH, one agent at a time. Your own desktop only after your yes.
- **Is set up from Claude**: its MCP server changes any setting, and whatever widens what agents may do
  waits for your yes in the dashboard.

## Getting started

You need Node 22 or later, and the GitHub CLI (`gh`) and Claude Code (`claude`) logged in.

```bash
npm install -g rusuban
rusuban init
```

`init` asks how agents may use this machine and whether to arm automatic merges: there is no default
for either. It adds your first repo in shadow mode, installs the service that keeps Rusuban running,
registers its MCP server for Claude Code, and opens the dashboard.

Then write your rules in your repo, under `.rusuban/rules/`: see [Writing rules](docs/writing-rules.md)
and the [examples](examples/rules/). Without rules, Rusuban only observes.

To reach the dashboard from your phone, `rusuban remote enable` serves it on your tailnet through
Tailscale.

Read the [security model](docs/security.md) before you let agents run any command on your machine.

## Docs

- [Writing rules](docs/writing-rules.md): where a project's rules live, what to write, how a change
  applies
- [Locks](docs/locks.md): what the server checks before it merges, and `locks.json`
- [Security model](docs/security.md): the deny rules, the host profiles, the dashboard's identity
  check, the residual risks
- [Setting Rusuban up from Claude](docs/claude.md): its MCP server, and what waits for your card
- [Test machines](docs/machines/README.md): what a machine needs, a setup script per system, your
  own desktop
- [FAQ](docs/faq.md)
- [Example rules](examples/rules/)
- [Changelog](CHANGELOG.md)

The design lives in [specs/001-autopilot](specs/001-autopilot/spec.md).

## License

[MIT](LICENSE)
