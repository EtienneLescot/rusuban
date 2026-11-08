#!/bin/sh
# Prepares a Linux machine for Rusuban's agents (docs/machines/README.md):
# - an OpenSSH server and git, from the distribution's packages;
# - the `rusuban` account: a home, no password and no sudo, reached only with the key given;
# - the workspace ~/rusuban.
# Run it as root on the machine, with the public key of the host where Rusuban runs:
#   sudo sh setup-linux.sh "ssh-ed25519 AAAA... you@host"
# Running it again changes nothing that is already in place.
set -eu

KEY=${1:-}
NAME=rusuban
case "$KEY" in
ssh-* | ecdsa-* | sk-*) ;;
*)
	echo "usage: sudo sh setup-linux.sh \"<the host's public key line>\"" >&2
	exit 1
	;;
esac
if [ "$(id -u)" -ne 0 ]; then
	echo "run it as root: sudo sh setup-linux.sh ..." >&2
	exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
	apt-get update -q && apt-get install -y -q openssh-server git
elif command -v dnf >/dev/null 2>&1; then
	dnf install -y -q openssh-server git
elif command -v pacman >/dev/null 2>&1; then
	pacman -S --needed --noconfirm openssh git
elif command -v zypper >/dev/null 2>&1; then
	zypper -n install openssh git
else
	echo "install an OpenSSH server and git with your package manager, then run this again" >&2
	exit 1
fi
systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd

# "*" rather than a locked password: no password works, and a key still does whatever sshd's PAM
# settings are.
if ! id "$NAME" >/dev/null 2>&1; then
	useradd --create-home --shell "$(command -v bash || echo /bin/sh)" "$NAME"
	usermod -p '*' "$NAME"
fi
HOME_DIR=$(getent passwd "$NAME" | cut -d: -f6)
GROUP=$(id -gn "$NAME")
install -d -m 700 -o "$NAME" -g "$GROUP" "$HOME_DIR/.ssh" "$HOME_DIR/rusuban"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$KEY" "$AUTH" || printf '%s\n' "$KEY" >>"$AUTH"
chown "$NAME:$GROUP" "$AUTH"
chmod 600 "$AUTH"

echo "Ready. On the Rusuban host: ssh -l $NAME <alias> exit (once, to accept its host key),"
echo "then rusuban machine add <alias>."
