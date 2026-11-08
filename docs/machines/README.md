# Test machines

Agents run a project's tests and measures on other machines too: a Mac for what only macOS shows, a
Windows box with a GPU, a Linux server. Rusuban reaches them over SSH and gives each to one run at a
time, through a lease held on the machine itself.

## What a machine needs

- **An SSH server**, reachable from the host where Rusuban runs: on your network or your tailnet.
- **An account of its own for the agents**, `rusuban`:
  - a standard user, never an administrator, and never your own account;
  - reached with the host's SSH key only, no password.
- **git** on that account's PATH.
- **A workspace**, `~/rusuban` by default. It holds one bare mirror per repo and a worktree per run,
  removed when the run ends.

Agents run code there: the project's tests, and a contributor's when they measure a PR. Keep nothing
on that account you would not show them.

## Adding one

1. **On the host**, have an SSH key (`ssh-keygen -t ed25519` if `~/.ssh/id_ed25519.pub` does not
   exist). Give the machine a short alias in `~/.ssh/config`:

   ```
   Host mac
     HostName mac.example-tailnet.ts.net
   ```

   Agents type the alias, never the address: a command naming a `.ts.net` address is refused to them
   (`docs/security.md`).

2. **On the machine**, run the script for its system with the host's public key, as an
   administrator. Each script can run again safely.

   | System | Command |
   |---|---|
   | Linux (apt, dnf, pacman or zypper) | `sudo sh setup-linux.sh "$(cat id_ed25519.pub)"` |
   | macOS | `sudo sh setup-macos.sh "$(cat id_ed25519.pub)"` |
   | Windows, PowerShell as administrator | `.\setup-windows.ps1 -Key (Get-Content id_ed25519.pub)` |

   - **Linux**: the script installs the OpenSSH server and git, and starts the server.
   - **macOS**: it needs git from the Command Line Tools (`xcode-select --install`), and turns on
     Remote Login.
   - **Windows**: it installs the OpenSSH server, opens port 22, and installs Git for Windows with
     winget if it is missing.

3. **Back on the host**:
   - connect once, to accept the machine's host key: `ssh -l rusuban mac exit`. Rusuban connects in
     batch mode and refuses a host key it has not seen.
   - then add the machine:

   ```sh
   rusuban machine add mac --caps gpu,screen-capture
   ```

   It checks SSH, the account, git and the workspace, and makes the bare mirrors. A machine is one
   more place where agents run code, so the change waits for your confirmation: type its name in a
   terminal, or allow the card in the dashboard when Claude asked for it.

`rusuban machine doctor mac` runs the same checks again. `rusuban machine probe` shows what the
dashboard shows: online or offline, free or leased, and by which run.

## Your own desktop

Add it with `--owner <your GitHub login>`.

- A run asks you on a card before it takes your desktop, and only when it names it, or when nothing
  else fits.
- A run that does not hold its lease is refused the desktop's alias: a hook checks each of its shell
  commands.
- In v0.1 the desktop must be yours, the owner of the instance: you are the one person with a
  dashboard to say yes in.

## How agents use a machine

A run takes a machine with `rusuban lease <machine> --reason <why>`, or with `--os` and `--caps` for
any machine that fits.

- With `--repo <owner/repo>`, the run gets its own worktree there.
- The lease ends with `rusuban release <machine>`, at the latest when the run ends, and never lasts
  past the machine's `maxLeaseMin` (60 minutes by default).
- A dead run's lease frees the machine at its expiry.
- The dashboard's Release button ends any lease.
