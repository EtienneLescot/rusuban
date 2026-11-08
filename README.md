# Rusuban

Rusuban minds your project while you're away, follows the rules you write, keeps every Claude
conversation, and calls you only when your rules say so.

**Work in progress, not usable yet.**

Rusuban (留守番) is the Japanese word for whoever minds the house while you are out. The design lives
in [specs/001-autopilot](specs/001-autopilot/spec.md).

## Docs

- [Writing rules](docs/writing-rules.md): where a project's rules live, what to write, how a change
  applies
- [Locks](docs/locks.md): what the server checks before it merges, and `locks.json`
- [Security model](docs/security.md): the deny rules, the host profiles, the dashboard's identity
  check, the residual risks
- [FAQ](docs/faq.md)
- [Example rules](examples/rules/)

## License

[MIT](LICENSE)
