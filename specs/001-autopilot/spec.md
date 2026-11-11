# Feature Specification: Project autopilot for Claude Code (public product)

**Feature directory**: `specs/001-autopilot`
**Created**: 2026-11-07
**Status**: Draft, clarification in progress
**Name**: Rusuban, from the Japanese word for whoever minds the house while you are out; chosen on 2026-11-07 (see [naming.md](naming.md))
**Input**: Etienne Lescot: "Make the OpenScreen pilot generic and publish it as a public repo. Separate the
project-specific settings and instructions from the repo connection, maybe multi-repo. A product that lets
me find my way through every Claude conversation at the scale of a whole project, running on its own, with
human pings when needed and under rules we write. Rules stay flexible: they are written as text."

## Summary

A local control plane that runs a software project with Claude Code agents. It watches GitHub repos,
starts headless Claude Code sessions to triage, fix and ship, follows rules written in plain text, and
pings a human only when a rule says a human decides. It gathers **every** Claude Code conversation of the
project (the ones it launched and the ones the user opened in Claude Desktop or a terminal) in one
dashboard, where they can be read and answered, from a phone too. It reaches the user's test machines
over SSH, with reservations, so agents run real end-to-end tests on every platform.

It is extracted from the OpenScreen pilot (`specs/001-pilotage-temps-reel`), which already does most of
this for one repo with OpenScreen-specific code and prompts.

## Clarifications

### Session 2026-11-07

- Q: What does it pilot? → A: GitHub repos (issues, PRs) **and** free recurring tasks written as text
  (publications, monitoring, releases), as the OpenScreen pilot does today.
- Q: Which Claude conversations does it gather? → A: All conversations of the project: the ones it
  launches and the ones the user opens in the project's folders (Desktop, CLI), linked to their issue or PR.
- Q: Rules form? → A: Free text interpreted by Claude, **plus hard locks the text cannot lift**
  (CI green, forbidden paths), because PR content can try to manipulate the agent.
- Q: Where does it run? → A: On the user's own machine, reachable remotely (Tailscale). Start thinking now
  about multi-user collaboration and about making multi-machine access standard: the reach to several
  machines for e2e tests is what makes the current system effective.
- Q: Test machines? → A: A machine registry with reservations (leases), online status in the dashboard,
  and an enrollment script.
- Q: Several maintainers? → A: One instance per person (own Claude subscription, own machines);
  instances share the work through GitHub (assignment, labels), no central server.
- Q: Ping channels? → A: Pluggable: phone push, Slack, Discord, Microsoft Teams, e-mail. The dashboard
  always holds the decision cards.
- Q: Conversations in the dashboard? → A: Read and answer them in the dashboard (from a phone too); an
  answer resumes the session headless. The "open in terminal" button stays.
- Q: Agent engine? → A: Claude Code only. Another engine is added if someone asks for it.
- Q: Language? → A: English only, interface included. Rules can be written in any language.
- Q: License? → A: MIT.
- Q: Name? → A: Rusuban, chosen after this spec from four agents' shortlists (naming.md).
- Q: Where do the rules live? → A: In the **project's** repo (e.g. `getopenscreen/openscreen`), not in
  Rusuban's repo. The project repo carries the rules.
- Q: Default autonomy for a new project? → A: None. Autonomy is part of the text rules, inside the hard
  locks. There are no product defaults.
- Q: Answer straight from a ping channel? → A: Not in v1: pings link to the card, answers happen in the
  dashboard.
- Q: Several maintainers in v1? → A: Later. v1 is single-user, every decision already names a login.

### Session 2026-11-07 (analysis, see [analysis.md](analysis.md))

- Q: The rules say nothing about a situation? → A: The agent asks the owner on a card; the answer may
  become a rule.
- Q: Mockups? → A: Mockups of each new view, validated by Etienne, before the phase that builds it.
- Q: Where do leases and run folders live on a test machine? → A: On the machine itself: an atomic
  lock, and a workspace with a bare mirror and one worktree per run (reflection P1, P2).
- Q: A runner on each machine for graphical tests? → A: Right after v1 (reflection P4).
- Q: A rules change on the default branch? → A: It applies at once. The repo's rules say what may be
  done to the repo, and delaying them would keep stale permissions alive. The change is journaled with
  its diff and the owner is told; the host stays protected by the instance's permission profile, which
  no rule can widen.
- Q: Who lifts an evidence lock? → A: The agent that measured: a worker other than the run that judged,
  with a link to its conversation, journaled.
- Q: Answering a conversation opened in Claude Desktop or a terminal? → A: Through a linked fork, so a
  session Desktop may hold open is never altered. Rusuban's own sessions resume in place.
- Q: A project without rules? → A: Nothing autonomous. The owner's explicit requests, answers and tasks
  still start agents.
- Q: The OpenScreen pilot's history? → A: Not imported; the old pilot is archived read-only (default
  taken during the analysis, open to change).
- Q: Checks that should not block a merge (OpenScreen's Nix build, fork workflows awaiting approval)?
  → A: The project's locks file names them in `ignoredChecks`, never all of them.

## Positioning

| | Dashboard | Text rules per item | Own sessions gathered | Test machine fleet | Hosting | Windows |
|---|---|---|---|---|---|---|
| **Rusuban** | yes, live | yes + hard locks | yes, read and answer | registry + leases | local + Tailscale | yes |
| [firstmate](https://github.com/kunchenguid/firstmate) (8.6k★) | no, one chat agent | per-project modes | its crew only | SSH "secondmates" | local | no |
| [Hive](https://github.com/hivecommons/hive) (CNCF sandbox) | yes | autonomy levels L1–L6 | no | no | Docker / K8s | n/a |
| Triage bots (ai-triager, Copilot Triage) | board or none | no | no | no | Action / local | n/a |

## User Scenarios & Testing

### User Story 1 - Install, connect a project, always find the dashboard (Priority: P1)

The user installs Rusuban with one command, connects one or more repos of a project, and gets a
dashboard URL that never gets lost. The project's rules come from the project's repo.

**Why this priority**: nothing else exists without it, and "I can never find the URL" is a real complaint.

**Independent Test**: on a clean machine with `gh` and `claude` logged in, run the install, connect a
public repo, and see its issues and PRs in the dashboard.

**Acceptance Scenarios**:

1. **Given** `gh` and `claude` are logged in, **When** the user runs the init command and names a repo,
   **Then** a project is created and the dashboard opens with the repo's items.
2. **Given** Rusuban is installed, **When** the machine reboots, **Then** Rusuban starts on its own and
   the dashboard is reachable at the same URL, from a shortcut and from an `open` command.
3. **Given** a project repo with no rules folder, **When** the first scan runs, **Then** Rusuban only
   observes, and the dashboard says how to add rules, with an example to start from. No rules, no action.
4. **Given** the init, **When** it asks how agents may use this host (tool allowlist or full bypass),
   **Then** the user's answer is stored in the instance; there is no silent default.

### User Story 2 - Decisions come to me, wherever I am (Priority: P1)

When a rule says a human decides, the user gets a decision card in the dashboard and a ping on the
channels they chose, and answers in a few taps, from a phone if needed.

**Why this priority**: it is the contract of the product: autonomous by default, human when the rules say.

**Independent Test**: write a rule "a new feature always comes to me", open a feature request, receive a
push, answer the card from the phone, see the agent apply the answer.

**Acceptance Scenarios**:

1. **Given** a rule that routes new features to the user, **When** a feature PR is judged, **Then** a card
   presents it as it is (what is done, what is missing, the actions the agent will take) and a ping links
   to it.
2. **Given** a card, **When** the user picks an option or types a free answer, **Then** the coordinator
   agent starts at once and the card shows what was done.
3. **Given** quiet hours or a digest setting, **When** several non-urgent decisions arrive, **Then** they
   are sent as one digest; an urgent one still pings at once.

### User Story 3 - The project moves on its own, inside hard locks (Priority: P1)

The agents triage issues, fix bugs, finish contributor PRs, and merge what the rules allow, without
waiting on anyone more than the rules say (OpenScreen: a third party waits 2 days at most).

**Why this priority**: it is what the OpenScreen pilot already proves; the product must keep it.

**Independent Test**: the OpenScreen project runs on the generic product with its rules moved to text and
config, and behaves as today.

**Acceptance Scenarios**:

1. **Given** text rules that allow merging bug fixes, **When** a fix PR has green CI on its exact head and
   no open thread, **Then** it is merged, and the journal says why.
2. **Given** the same rules, **When** a PR touches a locked path or its head moves after judgment,
   **Then** it is never merged automatically, whatever the text or the PR content says.
3. **Given** a PR whose description tells the agent to merge it, **When** it is judged, **Then** the
   instruction is ignored as data and the PR is judged on its diff.
4. **Given** a long task (a fix, a measurement), **When** the coordinator delegates it, **Then** a worker
   agent runs in its own git worktree, and reports back when done.

### User Story 4 - Every Claude conversation of the project, in one place (Priority: P1)

The dashboard lists all Claude Code conversations held in the project's folders and worktrees, whoever
started them, linked to the issue or PR they touch. The user reads them and answers them there.

**Why this priority**: it is the user's core need: find their way through all conversations of a project.

**Independent Test**: open a Claude Desktop session in a project worktree about PR #N; within a minute it
appears in the dashboard under PR #N; answer it from the phone and see the answer in the transcript.

**Acceptance Scenarios**:

1. **Given** a session started in Claude Desktop in a project folder, **When** the hub refreshes,
   **Then** it appears with its origin, title, last activity and linked items.
2. **Given** a session on branch `fix/1475-keyframes` or citing #1475, **When** it is indexed, **Then** it
   is linked to #1475 and listed on that item's card.
3. **Given** a finished session, **When** the user answers it in the dashboard, **Then** the session is
   resumed headless with that message and the reply shows in the transcript.
4. **Given** a session still live elsewhere, **When** the user answers it, **Then** the answer goes to a
   fork of the session, and the dashboard says so.

### User Story 5 - Test machines as a shared, reserved resource (Priority: P2)

The user describes their machines once. Agents see which ones are online and free, reserve one for the
time of a test, and release it. A human's own desktop is used only after that human says yes.

**Why this priority**: real e2e on every platform is what makes the current system effective.

**Independent Test**: enroll a Mac by SSH, start two agents that both need macOS, see the second wait for
the first's lease to end.

**Acceptance Scenarios**:

1. **Given** a machine enrolled with its capabilities, **When** it answers its probe, **Then** the
   dashboard shows it online, and who holds it.
2. **Given** a machine leased by an agent, **When** another agent asks for it, **Then** it waits in a
   queue or picks another machine with the same capabilities.
3. **Given** an agent that dies with a lease, **When** the lease expires, **Then** the machine is free
   again and the journal says so.
4. **Given** a machine flagged as a person's desktop, **When** an agent needs it, **Then** a decision card
   asks that person first.

### User Story 6 - Recurring tasks written as text (Priority: P2)

A task is a text file: a title, a schedule, a working folder, and a prompt. It runs on schedule or on a
click, and reports in the journal like the rest.

**Independent Test**: add a daily task file, see it run at its time, and find its summary and log in the
journal.

**Acceptance Scenarios**:

1. **Given** a task file with a schedule, **When** its time comes, **Then** it runs once, even after a
   reboot that skipped the slot.
2. **Given** two tasks sharing a lock, **When** both are due, **Then** they run one after the other.

### User Story 7 - Several projects, one inbox (Priority: P2)

One instance pilots several projects. Each has its repos, rules, tasks and machines; the inbox gathers
the decisions of all projects. A project may have no repo, only tasks (FR-096). Each project's
section shows only its own tasks, runs and conversations (FR-097).

**Independent Test**: connect two projects, get one decision in each, see both in the inbox.

### User Story 8 - Several maintainers, one instance each (Priority: P3)

Each maintainer runs their own instance. Instances never work on the same item at the same time, and the
rules route each decision to the right person.

**Independent Test**: two instances on one repo; an item claimed by one is skipped by the other.

**Acceptance Scenarios**:

1. **Given** instance A works on #N, **When** instance B scans, **Then** B sees the claim on GitHub and
   leaves #N alone.
2. **Given** a rule "translations go to @alice", **When** a translation needs a decision, **Then** only
   Alice's instance pings.

### User Story 9 - Every setting from Claude, widening ones confirmed by a person (Priority: P2)

The owner sets Rusuban up by asking Claude: projects, the approval bypass, tasks, channels,
machines, remote access, the merge switch, limits, the host profile. Claude can also read the state.
Claude thereby configures software that gives agents rights, so a change that widens those rights, or
where data goes, waits for the owner's confirmation outside Claude.

**Independent Test**: ask Claude to lower the limits, add a project and turn its bypass on; the limits
apply at once, the two others wait as cards; confirm them in the dashboard and see them applied, each
journaled with its origin. From inside a Rusuban run, the same asks are refused.

**Acceptance Scenarios**:

1. **Given** Rusuban's MCP server registered in Claude, **When** the owner asks Claude to turn a
   project's bypass off or remove a channel, **Then** it applies at once, journaled with "MCP" as its
   origin.
2. **Given** the same, **When** Claude asks to add a project, **Then** nothing changes until the owner
   allows it on a card in the dashboard; declined, nothing changes and Claude is told.
3. **Given** a terminal, **When** the owner types `rusuban project add <owner/repo>`, **Then** a typed
   confirmation applies it.
4. **Given** an agent run, **When** it calls the MCP server or an owner's command, **Then** it is
   refused, and no card answer is ever possible through the MCP.

### Edge Cases

- A Claude Code update changes the transcript format: the hub degrades to listing sessions without
  links, and says so; nothing else breaks.
- The rules file is edited in a PR: the PR is never auto-merged; rules are always read from the default
  branch.
- Claude usage limits are reached: runs queue, the dashboard says why, nothing is lost.
- The instance host sleeps or reboots mid-run: interrupted runs are marked, their requests go back to the
  queue, leases expire.
- A machine's checkout is stale or dirty: the agent resets it to the PR head in its own worktree, never
  touches the user's working copy.
- The user answers a card that a newer judgment replaced: the answer is refused with the reason.
- Two instances race on the same item: the GitHub claim with the earliest timestamp wins.

## Requirements

### Functional Requirements

**Install and access**

- **FR-001**: Rusuban MUST install and start with one command on Windows, macOS and Linux, using the
  existing `gh` and `claude` logins.
- **FR-002**: It MUST start on its own at login, and give one stable URL, reachable from an `open`
  command, a desktop or menu shortcut, and remotely through Tailscale.
- **FR-003**: The dashboard MUST be reachable only from the host and the user's tailnet, never from the
  public internet.

**Projects, repos, configuration**

- **FR-010**: An instance MUST pilot several projects; a project groups one or more GitHub repos, their
  local folders, its rules, tasks and machines.
- **FR-011**: Everything specific to a project MUST live in its configuration and text files; the product
  code MUST hold no project-specific name, path, rule or prompt.
- **FR-012**: Instance state (judgments, runs, journal) MUST live in the instance's home folder, never in
  the repos.

**Rules and hard locks**

- **FR-020**: Rules MUST be free text, in a rules folder committed in the **project's** repo and read
  from its default branch only. They say everything about behavior: what agents do alone, how far
  (autonomy), who is pinged for what, how messages are written. The product has no default rules.
- **FR-021**: Built-in hard locks MUST be enforced by the server without the model, in every project:
  CI green on the exact head, no open review thread, head unchanged since judgment, no conflict
  (rebaseable for a rebase merge), the rules folder itself never changed without a person, never a
  direct push to the default branch, a switch that pauses all merges. **CI green** means: at least one
  check on the head; every check run and status on it is `success`, `neutral` or `skipped`; none is
  pending, failed, cancelled, timed out or waiting for approval; every name in `requiredChecks` is
  present and `success`. A project's locks file may name checks that do not count
  (`ignoredChecks`), never all of them.
- **FR-022**: A project MAY add hard locks in a small structured file next to its rules (locked paths,
  size limits, required checks, evidence). Text rules MUST never lift a hard lock; a judgment that would
  break one becomes a card, and a person's merge order on that card is carried out under FR-044.
- **FR-023**: Content from GitHub (issues, PRs, comments, diffs) MUST reach the agents as data, never as
  instructions.
- **FR-024**: Without a rules folder, Rusuban MUST do nothing autonomous: no judgment on change, no
  merge, nothing written on GitHub on its own. The owner's explicit requests, answers and tasks still
  start agents. The docs MUST ship example rules, including the OpenScreen ones.
- **FR-025**: What agents may run on a host (tool allowlist or full bypass) MUST belong to the instance
  owner, set at init, never to the repo's rules: whoever can merge in the repo must not gain a shell on
  a maintainer's machine.
- **FR-026**: When the rules say nothing about a situation, the agent MUST ask the owner on a card
  rather than act. When the cards of several items ask the same, the agent proposes the rule that
  would answer them, on a card of its own (FR-099).
- **FR-027**: A rules change on the default branch MUST apply at the next read; it is journaled with its
  diff and the owner is pinged. No rule can widen the instance's permission profile.
- **FR-028**: Removed on 2026-11-09, Etienne's decision. Projects had a mode, `live` or `shadow` (judge
  and propose only), for a shadow week that was dropped on 2026-11-08. A repo without rules is only read
  (FR-024), and a repo added waits for the owner (FR-092): every project acts as its repos' rules say. A
  config that still names a project's `mode` is refused at load, so no project starts acting unasked.
- **FR-029**: A project MAY have an approval bypass: a setting of the instance's config, off by default,
  that only the owner turns on (confirmed outside Claude, FR-092), never a repo, a PR, a rule or an agent
  through the settings (under the bypass host profile, an agent's shell remains a residual risk,
  FR-095). It applies only to a
  merge the server would make anyway (the switch armed, FR-021 and FR-044 met): the
  server then merges with GitHub's admin bypass, the head pinned. It skips the approval and nothing
  else: the server first reads the base branch's rules from GitHub and merges only if every check they
  require is on the head, from the app they name, and `success` (checks the locks file ignores
  included), the merge method is one they allow, and they hold no rule it cannot check. Each change of
  the setting and each merge through it is journaled. With or without it, a merge GitHub refuses is
  never tried again on that head, and the agents put the refusal on a card for the owner.

**Agents**

- **FR-030**: Every run (judge, act, worker, task, reply) MUST be a headless Claude Code session started
  by the same launcher, with the instance's permission profile and the built-in deny rules.
- **FR-031**: A short coordinator run (`act`) MUST apply decisions and delegate long work to
  workers, each in its own git worktree, at most `limits.maxWorkers` at once (instance config). A
  worker started past the limit waits its turn, without a card, and starts as soon as one ends
  (decided on 2026-11-10).
- **FR-032**: Every run MUST record its session id, folder, linked items, machines held, status, live
  step and final summary.
- **FR-098**: Every run MUST use the model the owner chose, `model` in the instance config, never
  Claude Code's default, decided by Etienne on 2026-11-10. Every launch of Claude Code passes it as
  `--model`: judge, act, worker, task, reply in place or in a fork, and the terminal a conversation
  opens in. There is no default: `init` asks for it, `rusuban model` and the MCP change it at once,
  journaled; without one no run starts, and the page and `status` say why. Each run records the
  model its session announced, which the page shows, marked when it is not the one asked for.
- **FR-103**: Runs MUST be of two sorts, kept apart, as Etienne asked on 2026-11-11, and the Agents
  view and Conversations say which: development, a worker in its own worktree, which builds; and
  judgment (judge, coordinator, reply), which reads, decides and writes, with no worktree and no
  build. Disks are Rusuban's to keep clean:
  - A worker gets a work folder, `<workRoot>/<run>`, named in its prompt and in `RUSUBAN_WORK`, and
    in WSL `~/rusuban-work/<run>`. Builds, exports, temporary files and any other worktree of the
    repo go there, never in a folder of the agent's choosing. `workRoot` is in the instance config,
    set by `rusuban work-root` and the MCP at once; by default `work/` in the home.
  - What a worker opened goes when it ends or is stopped: its worktree, its work folder with the
    worktrees it added to the clone, its WSL folder.
  - At the daemon's start, then once a day, a sweep removes what runs that ended left behind, and
    journals the room it freed. Never a live run's; never a folder named after a run this instance
    does not know, which may be another instance's. A worktree of the clone outside every run's
    folders goes only while no worker or task lives, since nobody can tell whose it is.
  - Nothing is removed by following a junction or a link.
  - Before a worker starts, the disks it writes on (the worktrees' and the work root's) each need
    10 GB free. Short of that, it waits in its queue, the reason in its status, and starts once there
    is room.

**Decisions and pings**

- **FR-040**: A decision MUST be a card: what it is, what was done, options phrased as orders to the
  agent, each with its effect, plus a free answer. An issue that an open PR addresses follows that
  PR: while the PR has an open card, the issue gets none of its own (decided on 2026-11-10).
- **FR-041**: Pings MUST go through pluggable channels: phone push, Slack, Discord, Microsoft Teams,
  e-mail; each ping links to its card. In v1 channels are outbound only: answers happen in the dashboard.
- **FR-042**: Rules MUST decide who is pinged and how urgently; the person's settings decide where.
- **FR-043**: Answering a card MUST start the coordinator at once.
- **FR-044**: An answer that orders a merge MUST be carried out by the server, never by an agent. The
  server still checks CI, threads, head and conflicts, and holds the order while the switch is paused;
  the answer lifts the project's own locks (paths, size, evidence) for that head only.
- **FR-045**: A ping MUST link straight to its card, on the tailnet address when remote access is on.
  In v1 every card goes to the owner; a card meant for another login says so.
- **FR-099**: The inbox MUST keep the questions on how the agents follow a project apart from the
  items' own, as Etienne decided on 2026-11-10 and validated on its mockup on 2026-11-11: a tab
  "Rules & settings" beside "Decisions", on a desktop and a phone. It holds, each tagged:
  - a silent rule: a card on how the agents work, which the judge marks so (`about: "rule"`);
  - a lock: what only a person lifts (`about: "lock"`). A card on a PR judged to merge alone is one
    or the other by itself, a lock when an option orders the merge;
  - a setting waiting for the owner (FR-092);
  - a rule proposal: one rule that would answer the open cards of several items, proposed on a card
    of its own instead of a "Make it a rule" option on each. "Open the rule PR" opens it and the
    items wait for it without a card; "Not a rule" keeps them asked one by one;
  - the PRs that change `.rusuban/`. A person merges them on GitHub: the agents never judge them, and
    they leave the graph and the kanban.

  The desktops a run asks for stay in Decisions. A card's item stays where it is in the graph.
- **FR-100**: Everything MUST be doable from an item's card, as Etienne asked on 2026-11-11: its open
  card is answered there as in the inbox, through one block in both places, on a desktop and a phone;
  and, without a card waiting, a request to Claude about the item is written there. The request goes
  to the coordinator with the item, like the owner's other requests. Nothing in the card is wider
  than it, at a phone's width too.
- **FR-101**: An open card MUST be judged again, once, when an update of Rusuban changes what deserves
  a card, as Etienne asked on 2026-11-11, so no card outlives the rules it was written under. Each
  card keeps the fingerprint of the product's card rules it was written under: the judge's prompt,
  the card formats and the safety frame. An unanswered open card under another fingerprint comes
  back to the judge (`stale-card`), which closes what the product now does alone, gives `about` to
  what belongs in Rules & settings, and drops the options that no longer exist. A card that keeps its
  question keeps its id. A card already answered is left to the coordinator, which carries it out.

**Conversations hub**

- **FR-050**: The hub MUST index every Claude Code session whose folder belongs to a project (repo
  checkouts and their worktrees), whatever started it, within one minute.
- **FR-051**: It MUST link sessions to items by Rusuban's run metadata, the PR links Claude Code records,
  branch names (a PR's head ref, a number in the name) and cited numbers.
- **FR-052**: The user MUST be able to read a full transcript in the dashboard, on a phone too. A
  session Rusuban started goes by its run's name, never by its prompt's first line: the run's title (a
  task's, a worker's), else its kind and the time it started, "Judge 21:40" (decided on 2026-11-11).
- **FR-053**: The user MUST be able to answer a session from the dashboard. A session Rusuban started
  resumes in place unless its run is alive; any other session (Desktop, terminal) is answered through a
  fork listed under the original.
- **FR-054**: An "open in terminal" action MUST resume any session on the host. A run's
  "Conversation", in the Agents view, opens the same way on the host, and in the dashboard's reader
  from a phone or another machine of the tailnet, never as its raw log (decided on 2026-11-11).
- **FR-055**: The hub MUST rescan every 30 seconds and show the age of its index.
- **FR-102**: A project's Conversations MUST list only the conversations about one of its items, and
  Rusuban's own runs on it, as Etienne decided on 2026-11-11: a session opened in the project's folder
  about something else is not the project's. One linked later, by a PR link or a branch, shows from
  the pass that links it; a fork goes with the conversation it came from. Answering a conversation
  and opening it in a terminal go by its id, listed or not.

**Machines**

- **FR-060**: A registry MUST describe each machine: OS, access (SSH alias or local), capabilities,
  workspace folder, and whether it is a person's desktop.
- **FR-061**: The server MUST probe machines and show online, offline, free or leased, and by whom.
- **FR-062**: Agents MUST take an exclusive lease, stored on the machine itself and capped at
  `maxLeaseMin`, before using a machine, and release it after. Each run works in its own worktree of
  the machine's bare mirror, never in a person's checkout.
- **FR-063**: A person's desktop MUST be leased only after that person accepts a card. Its alias is
  denied to every run that does not hold its lease.
- **FR-064**: An enrollment command and a `doctor` command MUST check SSH, the agent account,
  prerequisites and the workspace, and add or recheck the machine.

**Tasks, journal, freshness**

- **FR-070**: Recurring tasks MUST be text files with a schedule, a lock group, a folder and a prompt.
- **FR-071**: The journal MUST record everything done without the user, with links.
- **FR-072**: The age of every piece of data MUST be visible. It is stale past three refresh periods for
  GitHub, three minutes for the hub, two probes for machines, and flagged as such.
- **FR-073**: A run that hits a Claude usage limit MUST wait with the time it can resume, shown in the
  dashboard; an interrupted run gives its requests back to the queue.
- **FR-074**: The instance config and state files MUST carry a version; an update of the package
  migrates them on load.

**Settings from Claude**

- **FR-090**: Every setting the owner's commands change (projects and their repos, modes, the approval
  bypass, tasks, channels, machines, remote access, the merge switch, limits, the host profile) MUST be
  reachable from Claude through Rusuban's MCP server (`rusuban mcp`, stdio, registered by `init`), which
  also reads the state. One implementation of the settings serves the command line and the MCP.
- **FR-091**: A card MUST NOT be answered through the MCP: an agent would approve its own proposals.
- **FR-092**: A change that widens what agents may do, or where data goes, MUST NOT apply from a
  non-interactive context: the MCP, or a command without a terminal (which covers Claude's shell). It
  waits as a card the owner allows in the dashboard; in a terminal, a typed confirmation is enough.
  Widening: a project or a repo added, the approval bypass on, the merge switch armed, the host profile
  to bypass, a machine, a channel (data leaves to its target), remote access, a new owner, a task
  created or its prompt or schedule changed (the card shows the diff).
- **FR-093**: A change that narrows MUST apply at once: the bypass off, the switch disarmed, a project,
  a channel or a machine removed.
- **FR-094**: Every change, either way, MUST be journaled with its origin: a terminal, the command line
  without one, the MCP, or the owner's confirmation in the dashboard.
- **FR-095**: Rusuban's runs MUST NOT reach the settings: the MCP server is in every run's disallowed
  tools, the owner's commands in its deny rules, and both refuse to run inside a run. The security model
  (`security.md`) states what this stops and what it does not: under the bypass host profile an agent
  has the user's shell, and cheap deny rules on the dashboard's port and the owner's files slow it
  without stopping it. That residual risk covers the confirmation card of FR-092 too.
- **FR-096**: A project MAY have no repo: a section of its own for tasks about no repo's items
  (publications, say), decided by Etienne on 2026-11-10. It holds its tasks, their runs and
  conversations; nothing is read, judged or merged on GitHub for it. Creating one applies at once, from
  a command or the MCP: it starts nothing by itself, and each of its tasks waits for the owner (FR-092).
  Its page shows its tasks and runs where a graph or a kanban would be empty.
- **FR-097**: A project's section MUST show only its own tasks, runs and conversations, as Etienne
  chose on 2026-11-10: the Agents and Conversations views and the header's runs are the shown
  project's, and no row names its project. The machines show in a project with a repo. A task naming
  none of the instance's projects shows in every section, its error naming the project it names. The
  inbox still gathers every project's cards.

**Team (P3, after v1)**

- **FR-080**: Every person named as an owner or a card recipient MUST be a GitHub login, even with one
  user (v1). `agent` and `third` are the only owners that are not people.
- **FR-081** (after v1): An instance MUST claim an item on GitHub before working on it and skip items
  claimed by another instance.

### Key Entities

- **Instance**: one person's running pilot: their logins, channels, projects, machines, state.
- **Project**: repos + local folders + rules + hard locks + tasks + machines in use.
- **Item**: an issue or PR, with its live GitHub state.
- **Judgment**: the agent's reading of an item: kind, owner (a login or the agent), waits-on, next step.
- **Decision card**: a question to one person, with options and their effects; resolved by an answer.
- **Rule set**: the text rules in the project repo, plus the built-in and project hard locks.
- **Run**: one headless session (coordinator, worker or task): session id, folder, items, leases, status.
- **Conversation**: any Claude Code session in a project folder, its origin and its links to items.
- **Machine** and **Lease**: a test machine, its capabilities and probe state; an exclusive, expiring hold.
- **Task**: a recurring text-defined job.
- **Channel**: a ping destination (push, Slack, Discord, Teams, e-mail) and its settings.

## Success Criteria

### Measurable Outcomes

- **SC-001**: From a machine with `gh` and `claude` logged in, install to first dashboard with a
  connected repo in under 10 minutes.
- **SC-002**: The OpenScreen pilot runs on the generic product with zero OpenScreen-specific string in
  the product code (examples aside).
- **SC-003**: A new Claude session in a project folder appears in the hub within 1 minute; at least 90 %
  of sessions about an item are linked to it.
- **SC-004**: From a ping, reading and answering a card takes 3 taps or fewer on a phone.
- **SC-005**: Zero automatic merges with a hard lock broken, proven by adversarial fixtures (rules edited
  in the PR, injected instructions, red CI, moved head).
- **SC-006**: Never two agents on one machine at once; a dead agent's lease is freed within its expiry.
- **SC-007**: Enrolling a new SSH machine takes under 5 minutes.
- **SC-008**: The dashboard's state answers within 200 ms at the 95th percentile on an instance of
  OpenScreen's size (some 80 open items, 1,100 conversations, 76 runs), during a GitHub read and while
  a judge takes up 52 cards, however many pages are open, and while builds keep every core and the
  disk busy (Etienne's requests of 2026-11-11).

## Assumptions

- Claude Code keeps storing sessions as JSON lines under `~/.claude/projects/<folder>/`, Desktop sessions
  included (verified on 2026-11-04), with `sessionId`, `cwd`, `gitBranch` and `entrypoint` fields. The
  format is internal: the hub parses it defensively.
- Agents run on the instance host and reach other machines over SSH; nothing runs Claude on them.
- Users run agents on their own Claude plan or API key, within its usage limits.
- GitHub is the only forge; `gh` is the GitHub client.
- Remote access relies on Tailscale; no account system in v1.
- The OpenScreen pilot's history (judgments, journal) is not imported; it stays archived read-only.

## Next steps

Done: the name ([naming.md](naming.md)), the plan, the tasks, the analysis ([analysis.md](analysis.md))
and the reflection on machines and people ([reflection-team-and-machines.md](reflection-team-and-machines.md)).
Next: Phase 2 and its amendments, then mockups before each interface phase, then the OpenScreen switch.
