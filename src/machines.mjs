// Machines (FR-060 to FR-064, research R9): the owner's test machines, the checks that enroll them,
// their probes, and their leases. A lease is held on the machine itself, a folder `<workspace>/.lease`
// made by an atomic `mkdir` over SSH, so the machine arbitrates; waiters queue on the host, first
// come first served, in `leases/queue.json` under a host lock. A person's desktop (a machine with an
// `owner`) is never leased without that person's yes.
//
// Every command on a machine goes through `exec(machine, command)`: one script per command, POSIX sh
// on macOS and Linux, Windows PowerShell on Windows, sent over SSH as the agent account, or run on
// the host itself when `ssh` is null. Tests pass their own `exec`, so none of them reaches a machine.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { agentLog, homePath, journal, PROJECT_ID, read, write } from "./home.mjs";

// ── Registry (T066) ───────────────────────────────────────────────────────────────────────────
export const OSES = ["windows", "macos", "linux"];
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/; // a machine's name, and a capability tag
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const USER = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/;
// What ssh takes as a host: never an option (a leading dash), never a user (agentUser is the user).
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}$/;
// Absolute, or under the agent account's home (~/), with no character a shell or cmd.exe would
// read, so every script quotes it the plain way.
const WORKSPACE = /^(~|[A-Za-z]:)?[\\/][\w .~\\/-]+$/;
const RUN = /^[A-Za-z0-9][\w.-]{0,99}$/; // a run id, also the name of its folder on a machine

// Checks the machines of config.json and fills what is not policy: no capability tag, the `rusuban`
// agent account, a workspace in its home, leases of an hour at most. Two entries for one SSH alias
// would be two leases on one machine (SC-006).
export function validateMachines(raw) {
	const list = raw ?? [];
	if (!Array.isArray(list)) throw new Error("invalid machines:\n- machines must be a list");
	const errors = [];
	const names = new Set();
	const aliases = new Set();
	const machines = list.map((m, i) => {
		const at = `machines[${i}]`;
		const name = m?.name;
		if (!NAME.test(name ?? ""))
			errors.push(`${at}.name must be lowercase letters, digits and dashes`);
		else if (names.has(name)) errors.push(`${at}.name "${name}" is used twice`);
		else names.add(name);
		if (!OSES.includes(m?.os)) errors.push(`${at}.os must be ${OSES.join(", ")}`);
		const ssh = m?.ssh;
		const alias = String(ssh).toLowerCase();
		if (ssh !== null && !ALIAS.test(ssh ?? ""))
			errors.push(
				`${at}.ssh must be an SSH alias, without user or leading dash, or null for this host`,
			);
		else if (aliases.has(alias))
			errors.push(
				`${at}.ssh ${ssh ?? "null (this host)"} is another machine already: one machine, one lease`,
			);
		else aliases.add(alias);
		const caps = m?.caps ?? [];
		if (!Array.isArray(caps) || !caps.every((c) => NAME.test(c)))
			errors.push(`${at}.caps must be a list of tags: lowercase letters, digits and dashes`);
		const workspace = String(m?.workspace ?? "~/rusuban").replace(/[\\/]+$/, "");
		if (!WORKSPACE.test(workspace))
			errors.push(
				`${at}.workspace must be absolute or start with ~/, in letters, digits, spaces and . _ - ~ / \\`,
			);
		const agentUser = m?.agentUser ?? "rusuban";
		if (!USER.test(agentUser)) errors.push(`${at}.agentUser must be an account name`);
		if (m?.owner !== undefined && !LOGIN.test(m.owner))
			errors.push(`${at}.owner must be the GitHub login of the person whose desktop it is`);
		const maxLeaseMin = m?.maxLeaseMin ?? 60;
		if (!Number.isInteger(maxLeaseMin) || maxLeaseMin < 1)
			errors.push(`${at}.maxLeaseMin must be a positive integer`);
		return {
			name,
			os: m?.os,
			ssh,
			caps,
			workspace,
			agentUser,
			...(m?.owner ? { owner: m.owner } : {}),
			maxLeaseMin,
		};
	});
	if (errors.length) throw new Error(`invalid machines:\n- ${errors.join("\n- ")}`);
	return machines;
}

// ── Commands on a machine ─────────────────────────────────────────────────────────────────────
// A command is `{ op, ...args }`, written as one script in the machine's shell. A script exits 3
// when the lease is not the caller's to take, renew or clear; ssh itself exits 255 when it cannot
// reach the machine or log in.
const REFUSED = 3;
const UNREACHABLE = 255;
const shq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const psq = (s) => `'${String(s).replaceAll("'", "''")}'`;
// A path under the workspace, in each shell; ~ is the agent account's home.
const shAt = (ws, rel) => {
	const p = rel ? `${ws}/${rel}` : ws;
	return /^~[\\/]/.test(p) ? `"$HOME"${shq(p.slice(1))}` : shq(p);
};
const psAt = (ws, rel) => {
	const p = (rel ? `${ws}/${rel}` : ws).replaceAll("/", "\\");
	return p.startsWith("~\\") ? `(Join-Path $HOME ${psq(p.slice(2))})` : psq(p);
};
// JSON in plain ASCII: the same bytes in every shell, file and code page.
const ascii = (v) =>
	JSON.stringify(v).replace(
		/[^\x20-\x7e]/g,
		(c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
// One bare mirror per repo, beside the worktrees of the runs that use it.
const mirrorOf = (c) => `${c.project}/${c.slug.split("/")[1]}.git`;
const urlOf = (slug) => `https://github.com/${slug}.git`;

function shScript(m, c) {
	const holds = c.run && `grep -qF ${shq(`"run":"${c.run}"`)} "$F" 2>/dev/null || exit ${REFUSED}`;
	const json = c.lease && shq(ascii(c.lease));
	const mirror = c.slug && [
		`M=${shAt(m.workspace, mirrorOf(c))}`,
		`if [ -d "$M" ]; then git -C "$M" fetch --prune --quiet origin; else git clone --mirror --quiet ${shq(urlOf(c.slug))} "$M"; fi`,
	];
	const body = {
		read: [`if [ -f "$F" ]; then cat "$F"; elif [ -d "$L" ]; then echo '?'; fi`],
		take: [
			`mkdir "$L" 2>/dev/null || { [ -d "$L" ] && exit ${REFUSED}; echo "cannot create $L" >&2; exit 1; }`,
			`printf '%s\\n' ${json} > "$F" || { rm -rf "$L"; exit 1; }`,
		],
		renew: [holds, `printf '%s\\n' ${json} > "$F"`],
		clear: [
			holds,
			c.project && `rm -rf ${shAt(m.workspace, `${c.project}/${c.run}`)}`,
			`rm -rf "$L"`,
		],
		check: [
			`echo "user=$(id -un)"`,
			`echo "git=$(git --version 2>/dev/null)"`,
			`if [ -d "$W" ]; then echo workspace=yes; else echo workspace=no; fi`,
		],
		mirror,
		worktree: [
			...(mirror ?? []),
			`T=${shAt(m.workspace, `${c.project}/${c.run}`)}`,
			`git -C "$M" worktree prune`,
			`[ -d "$T" ] || git -C "$M" worktree add --detach --quiet "$T"`,
			`echo "$T"`,
		],
		uname: ["uname -s"],
	}[c.op];
	return ["set -e", `W=${shAt(m.workspace)}`, 'L="$W/.lease"', 'F="$L/lease.json"', ...body, ""]
		.filter((l) => typeof l === "string")
		.join("\n");
}

function psScript(m, c) {
	const holds =
		c.run &&
		`if (-not ((Test-Path -LiteralPath $F) -and [IO.File]::ReadAllText($F).Contains(${psq(`"run":"${c.run}"`)}))) { exit ${REFUSED} }`;
	const json = c.lease && psq(ascii(c.lease));
	// cmd's mkdir is atomic (CreateDirectory fails on a folder that exists), and its rmdir removes a
	// junction an agent made without emptying the folder it points to.
	const rmdir = (v) => `if (Test-Path -LiteralPath ${v}) { $null = cmd /c rmdir /s /q ${v} 2>&1 }`;
	const mirror = c.slug && [
		`$M = ${psAt(m.workspace, mirrorOf(c))}`,
		`if (Test-Path -LiteralPath $M) { git -C $M fetch --prune --quiet origin } else { git clone --mirror --quiet ${psq(urlOf(c.slug))} $M }`,
		"if ($LASTEXITCODE) { exit 1 }",
	];
	const worktree = c.run && `$T = ${psAt(m.workspace, `${c.project}/${c.run}`)}`;
	const body = {
		read: [
			"if (Test-Path -LiteralPath $F) { [IO.File]::ReadAllText($F) } elseif (Test-Path -LiteralPath $L) { '?' }",
		],
		take: [
			"$null = cmd /c mkdir $L 2>&1",
			`if ($LASTEXITCODE) { if (Test-Path -LiteralPath $L) { exit ${REFUSED} }; [Console]::Error.WriteLine("cannot create $L"); exit 1 }`,
			`try { [IO.File]::WriteAllText($F, ${json}) } catch { ${rmdir("$L")}; throw }`,
		],
		renew: [holds, `[IO.File]::WriteAllText($F, ${json})`],
		clear: [holds, c.project && worktree, c.project && rmdir("$T"), rmdir("$L")],
		check: [
			'"user=$env:USERNAME"',
			'"git=$(try { git --version } catch {})"',
			"\"workspace=$(if (Test-Path -LiteralPath $W -PathType Container) { 'yes' } else { 'no' })\"",
		],
		mirror,
		worktree: [
			...(mirror ?? []),
			worktree,
			"git -C $M worktree prune",
			"if (-not (Test-Path -LiteralPath $T)) { git -C $M worktree add --detach --quiet $T; if ($LASTEXITCODE) { exit 1 } }",
			"$T",
		],
		uname: ["'Windows'"],
	}[c.op];
	return [
		"$ProgressPreference = 'SilentlyContinue'",
		`$W = ${psAt(m.workspace)}`,
		'$L = Join-Path $W ".lease"',
		'$F = Join-Path $L "lease.json"',
		...body,
	]
		.filter((l) => typeof l === "string")
		.join("\n");
}

// How a script reaches a machine: on the stdin of `sh -s`, or as PowerShell's -EncodedCommand, which
// cmd.exe (Windows OpenSSH's default shell) passes on untouched. Over SSH it logs in as the agent
// account, in batch mode (a key or nothing), and gives up connecting after 5 seconds (research R9).
export function sshArgs(m, script) {
	const windows = m.os === "windows";
	const shell = windows
		? [
				"powershell",
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(script, "utf16le").toString("base64"),
			]
		: ["sh", "-s"];
	const input = windows ? "" : script;
	if (m.ssh === null) return { cmd: shell[0], args: shell.slice(1), input };
	const options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-l", m.agentUser];
	return { cmd: "ssh", args: [...options, "--", m.ssh, shell.join(" ")], input };
}

const TIMEOUT_MS = { mirror: 600_000, worktree: 600_000 }; // a first clone may take minutes

// The real runner: resolves with `{ code, stdout, stderr }`, never rejects; -1 when the command
// could not run or did not finish in time.
export function sshExec(m, c) {
	const { cmd, args, input } = sshArgs(m, (m.os === "windows" ? psScript : shScript)(m, c));
	const timeout = TIMEOUT_MS[c.op] ?? 20_000;
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { timeout, windowsHide: true });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (d) => {
			stdout += d;
		});
		child.stderr.setEncoding("utf8").on("data", (d) => {
			stderr += d;
		});
		child.stdin.on("error", () => {}); // a shell may exit before it reads all of its input
		child.stdin.end(input);
		child.on("error", (e) => resolve({ code: -1, stdout, stderr: e.message }));
		child.on("close", (code, signal) =>
			resolve({
				code: code ?? -1,
				stdout,
				stderr: signal ? `no answer within ${timeout / 1000} s` : stderr,
			}),
		);
	});
}

const reached = (r) => r.code >= 0 && r.code !== UNREACHABLE;
// The first line that says something, PowerShell's serialized progress records left out.
const said = (r) =>
	`${r.stderr ?? ""}\n${r.stdout ?? ""}`
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l && !/^(#< CLIXML|<Objs)/.test(l)) ?? `exit ${r.code}`;

// ── Enrollment (T066, FR-064) ─────────────────────────────────────────────────────────────────
// What `machine add` and `machine doctor` check: SSH answers as the agent account, git is on its
// PATH, the workspace is there. Each check says what it found.
export async function checkMachine(m, { exec = sshExec } = {}) {
	const r = await exec(m, { op: "check" });
	if (!reached(r)) return [{ check: "ssh", ok: false, said: said(r) }];
	if (r.code !== 0)
		return [
			{ check: "ssh", ok: true, said: "answers" },
			{
				check: "shell",
				ok: false,
				said: `${m.os === "windows" ? "PowerShell" : "sh"}: ${said(r)}`,
			},
		];
	const got = {};
	for (const line of r.stdout.split("\n")) {
		const at = line.indexOf("=");
		if (at > 0) got[line.slice(0, at).trim()] = line.slice(at + 1).trim();
	}
	const user = got.user ?? "";
	return [
		{ check: "ssh", ok: true, said: `answers as ${user || "an unknown account"}` },
		{
			check: "account",
			ok: user.toLowerCase() === m.agentUser.toLowerCase(),
			said: `agents work as ${m.agentUser}, never in a person's own account`,
		},
		{ check: "git", ok: !!got.git, said: got.git || "git is not on the agent account's PATH" },
		{
			check: "workspace",
			ok: got.workspace === "yes",
			said: `${m.workspace} ${got.workspace === "yes" ? "is there" : "does not exist: create it as the agent account"}`,
		},
	];
}

// `machine add`: the checks, then one bare mirror per repo of the instance's projects, in the
// workspace. The caller registers the machine once every check passed.
export async function enrollMachine(m, config, { exec = sshExec } = {}) {
	const checks = await checkMachine(m, { exec });
	if (checks.every((c) => c.ok))
		for (const p of config.projects ?? [])
			for (const { slug } of p.repos) {
				const r = await exec(m, { op: "mirror", project: p.id, slug });
				checks.push({
					check: `mirror ${slug}`,
					ok: r.code === 0,
					said: r.code ? said(r) : "ready",
				});
			}
	return { ok: checks.every((c) => c.ok), checks };
}

// The OS behind an alias, for `machine add` without --os: sh answers on macOS and Linux, PowerShell
// on Windows.
export async function detectOs({ ssh, agentUser = "rusuban" }, { exec = sshExec } = {}) {
	const m = { name: "new", ssh, agentUser, caps: [], workspace: "~/rusuban", maxLeaseMin: 60 };
	const r = await exec({ ...m, os: "linux" }, { op: "uname" });
	if (!reached(r)) throw new Error(`cannot reach ${ssh ?? "this host"}: ${said(r)}`);
	const name = r.code === 0 ? r.stdout.trim() : "";
	if (name === "Darwin") return "macos";
	if (name === "Linux") return "linux";
	const w = await exec({ ...m, os: "windows" }, { op: "uname" });
	if (w.code === 0 && w.stdout.trim() === "Windows") return "windows";
	throw new Error(`cannot tell the OS of ${ssh ?? "this host"}: give it with --os`);
}

// ── Probe (T067) ──────────────────────────────────────────────────────────────────────────────
// What a machine's lease folder holds: null when it is free, the lease, or `{ unreadable: true }`
// for a folder without a lease that can be read (a take cut short).
function parseLease(text) {
	const t = text.trim();
	if (!t) return null;
	try {
		const lease = JSON.parse(t);
		if (RUN.test(lease?.run ?? "")) return lease;
	} catch {}
	return { unreadable: true };
}

async function readLease(m, exec) {
	const r = await exec(m, { op: "read" });
	if (r.code !== 0) return { ok: false, reached: reached(r), said: said(r) };
	return { ok: true, lease: parseLease(r.stdout) };
}

// One machine for the page (FR-061): online or offline, and the lease it holds, read in the same
// SSH call.
export async function probeMachine(m, { exec = sshExec, now = Date.now } = {}) {
	const r = await readLease(m, exec);
	const checkedAt = new Date(now()).toISOString();
	if (r.ok) return { name: m.name, state: "online", checkedAt, lease: r.lease };
	return {
		name: m.name,
		state: r.reached ? "online" : "offline",
		checkedAt,
		lease: null,
		said: r.said,
	};
}

// Tailscale's view of the tailnet, when it is installed and logged in.
export const tailscaleStatus = () =>
	new Promise((resolve) =>
		execFile("tailscale", ["status", "--json"], { timeout: 5000, windowsHide: true }, (e, out) => {
			try {
				resolve(e ? null : JSON.parse(out));
			} catch {
				resolve(null);
			}
		}),
	);

// A machine's device in that view: this host's own for `ssh: null`, else the device whose name,
// tailnet name or address is the machine's SSH alias.
function deviceOf(status, m) {
	if (!status?.Self) return null;
	const alias = m.ssh?.toLowerCase();
	const devices = [status.Self, ...Object.values(status.Peer ?? {})];
	const d =
		m.ssh === null
			? status.Self
			: devices.find((p) => {
					const dns = String(p?.DNSName ?? "")
						.toLowerCase()
						.replace(/\.$/, "");
					const names = [String(p?.HostName ?? "").toLowerCase(), dns, dns.split(".")[0]];
					return [...names, ...(p?.TailscaleIPs ?? [])].includes(alias);
				});
	if (!d) return null;
	const online = d === status.Self || d.Online === true;
	return { online, lastSeen: online ? null : (d.LastSeen ?? null) };
}

// Every machine at once, plus Tailscale's word on each when it has one (null otherwise).
export async function probeMachines(config, { tailscale = tailscaleStatus, ...deps } = {}) {
	const machines = validateMachines(config.machines);
	const [status, ...probes] = await Promise.all([
		tailscale(),
		...machines.map((m) => probeMachine(m, deps)),
	]);
	return probes.map((p, i) => ({ ...p, tailnet: deviceOf(status, machines[i]) }));
}

// ── Leases (T068) ─────────────────────────────────────────────────────────────────────────────
const QUEUE = "leases/queue.json"; // { "<machine>": [{ run, pid, since }] }, first come first served
// A lease names its host: only there does its pid mean anything. ponytail: the host name, enough
// while one instance uses a machine; an id of each instance's own once two share one (L2).
const INSTANCE = os.hostname();
// While its holder lives, a lease is renewed to run this long past its renewal, never past
// maxLeaseMin from its start. Another instance, which cannot check the pid, waits for that expiry.
const RENEW_MIN = 5;
const iso = (t) => new Date(t).toISOString();

const isAlive = (pid) => {
	if (!Number.isInteger(pid) || pid < 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === "EPERM";
	}
};

const expiry = (since, m, now) =>
	iso(Math.min(Date.parse(since) + m.maxLeaseMin * 60e3, now + RENEW_MIN * 60e3));

// Whether a lease still holds: until its holder dies (a pid only its own host can check) or its
// expiry passes, and never past maxLeaseMin from its start. A date that does not parse has passed.
function standing(lease, m, now, alive) {
	if (!lease) return "free";
	if (lease.unreadable) return "unreadable";
	if (!(now < Date.parse(lease.since) + m.maxLeaseMin * 60e3)) return "expired";
	if (lease.instance === INSTANCE) return alive(lease.pid) ? "held" : "dead";
	return now < Date.parse(lease.expires) ? "held" : "expired";
}
const FREED = {
	dead: (l) => `run ${l.run}, which held it, is gone`,
	expired: (l) => `the lease of run ${l.run} ran out`,
	unreadable: () => "its lease could not be read",
};

// One lease operation at a time on this host, from the agent CLI or the daemon: a lock file naming
// its writer, taken over once that process is gone or after two minutes. ponytail: taken over
// without compare-and-swap, like the run locks; two instances sharing a machine (L2) need more.
async function withLeaseLock(fn) {
	const file = homePath("leases/lock");
	fs.mkdirSync(homePath("leases"), { recursive: true });
	for (;;) {
		try {
			fs.writeFileSync(file, String(process.pid), { flag: "wx" });
			break;
		} catch (e) {
			if (e.code !== "EEXIST") throw e;
			let stale = false;
			try {
				const pid = Number(fs.readFileSync(file, "utf8"));
				stale = (pid > 0 && !isAlive(pid)) || Date.now() - fs.statSync(file).mtimeMs > 120_000;
			} catch {} // released between the two calls: try again
			if (stale) fs.rmSync(file, { force: true });
			else await sleep(25);
		}
	}
	try {
		return await fn();
	} finally {
		fs.rmSync(file, { force: true });
	}
}

// The queue without the waiters whose process died (a `lease` command killed while it waited), the
// machines gone from the registry, and `drop`.
function pruned(queue, machines, alive, drop = null) {
	const out = {};
	for (const m of machines) {
		const q = (queue[m.name] ?? []).filter((e) => e?.run !== drop && alive(e?.pid));
		if (q.length) out[m.name] = q;
	}
	return out;
}

function candidatesOf(machines, { machine, os: wanted, caps = [] }) {
	if (machine) {
		const m = machines.find((x) => x.name === machine);
		if (!m) throw new Error(`no machine named ${machine}`);
		return [m];
	}
	if (wanted !== undefined && !OSES.includes(wanted))
		throw new Error(`an OS is ${OSES.join(", ")}`);
	if (!Array.isArray(caps)) throw new Error("caps is a list of tags");
	if (!wanted && !caps.length) throw new Error("name a machine, or the OS or tags it needs");
	// A tag matches the machine's OS as well as its own tags: asking for `macos` finds every Mac.
	const fit = machines.filter(
		(m) => (!wanted || m.os === wanted) && caps.every((c) => c === m.os || m.caps.includes(c)),
	);
	if (!fit.length)
		throw new Error(`no machine has ${[wanted, ...caps].filter(Boolean).join(", ")}`);
	return fit;
}

// The agent CLI writes its own journal file and the daemon the journal (principle I): each lease
// function journals as its usual caller, unless told otherwise.
const asAgent = (run) => (project, entry) => agentLog(project, { ...entry, by: `agent:${run}` });
const asServer = (project, entry) => journal(project, { ...entry, by: "server" });
const projectOf = (config, lease) =>
	config.projects?.some((p) => p.id === lease?.project) ? lease.project : null;
const note = (machine, run, text) => ({ kind: "lease", item: null, text, machine, run });

// Clears a lease just read: only while it still holds the run read (exit 3 otherwise), with that
// run's worktree; an unreadable one as it stands. A project read from a machine names a folder only
// once it passes the project id check.
const clearLease = (m, lease, exec) =>
	exec(
		m,
		lease.unreadable
			? { op: "clear", run: null }
			: {
					op: "clear",
					run: lease.run,
					project: PROJECT_ID.test(lease.project ?? "") ? lease.project : null,
				},
	);

// One try at a lease (FR-062). `request`: `{ run, project, reason, machine }` or `{ run, project,
// reason, os, caps }`, plus `slug`, a repo of the project to give the run a worktree of. The run
// joins the queue of each machine that fits, and takes the first whose queue it heads and whose
// lease folder is free, or held by a holder that died or ran out, which it frees first. A person's
// desktop fits only once `approved(machine, run)` says that person said yes; a request only desktops
// fit returns `{ state: "requested", asks }` for the server to make cards of (T070).
//
// Returns `{ state: "held", machine, lease, worktree? }`, `{ state: "queued", position, machines }`
// or `{ state: "requested", run, reason, asks: [{ machine, owner }] }`. The lease's pid is the run's
// runner (runs/<run>/status.json), which lives as long as the run; the waiter is this process.
export async function takeLease(config, request, deps = {}) {
	const {
		exec = sshExec,
		now = Date.now,
		alive = isAlive,
		approved = () => false,
		log = asAgent(request.run),
	} = deps;
	const { run, project, slug } = request;
	if (!RUN.test(run ?? "")) throw new Error("a lease needs the id of the run it is for");
	const p = config.projects?.find((x) => x.id === project);
	if (!p) throw new Error(`unknown project "${project}"`);
	if (slug !== undefined && !p.repos.some((r) => r.slug === slug))
		throw new Error(`${slug} is not a repo of ${project}`);
	const reason = String(request.reason ?? "")
		.trim()
		.slice(0, 200);
	if (!reason) throw new Error("a lease needs a reason");
	const status = read(`runs/${run}/status.json`, null);
	const pid = request.pid ?? (status?.state === "running" ? status.pid : null);
	if (!(Number.isInteger(pid) && pid > 0))
		throw new Error(`run ${run} is not running: a lease lasts as long as its run`);
	const waiter = request.waiter ?? process.pid;
	const machines = validateMachines(config.machines);
	const fit = candidatesOf(machines, request);
	const usable = fit.filter((m) => !m.owner || approved(m.name, run));
	if (!usable.length)
		return {
			state: "requested",
			run,
			reason,
			asks: fit.map((m) => ({ machine: m.name, owner: m.owner })),
		};
	const t = now();
	const { result, again } = await withLeaseLock(async () => {
		const queue = pruned(read(QUEUE, {}), machines, alive);
		for (const m of usable) {
			const q = queue[m.name] ?? [];
			const mine = q.find((e) => e.run === run);
			if (mine) mine.pid = waiter;
			else q.push({ run, pid: waiter, since: iso(t) });
			queue[m.name] = q;
		}
		const leases = await Promise.all(usable.map((m) => readLease(m, exec)));
		let held = null;
		// Asked again for a machine it holds (a `lease` command cut short): it keeps it.
		const own = usable.findIndex((_, i) => leases[i].lease?.run === run);
		if (own >= 0) {
			const m = usable[own];
			const was = leases[own].lease;
			held = { ...was, machine: m.name, expires: expiry(was.since, m, t) };
			await exec(m, { op: "renew", run, lease: held });
		}
		for (const [i, m] of usable.entries()) {
			if (held) break;
			if (!leases[i].ok || queue[m.name][0].run !== run) continue;
			const was = leases[i].lease;
			const st = standing(was, m, t, alive);
			if (st === "held") continue;
			if (st !== "free") {
				if ((await clearLease(m, was, exec)).code !== 0) continue;
				log(project, note(m.name, was.run ?? null, `${m.name} is free again: ${FREED[st](was)}.`));
			}
			const lease = {
				machine: m.name,
				run,
				instance: INSTANCE,
				pid,
				project,
				since: iso(t),
				expires: expiry(iso(t), m, t),
				reason,
			};
			if ((await exec(m, { op: "take", lease })).code === 0) held = lease;
		}
		write(QUEUE, held ? pruned(queue, machines, alive, run) : queue);
		if (held)
			return { result: { state: "held", machine: held.machine, lease: held }, again: own >= 0 };
		const position = Math.min(
			...usable.map((m) => queue[m.name].findIndex((e) => e.run === run) + 1),
		);
		return { result: { state: "queued", position, machines: usable.map((m) => m.name) } };
	});
	if (result.state !== "held") return result;
	const m = machines.find((x) => x.name === result.machine);
	if (slug) {
		const r = await exec(m, { op: "worktree", project, slug, run });
		if (r.code !== 0) {
			if (!again) await releaseLease(config, m.name, run, { exec, log });
			throw new Error(`could not make the run's worktree on ${m.name}: ${said(r)}`);
		}
		result.worktree = r.stdout.trim().split("\n").pop().trim();
	}
	if (!again) log(project, note(m.name, run, `Took ${m.name}: ${reason}`));
	return result;
}

// The `lease` command: tries every `pollMs` until it holds a machine or `request.waitMs` has passed,
// and on giving up leaves the queue. `onState` hears each new state, so that a request for a
// person's yes reaches the server while the run waits.
export async function waitLease(config, request, deps = {}) {
	const { now = Date.now, pause = sleep, pollMs = 5000, onState } = deps;
	const until = now() + (request.waitMs ?? 0);
	let last = null;
	for (;;) {
		const r = await takeLease(config, request, deps);
		if (r.state !== last) onState?.(r);
		last = r.state;
		if (r.state === "held") return r;
		if (now() >= until) {
			const machines = validateMachines(config.machines);
			await withLeaseLock(() =>
				write(QUEUE, pruned(read(QUEUE, {}), machines, deps.alive ?? isAlive, request.run)),
			);
			return r;
		}
		await pause(Math.min(pollMs, until - now()));
	}
}

// Ends a lease and removes its run's worktree: the run's own (`release <machine>`), or whoever holds
// it when `run` is null (the owner, from the dashboard). False when there was nothing to end.
export async function releaseLease(config, name, run, deps = {}) {
	const { exec = sshExec, log = run ? asAgent(run) : asServer } = deps;
	const m = validateMachines(config.machines).find((x) => x.name === name);
	if (!m) throw new Error(`no machine named ${name}`);
	return withLeaseLock(async () => {
		const r = await readLease(m, exec);
		if (!r.ok) throw new Error(`cannot read the lease of ${name}: ${r.said}`);
		const lease = r.lease;
		if (!lease || (run && lease.run !== run)) return false;
		if ((await clearLease(m, lease, exec)).code !== 0) return false;
		const p = projectOf(config, lease);
		const by = run ? "" : `, held by run ${lease.run ?? "unknown"}`;
		if (p) log(p, note(name, lease.run ?? null, `Released ${name}${by}`));
		return true;
	});
}

// A run that ends gives back what it still holds and leaves every queue.
export async function releaseRun(config, run, deps = {}) {
	const { exec = sshExec, alive = isAlive, log = asAgent(run) } = deps;
	const machines = validateMachines(config.machines);
	return withLeaseLock(async () => {
		write(QUEUE, pruned(read(QUEUE, {}), machines, alive, run));
		const given = await Promise.all(
			machines.map(async (m) => {
				const r = await readLease(m, exec);
				if (r.lease?.run !== run || (await clearLease(m, r.lease, exec)).code !== 0) return null;
				const p = projectOf(config, r.lease);
				if (p) log(p, note(m.name, run, `Released ${m.name}: the run ended`));
				return m.name;
			}),
		);
		return given.filter(Boolean);
	});
}

// The daemon, at each probe: a lease whose holder lives is renewed; one whose holder died or ran out
// is freed, and the journal says so (US5 scenario 3). Dead waiters leave the queue.
export async function tendLeases(config, deps = {}) {
	const { exec = sshExec, now = Date.now, alive = isAlive, log = asServer } = deps;
	const machines = validateMachines(config.machines);
	const t = now();
	return withLeaseLock(async () => {
		write(QUEUE, pruned(read(QUEUE, {}), machines, alive));
		const freed = await Promise.all(
			machines.map(async (m) => {
				const { lease } = await readLease(m, exec);
				if (!lease) return null;
				const st = standing(lease, m, t, alive);
				if (st === "held") {
					if (lease.instance === INSTANCE)
						await exec(m, {
							op: "renew",
							run: lease.run,
							lease: { ...lease, expires: expiry(lease.since, m, t) },
						});
					return null;
				}
				if ((await clearLease(m, lease, exec)).code !== 0) return null;
				const p = projectOf(config, lease);
				if (p)
					log(p, note(m.name, lease.run ?? null, `${m.name} is free again: ${FREED[st](lease)}.`));
				return { machine: m.name, run: lease.run ?? null, why: st };
			}),
		);
		return freed.filter(Boolean);
	});
}
