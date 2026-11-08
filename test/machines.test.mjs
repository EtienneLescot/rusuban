import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { read, readJournal } from "../src/home.mjs";
import {
	checkMachine,
	detectOs,
	enrollMachine,
	probeMachines,
	releaseLease,
	releaseRun,
	sshArgs,
	sshExec,
	takeLease,
	tendLeases,
	validateMachines,
	waitLease,
} from "../src/machines.mjs";

const T0 = Date.parse("2026-11-08T10:00:00.000Z");
const MIN = 60_000;
const iso = (t) => new Date(t).toISOString();
let clock;
let live; // the pids still running: 10n are the runs' runners, 20n their `lease` commands

beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-machines-"));
	clock = { t: T0 };
	live = new Set([101, 102, 103, 104, 105, 201, 202, 203, 204, 205]);
});

const mac = (name, more = {}) => ({ name, os: "macos", ssh: name, ...more });
const config = (...machines) => ({
	projects: [{ id: "demo", repos: [{ slug: "o/r" }, { slug: "o/site" }] }],
	machines,
});
// Run n asks: its runner (pid 10n) holds the lease, its `lease` command (pid 20n) waits.
const ask = (n, more = {}) => ({
	run: `worker-${n}`,
	pid: 100 + n,
	waiter: 200 + n,
	project: "demo",
	reason: `e2e ${n}`,
	...more,
});

// The machines as the lease module reaches them, in memory: each one's lease folder (absent, empty,
// or holding a lease), whether it answers, and every command sent. A take is atomic, as an mkdir is.
function fleet(...names) {
	const disks = Object.fromEntries(names.map((n) => [n, { lease: undefined, offline: false }]));
	const sent = [];
	const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
	const refused = { code: 3, stdout: "", stderr: "" };
	async function exec(m, c) {
		await null; // a real command takes time: other waiters run meanwhile
		const { lease, ...rest } = c;
		sent.push({ machine: m.name, ...rest });
		const d = disks[m.name];
		if (d.offline)
			return { code: 255, stdout: "", stderr: `ssh: connect to host ${m.ssh} port 22: timed out` };
		const holds = d.lease !== undefined && !!c.run && d.lease.includes(`"run":"${c.run}"`);
		if (c.op === "read") return ok(d.lease === undefined ? "" : d.lease || "?");
		if (c.op === "take") {
			if (d.lease !== undefined) return refused;
			d.lease = JSON.stringify(lease);
			return ok();
		}
		if (c.op === "renew") {
			if (!holds) return refused;
			d.lease = JSON.stringify(lease);
			return ok();
		}
		if (c.op === "clear") {
			if (c.run && !holds) return refused;
			d.lease = undefined;
			return ok();
		}
		if (c.op === "worktree") return ok(`/home/rusuban/rusuban/${c.project}/${c.run}\n`);
		throw new Error(`no ${c.op} in this fake`);
	}
	return { exec, disks, sent, lease: (n) => JSON.parse(disks[n].lease) };
}
const deps = (f, more = {}) => ({
	exec: f.exec,
	now: () => clock.t,
	alive: (pid) => live.has(pid),
	...more,
});
const texts = () => readJournal("demo").map((e) => e.text);

test("a machine is described once: what is not policy is filled, the rest checked together", () => {
	assert.deepEqual(validateMachines([mac("mac")]), [
		{
			name: "mac",
			os: "macos",
			ssh: "mac",
			caps: [],
			workspace: "~/rusuban",
			agentUser: "rusuban",
			maxLeaseMin: 60,
		},
	]);
	const [desk] = validateMachines([
		{
			name: "desk",
			os: "windows",
			ssh: null,
			caps: ["display", "webcam"],
			workspace: "C:\\Users\\RUNNER~1\\rusuban\\",
			agentUser: "etienne",
			owner: "alice",
			maxLeaseMin: 30,
		},
	]);
	assert.equal(desk.workspace, "C:\\Users\\RUNNER~1\\rusuban");
	assert.equal(desk.owner, "alice");
	assert.throws(() => validateMachines({}), /machines must be a list/);
	assert.throws(
		() =>
			validateMachines([
				mac("Mac"),
				{ name: "lin", os: "ubuntu", ssh: "-oProxyCommand=calc" },
				{ name: "lin", os: "linux", ssh: "rusuban@lin" },
				{
					name: "win",
					os: "windows",
					caps: ["GPU"],
					workspace: "rusuban; rm -rf ~",
					agentUser: "a b",
					owner: "not a login",
					maxLeaseMin: 0,
				},
				{ name: "mac2", os: "macos", ssh: "MAC" },
				{ name: "root", os: "linux", ssh: "root", workspace: "/" },
			]),
		(e) => {
			for (const line of [
				"machines[0].name must be lowercase letters, digits and dashes",
				"machines[1].os must be windows, macos, linux",
				"machines[1].ssh must be an SSH alias",
				'machines[2].name "lin" is used twice',
				"machines[2].ssh must be an SSH alias",
				"machines[3].ssh must be an SSH alias",
				"machines[3].caps must be a list of tags",
				"machines[3].workspace must be absolute",
				"machines[3].agentUser must be an account name",
				"machines[3].owner must be the GitHub login",
				"machines[3].maxLeaseMin must be a positive integer",
				"machines[4].ssh MAC is another machine already",
				"machines[5].workspace must be absolute",
			])
				assert.ok(e.message.includes(line), line);
			return true;
		},
	);
});

test("two waiters are served in the order they asked, whoever tries first (US5 scenario 2)", async () => {
	const f = fleet("mac");
	const c = config(mac("mac"));
	const d = deps(f);
	assert.equal((await takeLease(c, ask(1, { machine: "mac" }), d)).state, "held");
	const queued = (position) => ({ state: "queued", position, machines: ["mac"] });
	assert.deepEqual(await takeLease(c, ask(2, { machine: "mac" }), d), queued(1));
	assert.deepEqual(await takeLease(c, ask(3, { machine: "mac" }), d), queued(2));
	assert.equal(await releaseLease(c, "mac", "worker-1", d), true);
	// The third run tries first on the free machine: the second still comes before it.
	assert.deepEqual(await takeLease(c, ask(3, { machine: "mac" }), d), queued(2));
	assert.equal(f.disks.mac.lease, undefined);
	const second = await takeLease(c, ask(2, { machine: "mac" }), d);
	assert.equal(second.state, "held");
	assert.equal(f.lease("mac").run, "worker-2");
	assert.deepEqual(read("leases/queue.json"), {
		mac: [{ run: "worker-3", pid: 203, since: iso(T0) }],
	});
	assert.deepEqual(await takeLease(c, ask(3, { machine: "mac" }), d), queued(1));
	// A waiter whose `lease` command was killed loses its place.
	live.delete(203);
	assert.deepEqual(await takeLease(c, ask(4, { machine: "mac" }), d), queued(1));
});

test("never two runs on one machine, however many ask at once (SC-006)", async () => {
	const f = fleet("mac");
	const c = config(mac("mac"));
	const tries = await Promise.all(
		[1, 2, 3, 4, 5].map((n) => takeLease(c, ask(n, { machine: "mac" }), deps(f))),
	);
	assert.equal(tries.filter((r) => r.state === "held").length, 1);
	assert.deepEqual(
		tries.map((r) => r.position ?? 0).sort(),
		[0, 1, 2, 3, 4],
		"each of the others waits in its own place",
	);
	assert.equal(f.sent.filter((s) => s.op === "take").length, 1);
});

test("a holder that died frees the machine, with its worktree, and the journal says so (US5 scenario 3)", async () => {
	const f = fleet("mac");
	const c = config(mac("mac"));
	const d = deps(f);
	const first = await takeLease(c, ask(1, { machine: "mac", slug: "o/r" }), d);
	assert.equal(first.worktree, "/home/rusuban/rusuban/demo/worker-1");
	assert.equal((await takeLease(c, ask(2, { machine: "mac" }), d)).state, "queued");
	live.delete(101); // worker-1's runner is gone, well before any expiry
	assert.equal((await takeLease(c, ask(2, { machine: "mac" }), d)).state, "held");
	assert.ok(
		f.sent.some((s) => s.op === "clear" && s.run === "worker-1" && s.project === "demo"),
		"its worktree goes with its lease",
	);
	assert.ok(texts().includes("mac is free again: run worker-1, which held it, is gone."));
	// With nobody waiting, the daemon frees it at its next probe.
	live.delete(102);
	assert.deepEqual(await tendLeases(c, d), [{ machine: "mac", run: "worker-2", why: "dead" }]);
	assert.equal(f.disks.mac.lease, undefined);
	const last = readJournal("demo").at(-1);
	assert.equal(last.by, "server");
	assert.equal(last.text, "mac is free again: run worker-2, which held it, is gone.");
});

test("a lease ends at maxLeaseMin even with its holder alive; renewed until then (SC-006)", async () => {
	const f = fleet("mac");
	const c = config(mac("mac", { maxLeaseMin: 30 }));
	const d = deps(f);
	await takeLease(c, ask(1, { machine: "mac" }), d);
	assert.equal(f.lease("mac").expires, iso(T0 + 5 * MIN));
	clock.t = T0 + 4 * MIN;
	assert.deepEqual(await tendLeases(c, d), []);
	assert.equal(f.lease("mac").expires, iso(T0 + 9 * MIN), "renewed while its run lives");
	clock.t = T0 + 28 * MIN;
	await tendLeases(c, d);
	assert.equal(f.lease("mac").expires, iso(T0 + 30 * MIN), "never past maxLeaseMin");
	clock.t = T0 + 30 * MIN - 1;
	assert.equal((await takeLease(c, ask(2, { machine: "mac" }), d)).state, "queued");
	clock.t = T0 + 30 * MIN;
	assert.equal((await takeLease(c, ask(2, { machine: "mac" }), d)).state, "held");
	assert.ok(texts().includes("mac is free again: the lease of run worker-1 ran out."));
});

test("the machine arbitrates: another instance's lease holds until its expiry", async () => {
	const f = fleet("mac");
	const c = config(mac("mac"));
	const d = deps(f);
	// Its pid means nothing here: only its expiry counts.
	f.disks.mac.lease = JSON.stringify({
		machine: "mac",
		run: "judge-1",
		instance: "another-host",
		pid: 999,
		project: "demo",
		since: iso(T0),
		expires: iso(T0 + 5 * MIN),
		reason: "theirs",
	});
	assert.equal((await takeLease(c, ask(1, { machine: "mac" }), d)).state, "queued");
	assert.deepEqual(await tendLeases(c, d), []);
	assert.equal(f.lease("mac").expires, iso(T0 + 5 * MIN), "another instance renews its own");
	clock.t = T0 + 5 * MIN;
	assert.equal((await takeLease(c, ask(1, { machine: "mac" }), d)).state, "held");
	// A folder without a lease that can be read (a take cut short) is freed too.
	await releaseLease(c, "mac", "worker-1", d);
	f.disks.mac.lease = "";
	assert.equal((await takeLease(c, ask(2, { machine: "mac" }), d)).state, "held");
	assert.ok(texts().includes("mac is free again: its lease could not be read."));
});

test("a run asking for an OS or tags gets any free machine that has them (US5 scenario 2)", async () => {
	const f = fleet("mac1", "mac2", "lin");
	const lin = { name: "lin", os: "linux", ssh: "lin", caps: ["display", "gpu"] };
	const c = config(mac("mac1"), mac("mac2"), lin);
	const d = deps(f);
	assert.equal((await takeLease(c, ask(1, { os: "macos" }), d)).machine, "mac1");
	assert.equal((await takeLease(c, ask(2, { caps: ["macos"] }), d)).machine, "mac2");
	assert.deepEqual(await takeLease(c, ask(3, { os: "macos" }), d), {
		state: "queued",
		position: 1,
		machines: ["mac1", "mac2"],
	});
	assert.equal((await takeLease(c, ask(4, { caps: ["display", "gpu"] }), d)).machine, "lin");
	await assert.rejects(
		takeLease(c, ask(5, { os: "linux", caps: ["webcam"] }), d),
		/no machine has linux, webcam/,
	);
	await assert.rejects(takeLease(c, ask(5, { machine: "pi" }), d), /no machine named pi/);
	await assert.rejects(takeLease(c, ask(5), d), /name a machine, or the OS or tags it needs/);
	// The first Mac to come free serves the waiter, which leaves the other Mac's queue.
	await releaseLease(c, "mac2", "worker-2", d);
	assert.equal((await takeLease(c, ask(3, { os: "macos" }), d)).machine, "mac2");
	assert.deepEqual(read("leases/queue.json"), {});
});

test("a person's desktop waits for that person's yes, and is not touched before (US5 scenario 4)", async () => {
	const f = fleet("lab", "desk");
	const desk = mac("desk", { owner: "alice", caps: ["webcam"] });
	const c = config(mac("lab"), desk);
	const yes = new Set();
	const d = deps(f, { approved: (machine, run) => yes.has(`${machine} ${run}`) });
	const request = { state: "requested", run: "worker-1", reason: "e2e 1" };
	const asks = [{ machine: "desk", owner: "alice" }];
	assert.deepEqual(await takeLease(c, ask(1, { machine: "desk" }), d), { ...request, asks });
	assert.deepEqual(await takeLease(c, ask(1, { caps: ["webcam"] }), d), { ...request, asks });
	assert.deepEqual(f.sent, [], "nothing reaches her desktop before her yes");
	assert.deepEqual(read("leases/queue.json", {}), {});
	// Asked for any Mac, a run gets the lab's, and alice is not asked.
	assert.equal((await takeLease(c, ask(2, { os: "macos" }), d)).machine, "lab");
	yes.add("desk worker-1");
	assert.equal((await takeLease(c, ask(1, { machine: "desk" }), d)).machine, "desk");
	// Her yes was for that run only.
	assert.equal((await takeLease(c, ask(3, { machine: "desk" }), d)).state, "requested");
});

test("a run ends only its own lease, keeps what it asks for again, and gives all back at its end", async () => {
	const f = fleet("mac", "lin");
	const c = config(mac("mac"), { name: "lin", os: "linux", ssh: "lin" });
	const d = deps(f);
	await takeLease(c, ask(1, { machine: "mac" }), d);
	const lin = await takeLease(c, ask(1, { machine: "lin", slug: "o/site" }), d);
	assert.equal(lin.worktree, "/home/rusuban/rusuban/demo/worker-1");
	assert.deepEqual(
		f.sent.find((s) => s.op === "worktree"),
		{ machine: "lin", op: "worktree", project: "demo", slug: "o/site", run: "worker-1" },
	);
	// A `lease` command cut short and asked again: the run keeps its machine, renewed.
	clock.t = T0 + 2 * MIN;
	const again = await takeLease(c, ask(1, { machine: "mac" }), d);
	assert.equal(again.state, "held");
	assert.equal(f.lease("mac").expires, iso(T0 + 7 * MIN));
	assert.equal(texts().filter((t) => t === "Took mac: e2e 1").length, 1);
	assert.equal(await releaseLease(c, "mac", "worker-2", d), false);
	assert.equal(f.lease("mac").run, "worker-1");
	await assert.rejects(takeLease(c, ask(2, { machine: "mac", slug: "x/y" }), d), /not a repo/);
	assert.deepEqual(await releaseRun(c, "worker-1", d), ["mac", "lin"]);
	assert.equal(f.disks.mac.lease, undefined);
	assert.equal(f.disks.lin.lease, undefined);
	const mine = readJournal("demo").filter((e) => e.by === "agent:worker-1");
	assert.deepEqual(
		mine.map((e) => e.text),
		[
			"Took mac: e2e 1",
			"Took lin: e2e 1",
			"Released mac: the run ended",
			"Released lin: the run ended",
		],
	);
	// The owner frees any machine, a lease that cannot be read included; nothing held is no error.
	f.disks.mac.lease = "";
	assert.equal(await releaseLease(c, "mac", null, d), true);
	assert.deepEqual(f.sent.at(-1), { machine: "mac", op: "clear", run: null });
	assert.equal(await releaseLease(c, "mac", null, d), false);
	f.disks.lin.offline = true;
	await assert.rejects(
		releaseLease(c, "lin", null, d),
		/cannot read the lease of lin: ssh: connect/,
	);
});

test("the lease command waits its time, then leaves the queue; each new state is heard at once", async () => {
	const f = fleet("mac", "desk");
	const c = config(mac("mac"), mac("desk", { owner: "alice" }));
	const base = deps(f);
	await takeLease(c, ask(1, { machine: "mac" }), base);
	const states = [];
	let pauses = 0;
	const d = deps(f, {
		pollMs: 10_000,
		onState: (r) => states.push(r.state),
		pause: async (ms) => {
			clock.t += ms;
			pauses += 1;
			if (pauses === 3) await releaseLease(c, "mac", "worker-1", base);
		},
	});
	const got = await waitLease(c, ask(2, { machine: "mac", waitMs: 60_000 }), d);
	assert.equal(got.state, "held");
	assert.deepEqual(states, ["queued", "held"]);
	assert.equal(clock.t, T0 + 30_000);
	// Nobody frees it: after its wait the run gives up and leaves the queue.
	const pause = async (ms) => {
		clock.t += ms;
	};
	const gave = await waitLease(c, ask(3, { machine: "mac", waitMs: 25_000 }), deps(f, { pause }));
	assert.equal(gave.state, "queued");
	assert.equal(clock.t, T0 + 55_000);
	assert.deepEqual(read("leases/queue.json"), {});
	// A desktop: the request is heard on the first try, while the run waits for alice.
	states.length = 0;
	await waitLease(
		c,
		ask(4, { machine: "desk", waitMs: 20_000 }),
		deps(f, { pause, onState: (r) => states.push(r.state) }),
	);
	assert.deepEqual(states, ["requested"]);
});

test("the probe says online or offline, who holds each machine, and what Tailscale sees (T067)", async () => {
	const f = fleet("mac", "lin", "here");
	const c = config(
		mac("mac"),
		{ name: "lin", os: "linux", ssh: "lin" },
		{ name: "here", os: "linux", ssh: null },
	);
	await takeLease(c, ask(1, { machine: "mac" }), deps(f));
	f.disks.lin.offline = true;
	const status = {
		Self: { HostName: "host", DNSName: "host.tail1234.ts.net." },
		Peer: {
			a: { HostName: "Mac-Mini", DNSName: "mac.tail1234.ts.net.", Online: true },
			b: {
				HostName: "lin",
				DNSName: "lin.tail1234.ts.net.",
				Online: false,
				LastSeen: iso(T0 - MIN),
			},
		},
	};
	const probes = await probeMachines(c, { ...deps(f), tailscale: async () => status });
	assert.deepEqual(
		probes.map(({ name, state, checkedAt, tailnet }) => ({ name, state, checkedAt, tailnet })),
		[
			{
				name: "mac",
				state: "online",
				checkedAt: iso(T0),
				tailnet: { online: true, lastSeen: null },
			},
			{
				name: "lin",
				state: "offline",
				checkedAt: iso(T0),
				tailnet: { online: false, lastSeen: iso(T0 - MIN) },
			},
			{
				name: "here",
				state: "online",
				checkedAt: iso(T0),
				tailnet: { online: true, lastSeen: null },
			},
		],
	);
	assert.equal(probes[0].lease.run, "worker-1");
	assert.equal(probes[2].lease, null);
	assert.match(probes[1].said, /port 22: timed out/);
	// Without Tailscale, it says nothing.
	const bare = await probeMachines(c, { ...deps(f), tailscale: async () => null });
	assert.deepEqual(
		bare.map((p) => p.tailnet),
		[null, null, null],
	);
});

test("enrollment checks SSH, the agent account, git and the workspace, then makes the mirrors (T066)", async () => {
	const [m] = validateMachines([mac("mac")]);
	const c = config();
	const sent = [];
	const machine = (stdout, code = 0) => ({
		exec: async (_, cmd) => {
			sent.push(cmd);
			if (cmd.op !== "check") return { code: 0, stdout: "", stderr: "" };
			return { code, stdout, stderr: code ? "rusuban@mac: Permission denied (publickey)." : "" };
		},
	});
	const good = "user=rusuban\r\ngit=git version 2.47.0\r\nworkspace=yes\r\n";
	const report = await enrollMachine(m, c, machine(good));
	assert.equal(report.ok, true);
	assert.deepEqual(
		report.checks.map((x) => x.check),
		["ssh", "account", "git", "workspace", "mirror o/r", "mirror o/site"],
	);
	assert.deepEqual(sent.slice(1), [
		{ op: "mirror", project: "demo", slug: "o/r" },
		{ op: "mirror", project: "demo", slug: "o/site" },
	]);
	const failed = async (stdout, code) =>
		(await checkMachine(m, machine(stdout, code))).filter((x) => !x.ok).map((x) => x.check);
	assert.deepEqual(await failed(good.replace("rusuban", "etienne")), ["account"]);
	assert.deepEqual(await failed(good.replace("git version 2.47.0", "")), ["git"]);
	assert.deepEqual(await failed(good.replace("=yes", "=no")), ["workspace"]);
	assert.deepEqual(await checkMachine(m, machine("", 255)), [
		{ check: "ssh", ok: false, said: "rusuban@mac: Permission denied (publickey)." },
	]);
	sent.length = 0;
	assert.equal((await enrollMachine(m, c, machine(good.replace("=yes", "=no")))).ok, false);
	assert.deepEqual(sent, [{ op: "check" }], "no mirror before every check passed");
	// Without --os: sh answers on macOS and Linux, PowerShell on Windows.
	const answers = (posix, windows) => ({
		exec: async (x) =>
			x.os === "windows"
				? { code: 0, stdout: windows, stderr: "" }
				: { code: 127, stdout: posix, stderr: "" },
	});
	assert.equal(
		await detectOs({ ssh: "mac" }, { exec: async () => ({ code: 0, stdout: "Darwin\n" }) }),
		"macos",
	);
	assert.equal(await detectOs({ ssh: "win" }, answers("", "Windows\r\n")), "windows");
	await assert.rejects(detectOs({ ssh: "box" }, answers("", "")), /give it with --os/);
});

test("over SSH: batch mode, 5 s to connect, the agent account, an alias never read as an option", () => {
	const [m, win, here] = validateMachines([
		mac("mac"),
		{ name: "win", os: "windows", ssh: "win", agentUser: "ci" },
		{ name: "here", os: "linux", ssh: null },
	]);
	const options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"];
	assert.deepEqual(sshArgs(m, "uname -s"), {
		cmd: "ssh",
		args: [...options, "-l", "rusuban", "--", "mac", "sh -s"],
		input: "uname -s",
	});
	const w = sshArgs(win, "'Windows'");
	assert.deepEqual(w.args.slice(0, 8), [...options, "-l", "ci", "--", "win"]);
	const [shell, ...flags] = w.args[8].split(" ");
	assert.equal(shell, "powershell");
	assert.deepEqual(flags.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
	assert.equal(Buffer.from(flags[3], "base64").toString("utf16le"), "'Windows'");
	assert.equal(w.input, "");
	assert.deepEqual(sshArgs(here, "x"), { cmd: "sh", args: ["-s"], input: "x" });
});

// The real scripts, on this host (`ssh: null`) and a folder standing in for a machine: no SSH.
const git = (args, cwd) =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
async function holdInFolder(osName) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-machine-"));
	const ws = path.join(tmp, "ws").replaceAll("\\", "/");
	const src = path.join(tmp, "src");
	fs.mkdirSync(src);
	git(["init", "-q", "-b", "main"], src);
	fs.writeFileSync(path.join(src, "README.md"), "hello\n");
	git(["add", "."], src);
	git(["commit", "-q", "-m", "first"], src);
	git(["clone", "-q", "--mirror", src, `${ws}/demo/r.git`], tmp); // its origin is local
	const [m] = validateMachines([{ name: "here", os: osName, ssh: null, workspace: ws }]);
	const run = (c) => sshExec(m, c);
	const checked = await run({ op: "check" });
	assert.match(checked.stdout, /git=git version/);
	assert.match(checked.stdout, /workspace=yes/);
	assert.deepEqual(await run({ op: "read" }), { code: 0, stdout: "", stderr: "" });
	// Quotes, a dollar, a backtick, cmd's metacharacters and non-ASCII: the same text comes back.
	const lease = {
		machine: "here",
		run: "worker-1",
		reason: `e2e d'été "q" $HOME \`x\` %PATH% & | ;`,
	};
	assert.equal((await run({ op: "take", lease })).code, 0);
	assert.deepEqual(JSON.parse((await run({ op: "read" })).stdout), lease);
	assert.equal((await run({ op: "take", lease })).code, 3);
	assert.equal((await run({ op: "renew", run: "worker-2", lease })).code, 3);
	assert.equal(
		(await run({ op: "renew", run: "worker-1", lease: { ...lease, expires: "x" } })).code,
		0,
	);
	assert.equal(JSON.parse((await run({ op: "read" })).stdout).expires, "x");
	const worktree = { op: "worktree", project: "demo", slug: "o/r", run: "worker-1" };
	const made = (await run(worktree)).stdout.trim();
	assert.ok(fs.existsSync(path.join(made, "README.md")), made);
	assert.equal((await run(worktree)).stdout.trim(), made, "a second ask keeps the worktree");
	assert.equal((await run({ op: "clear", run: "worker-2", project: "demo" })).code, 3);
	assert.equal((await run({ op: "clear", run: "worker-1", project: "demo" })).code, 0);
	assert.equal(fs.existsSync(made), false);
	assert.equal(fs.existsSync(`${ws}/.lease`), false);
	fs.mkdirSync(`${ws}/.lease`); // a take cut short
	assert.equal((await run({ op: "read" })).stdout.trim(), "?");
	assert.equal((await run({ op: "clear", run: null })).code, 0);
	assert.equal(fs.existsSync(`${ws}/.lease`), false);
}

const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
test("the sh scripts hold a lease in a real folder", { skip: !hasSh && "no sh here" }, () =>
	holdInFolder("linux"),
);
test(
	"the PowerShell scripts hold a lease in a real folder",
	{ skip: process.platform !== "win32" && "Windows PowerShell is on Windows only" },
	() => holdInFolder("windows"),
);
