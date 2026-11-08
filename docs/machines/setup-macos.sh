#!/bin/sh
# Prepares a Mac for Rusuban's agents (docs/machines/README.md):
# - Remote Login (SSH) on, the `rusuban` account allowed in it;
# - the `rusuban` account: a standard user, not an administrator, with a random password nobody
#   keeps, so only the key given gets in;
# - the workspace ~/rusuban, and git from the Command Line Tools.
# Run it with sudo on the Mac, with the public key of the host where Rusuban runs:
#   sudo sh setup-macos.sh "ssh-ed25519 AAAA... you@host"
# Running it again changes nothing that is already in place.
set -eu

KEY=${1:-}
NAME=rusuban
case "$KEY" in
ssh-* | ecdsa-* | sk-*) ;;
*)
	echo "usage: sudo sh setup-macos.sh \"<the host's public key line>\"" >&2
	exit 1
	;;
esac
if [ "$(id -u)" -ne 0 ]; then
	echo "run it with sudo: sudo sh setup-macos.sh ..." >&2
	exit 1
fi
if ! xcrun --find git >/dev/null 2>&1; then
	echo "git is missing: xcode-select --install, then run this again" >&2
	exit 1
fi

if ! id "$NAME" >/dev/null 2>&1; then
	sysadminctl -addUser "$NAME" -fullName "Rusuban agents" -password "$(openssl rand -base64 24)" \
		-home "/Users/$NAME"
	createhomedir -c -u "$NAME" >/dev/null
fi

if ! systemsetup -setremotelogin on >/dev/null 2>&1 &&
	! launchctl load -w /System/Library/LaunchDaemons/ssh.plist >/dev/null 2>&1; then
	echo "turn on Remote Login in System Settings > General > Sharing, then run this again" >&2
	exit 1
fi
# When Remote Login is limited to some users, the account joins them; otherwise nothing to do.
dseditgroup -o edit -a "$NAME" -t user com.apple.access_ssh >/dev/null 2>&1 || true

HOME_DIR=/Users/$NAME
install -d -m 700 -o "$NAME" -g staff "$HOME_DIR/.ssh" "$HOME_DIR/rusuban"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$KEY" "$AUTH" || printf '%s\n' "$KEY" >>"$AUTH"
chown "$NAME:staff" "$AUTH"
chmod 600 "$AUTH"

echo "Ready. On the Rusuban host: ssh -l $NAME <alias> exit (once, to accept its host key),"
echo "then rusuban machine add <alias>."
