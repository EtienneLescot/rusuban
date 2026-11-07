# Naming search (2026-11-07)

**Decision**: rusuban, chosen by Etienne on 2026-11-07.

Four agents (navigation metaphors, delegation and backstage, coined names, trending open-source
patterns) screened about 650 names. Every finalist below was re-checked on 2026-11-07: free on npm,
including every hyphenated variant (npm refuses a name that matches an existing package once
punctuation is removed), and no same-name GitHub repo above 27 stars.

## What works for open-source names in 2026

- One lowercase word that is the repo, the package and the CLI, never "ai" or "agent".
- Real words used as a metaphor lead the breakouts (superpowers, ponytail, hindsight); puns second.
- 5 to 10 letters. A persona beats a category; the tagline carries the meaning.
- The agent-orchestrator namespace is saturated: most "works while you're away" words already have a
  small agent repo (nightporter, skeletoncrew, yardmaster, trailboss, autosteer, tracon, airboss…).

Sources: [GitHub Trending](https://github.com/trending?since=monthly),
[glukhov.org, Oct 2026](https://glukhov.org/developer-tools/comparisons/trending-open-source-ai-projects/).

## Finalists

| Name | Story | Biggest same-name repo | Notes |
|---|---|---|---|
| **rusuban** | Japanese 留守番: who minds the house while you're out; *rusuban denwa* is the answering machine. It runs the project, keeps every conversation, calls you back. | 0★ | Unknown word: the tagline carries it. Said as it is written, in English and French. |
| **loran** | The radio-beacon system ships used to fix their position: finding your bearings. | 11★ | Short, easy. Says "bearings", not "autonomy". A small Canadian firm and a first name. |
| **aweigh** | "Anchors aweigh": the ship gets underway; sounds like "away". Found by two agents. | 1★ | People will type "away". Unknown in French. |
| **vigilot** | vigil + pilot: watches and steers. | none | Coined; pronunciation hesitates (VIJ-ih-lot or vi-ji-LO). |
| lotse | German harbour pilot; *Fluglotse* is air traffic control. | 27★ | Earlier pick. |
| nightorders | A captain's written orders for the night watch, including when to wake him: exactly the rules file. | none | Long as a CLI; better as the name of the rules file. |
| gonefishing | "Gone fishing. Your project isn't." | 4★ | Playful persona, long to type. |

## Other survivors

selfsteer, pilotine, setcourse, coastpilot, offing, shipkeeper, dogsbody, makeway, firman, stagecall,
consigne, tanist, housesit, itaku, naviso, steerly, dirigo, navilot, lenk, underway, harbormaster.

Rejected for collisions: pilotage (npm, a spec-driven development tool), onwatch (an AI quota tracker,
771★), callboard (a to-do list for coding agents), intendant (an agent environment), wend (a LinkedIn
trademark), and most nautical and crew words.
