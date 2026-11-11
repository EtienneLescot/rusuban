# Setting Rusuban up from Claude

Everything you can set with `rusuban` commands, you can ask Claude Code to set. `rusuban init`
registers Rusuban's MCP server for your user; any Claude Code session on this machine then has its
tools.

## What Claude can do

- **Read the instance**: projects, their items and cards, runs, tasks, the journal.
- **Change a setting**: add or remove a repo, a project's mode or approval bypass, the host profile,
  the merge switch, the limits, the runs' model, the owner, a task, a channel, remote access.

Ask in your own words: "watch acme/widgets in Rusuban", "pause the merges", "write a task that drafts
the release notes every Friday".

## What waits for you

A change that widens what agents may do, or where data goes, never applies from Claude. It waits as a
card in the dashboard's inbox, under **Rules & settings**, marked **Setting**, with two answers:
**Allow it** or **Don't allow it**. Claude tells you it is pending.

What widens:

- a project added, or a repo added to one: agents act on a repo as its rules say;
- a project's approval bypass turned on, the merge switch armed;
- the host profile set to `bypass`;
- the limits raised, a new owner;
- a task written or changed: its card shows the task, or the diff of its file;
- a channel added, since cards leave for its target;
- remote access turned on.

What narrows applies at once: the bypass off, the switch paused, the limits lowered, a project, a
channel or a task removed, remote access off. So does a project without a repo created: it starts
nothing by itself, and each of its tasks waits for you. So does the runs' model: every run uses the
one you chose, never Claude Code's default, and without one no run starts.

In a terminal, `rusuban` asks you to type the change's target instead of making a card. Claude's own
shell has no terminal: there, the change waits for the card too.

## What Claude never does

- **Answer a card.** Cards are for you: an agent would otherwise approve its own proposals.
- **Reach the settings from a Rusuban run.** The agents Rusuban starts have the MCP server and the
  owner's commands denied, and both refuse to run inside a run.

Under the `bypass` host profile, an agent's shell can still get around these limits. The
[security model](security.md#residual-risks) says how far they go.

## Every change is journaled

Each setting goes to the journal with where it came from: a terminal, a command without a terminal,
Claude through the MCP, or your answer in the dashboard. Ask Claude for the journal, or open it in
the dashboard.
