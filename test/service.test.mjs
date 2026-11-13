import "./tmp-root.mjs";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	appleScript,
	dashboardUrl,
	desktopEntry,
	inNpxCache,
	installService,
	launchdPlist,
	openUrl,
	serviceConflict,
	systemdUnit,
	taskXml,
	uninstallService,
	urlShortcut,
} from "../src/service.mjs";

// Every install and uninstall below names its platform, folders and commands: nothing reaches this
// machine's Task Scheduler, launchd or systemd, and every OS's code path runs on every OS.
const DASHBOARD = "http://127.0.0.1:8788/";
const WIN_COMMAND = [
	String.raw`C:\Program Files\nodejs\node.exe`,
	String.raw`C:\R&D\rusuban\bin\rusuban.mjs`,
	"start",
];
const COMMAND = ["/opt/node 22/bin/node", "/home/a/50%$off/bin/rusuban.mjs", "start"];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-service-"));
const execFileP = promisify(execFile);

// Records each command, then lets `react` look at it: throwing is the command exiting non-zero.
function fake(react = () => {}) {
	const calls = [];
	return {
		calls,
		exec(cmd, args) {
			calls.push([cmd, ...args].join(" "));
			react(args);
			return "";
		},
	};
}

test("the dashboard's URL is fixed, and each shortcut opens it", () => {
	assert.equal(dashboardUrl(8788), DASHBOARD);
	assert.equal(urlShortcut(DASHBOARD), `[InternetShortcut]\r\nURL=${DASHBOARD}\r\n`);
	const entry = desktopEntry(DASHBOARD);
	assert.match(entry, /^\[Desktop Entry\]\nType=Application\nName=Rusuban\n/);
	assert.match(entry, /\nExec=xdg-open http:\/\/127\.0\.0\.1:8788\/\n/);
	assert.equal(appleScript(DASHBOARD), `open location "${DASHBOARD}"`);
});

test("the Windows task starts at logon, comes back within a minute, and opens no window", () => {
	const xml = taskXml({ user: String.raw`R&D\alice`, command: WIN_COMMAND });
	assert.match(xml, /<LogonTrigger>\s*<UserId>R&amp;D\\alice<\/UserId>/);
	assert.match(
		xml,
		/<TimeTrigger>\s*<StartBoundary>[^<]+<\/StartBoundary>\s*<Repetition>\s*<Interval>PT1M</,
	);
	assert.doesNotMatch(xml, /<Duration>/); // repeated for ever
	for (const setting of [
		"<LogonType>InteractiveToken</LogonType>",
		"<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
		"<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
		"<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
		"<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
		"<RestartOnFailure>",
		"<Command>conhost.exe</Command>",
		String.raw`<Arguments>--headless &quot;C:\Program Files\nodejs\node.exe&quot; &quot;C:\R&amp;D\rusuban\bin\rusuban.mjs&quot; &quot;start&quot;</Arguments>`,
	])
		assert.ok(xml.includes(setting), setting);
});

test("the launchd agent runs at load, is kept alive, and gets the PATH it was installed with", () => {
	const plist = launchdPlist({
		command: COMMAND,
		env: { PATH: "/opt/homebrew/bin:/usr/bin", RUSUBAN_HOME: "/Users/a/<R&D>" },
	});
	assert.match(plist, /<key>Label<\/key>\n\t<string>rusuban<\/string>/);
	assert.match(plist, /<key>RunAtLoad<\/key>\n\t<true\/>/);
	assert.match(plist, /<key>KeepAlive<\/key>\n\t<true\/>/);
	assert.ok(
		plist.includes(
			"<array>\n\t\t<string>/opt/node 22/bin/node</string>\n\t\t<string>/home/a/50%$off/bin/rusuban.mjs</string>\n\t\t<string>start</string>\n\t</array>",
		),
	);
	assert.ok(
		plist.includes(
			"<key>PATH</key>\n\t\t<string>/opt/homebrew/bin:/usr/bin</string>\n\t\t<key>RUSUBAN_HOME</key>\n\t\t<string>/Users/a/&lt;R&amp;D&gt;</string>",
		),
	);
});

test("the systemd unit restarts on failure, and a restart leaves the runs alone", () => {
	const unit = systemdUnit({
		command: COMMAND,
		env: { PATH: "/usr/bin:/odd$dir", RUSUBAN_HOME: '/home/a/"x" 100%' },
	});
	const lines = unit.split("\n");
	// Quoted for spaces; %% and $$ keep systemd from expanding a specifier or a variable.
	assert.ok(
		lines.includes('ExecStart="/opt/node 22/bin/node" "/home/a/50%%$$off/bin/rusuban.mjs" "start"'),
	);
	// Environment= expands specifiers but not variables.
	assert.ok(lines.includes('Environment="PATH=/usr/bin:/odd$dir"'));
	assert.ok(lines.includes(String.raw`Environment="RUSUBAN_HOME=/home/a/\"x\" 100%%"`));
	for (const line of [
		"Restart=on-failure",
		"RestartSec=10",
		"KillMode=process",
		"WantedBy=default.target",
	])
		assert.ok(lines.includes(line), line);
});

test("Windows: install creates the task, starts it and adds a Start menu shortcut; uninstall removes both", () => {
	const home = tmp();
	const env = { USERDOMAIN: "PC", USERNAME: "alice", APPDATA: path.join(home, "Roaming") };
	let xmlFile;
	let written;
	const { calls, exec } = fake((args) => {
		if (args[0] === "/Create") {
			xmlFile = args[args.indexOf("/XML") + 1];
			written = fs.readFileSync(xmlFile, "utf16le");
		}
		if (args[0] === "/End") throw new Error("not running");
	});
	const shortcut = path.join(
		env.APPDATA,
		"Microsoft",
		"Windows",
		"Start Menu",
		"Programs",
		"Rusuban.url",
	);
	assert.deepEqual(
		installService({ port: 8788, platform: "win32", exec, home, env, command: WIN_COMMAND }),
		{ service: "Task Scheduler task rusuban", shortcut },
	);
	assert.deepEqual(calls, [
		`schtasks /Create /TN rusuban /XML ${xmlFile} /F`,
		"schtasks /End /TN rusuban",
		"schtasks /Run /TN rusuban",
	]);
	assert.equal(written, `\ufeff${taskXml({ user: String.raw`PC\alice`, command: WIN_COMMAND })}`);
	assert.ok(!fs.existsSync(xmlFile), "the task file is removed once registered");
	assert.equal(fs.readFileSync(shortcut, "utf8"), urlShortcut(DASHBOARD));

	calls.length = 0;
	uninstallService({ platform: "win32", exec, home, env });
	assert.deepEqual(calls, [
		"schtasks /Query /TN rusuban",
		"schtasks /End /TN rusuban",
		"schtasks /Delete /TN rusuban /F",
	]);
	assert.ok(!fs.existsSync(shortcut));

	// Nothing installed: the query fails, nothing is deleted, and that is not an error.
	const none = fake((args) => {
		if (args[0] === "/Query") throw new Error("no such task");
	});
	uninstallService({ platform: "win32", exec: none.exec, home, env });
	assert.deepEqual(none.calls, ["schtasks /Query /TN rusuban"]);
});

test("macOS: install loads the agent, waits out a slow unload, and compiles the app; uninstall removes both", () => {
	const home = tmp();
	const env = {
		PATH: "/opt/homebrew/bin:/usr/bin",
		RUSUBAN_HOME: "/Users/a/.rusuban",
		SHELL: "/bin/zsh",
	};
	const plist = path.join(home, "Library", "LaunchAgents", "rusuban.plist");
	const app = path.join(home, "Applications", "Rusuban.app");
	fs.mkdirSync(path.join(app, "Contents"), { recursive: true }); // an earlier install's app
	let unloading = true;
	const { calls, exec } = fake((args) => {
		if (args[0] === "bootout") throw new Error("not loaded");
		// The first bootstrap comes while the old agent is still going away.
		if (args[0] === "bootstrap" && unloading) {
			unloading = false;
			throw new Error("Bootstrap failed: 5: Input/output error");
		}
	});
	assert.deepEqual(
		installService({ port: 8788, platform: "darwin", exec, home, env, uid: 501, command: COMMAND }),
		{ service: plist, shortcut: app },
	);
	assert.deepEqual(calls, [
		"launchctl bootout gui/501/rusuban",
		`launchctl bootstrap gui/501 ${plist}`,
		`launchctl bootstrap gui/501 ${plist}`,
		`osacompile -o ${app} -e open location "${DASHBOARD}"`,
	]);
	// Only what the daemon needs from the installing shell: its PATH and its instance home.
	assert.equal(
		fs.readFileSync(plist, "utf8"),
		launchdPlist({ command: COMMAND, env: { PATH: env.PATH, RUSUBAN_HOME: env.RUSUBAN_HOME } }),
	);
	assert.ok(!fs.existsSync(app), "the earlier app is removed before osacompile writes the new one");
	assert.ok(fs.existsSync(path.dirname(app)), "~/Applications is created for osacompile");

	calls.length = 0;
	fs.mkdirSync(path.join(app, "Contents"), { recursive: true }); // what osacompile made
	uninstallService({ platform: "darwin", exec, home, env, uid: 501 });
	assert.deepEqual(calls, ["launchctl bootout gui/501/rusuban"]);
	assert.ok(!fs.existsSync(plist) && !fs.existsSync(app));
});

test("Linux: install enables and starts the unit and adds a menu entry; uninstall removes both", () => {
	const home = tmp();
	const env = { PATH: "/home/a/.local/bin:/usr/bin", XDG_CONFIG_HOME: path.join(home, "config") };
	const unit = path.join(home, "config", "systemd", "user", "rusuban.service");
	const entry = path.join(home, ".local", "share", "applications", "rusuban.desktop");
	const { calls, exec } = fake();
	assert.deepEqual(
		installService({ port: 8788, platform: "linux", exec, home, env, command: COMMAND }),
		{
			service: unit,
			shortcut: entry,
		},
	);
	assert.deepEqual(calls, [
		"systemctl --user daemon-reload",
		"systemctl --user enable rusuban.service",
		"systemctl --user restart rusuban.service",
	]);
	assert.equal(
		fs.readFileSync(unit, "utf8"),
		systemdUnit({ command: COMMAND, env: { PATH: env.PATH } }),
	);
	assert.equal(fs.readFileSync(entry, "utf8"), desktopEntry(DASHBOARD));

	calls.length = 0;
	uninstallService({ platform: "linux", exec, home, env });
	assert.deepEqual(calls, [
		"systemctl --user disable --now rusuban.service",
		"systemctl --user daemon-reload",
	]);
	assert.ok(!fs.existsSync(unit) && !fs.existsSync(entry));

	calls.length = 0;
	uninstallService({ platform: "linux", exec, home, env }); // nothing installed any more
	assert.deepEqual(calls, []);
});

test("one service per machine: an instance never replaces nor removes another's (T078)", () => {
	const { calls, exec } = fake();
	// launchd and systemd carry the home they run: the instance that holds the service is known.
	for (const platform of ["linux", "darwin"]) {
		const home = tmp();
		const live = path.join(home, "R&D 50%", ".rusuban"); // escaped in the plist and the unit
		const other = path.join(home, "test");
		const o = (RUSUBAN_HOME) => ({
			platform,
			exec,
			home,
			uid: 501,
			command: COMMAND,
			env: { PATH: "/usr/bin", XDG_CONFIG_HOME: path.join(home, "config"), RUSUBAN_HOME },
		});
		const { service } = installService({ port: 8788, ...o(live) });
		const before = fs.readFileSync(service, "utf8");
		calls.length = 0;
		const message = `the service runs the instance in ${path.resolve(live)}: uninstall it from there, or start this one with rusuban start`;
		assert.equal(serviceConflict(o(other)), message, platform);
		assert.throws(() => installService({ port: 8789, ...o(other) }), { message });
		assert.throws(() => uninstallService(o(other)), { message });
		assert.throws(() => uninstallService(o(undefined)), { message }, "the default home is another");
		assert.deepEqual(calls, [], platform);
		assert.equal(fs.readFileSync(service, "utf8"), before);
		// Its own instance may, whatever the case of the path on macOS; and anyone once it is gone.
		assert.equal(serviceConflict(o(platform === "darwin" ? live.toUpperCase() : live)), null);
		uninstallService(o(live));
		assert.equal(serviceConflict(o(other)), null, platform);
	}
	// Windows' task carries no home: it runs the default one, the only one that may install it.
	calls.length = 0;
	const home = tmp();
	const o = (RUSUBAN_HOME) => ({
		platform: "win32",
		exec,
		home,
		command: WIN_COMMAND,
		env: { USERDOMAIN: "PC", USERNAME: "alice", APPDATA: path.join(home, "Roaming"), RUSUBAN_HOME },
	});
	const message = `on Windows the service runs ${path.resolve(home, ".rusuban")} only: start this instance with rusuban start`;
	assert.throws(() => installService({ port: 8788, ...o(path.join(home, "test")) }), { message });
	assert.throws(() => uninstallService(o(path.join(home, "test"))), { message });
	assert.deepEqual(calls, []);
	assert.equal(serviceConflict(o(undefined)), null);
	assert.equal(serviceConflict(o(path.join(home, ".rusuban").toUpperCase())), null);
});

test("install refuses a dashboard without a fixed port, and an OS it does not know", () => {
	const { calls, exec } = fake();
	const home = tmp();
	for (const port of [0, undefined, "8788"])
		assert.throws(
			() => installService({ port, platform: "linux", exec, home, env: {} }),
			/fixed port/,
		);
	assert.throws(
		() => installService({ port: 8788, platform: "freebsd", exec, home, env: {} }),
		/no service for freebsd/,
	);
	assert.throws(
		() => uninstallService({ platform: "aix", exec, home, env: {} }),
		/no service for aix/,
	);
	assert.deepEqual(calls, []);
	assert.deepEqual(fs.readdirSync(home), []);
});

test("install refuses npx's cache, and the daemon it installs writes its log", () => {
	const { calls, exec } = fake();
	const home = tmp();
	const npx = [
		"/usr/bin/node",
		"/home/a/.npm/_npx/1f2e/node_modules/rusuban/bin/rusuban.mjs",
		"start",
	];
	assert.throws(
		() => installService({ port: 8788, platform: "linux", exec, home, env: {}, command: npx }),
		/npx's cache, which npm empties: npm i -g rusuban/,
	);
	assert.deepEqual(calls, []);
	assert.ok(
		inNpxCache(String.raw`C:\Users\a\AppData\Local\npm-cache\_npx\1f2e\node_modules\rusuban`),
	);
	assert.ok(!inNpxCache(String.raw`C:\Users\a\AppData\Roaming\npm\node_modules\rusuban`));
	const { service } = installService({ port: 8788, platform: "linux", exec, home, env: {} });
	assert.match(fs.readFileSync(service, "utf8"), /rusuban\.mjs" "start" "--log"\n/);
});

test("a service's daemon writes what it says to daemon.log, and status reads it from the daemon", async () => {
	const home = tmp();
	const port = await new Promise((resolve) => {
		const s = net.createServer().listen(0, "127.0.0.1", () => {
			const free = s.address().port;
			s.close(() => resolve(free));
		});
	});
	fs.writeFileSync(
		path.join(home, "config.json"),
		JSON.stringify({
			version: 1,
			owner: { login: "alice" },
			port,
			permissions: { mode: "allowlist" },
			limits: { maxWorkers: 1, maxRunMinutes: 10 },
			model: "claude-test",
			projects: [{ id: "demo", repos: [{ slug: "o/r" }] }],
		}),
	);
	const env = {
		...process.env,
		RUSUBAN_HOME: home,
		RUSUBAN_DRY: "1",
		RUSUBAN_CLAUDE_PROJECTS: tmp(),
		RUSUBAN_REGISTRY: "http://127.0.0.1:9", // no registry: nothing to say about updates
	};
	const bin = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
	const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { env, encoding: "utf8" });
	const down = cli("status");
	assert.equal(down.status, 1);
	assert.equal(
		down.stdout,
		`rusuban is not running on http://127.0.0.1:${port}/: see ${path.join(home, "daemon.log")}\n`,
	);
	const daemon = spawn(process.execPath, [bin, "start", "--log"], { env, stdio: "ignore" });
	try {
		const log = path.join(home, "daemon.log");
		const banner = `on http://127.0.0.1:${port}/ (dry`;
		for (let i = 0; i < 150 && !fs.readFileSync(log, { flag: "a+" }).includes(banner); i++)
			await sleep(100);
		assert.ok(fs.readFileSync(log, "utf8").includes(banner), "the banner is in the log");
		const up = cli("status");
		assert.equal(up.status, 0, up.stderr);
		assert.match(
			up.stdout,
			/^rusuban \S+ \(dry\), up 0 min, on http:\/\/127\.0\.0\.1:\d+\/\nmerges paused; projects: demo\nmodel of the runs: claude-test\nagents at work: none\nlog: /,
		);
		// A newer release on npm is said; status never installs it.
		const registry = http.createServer((req, res) =>
			res.end(req.url === "/rusuban/latest" ? '{"version":"99.0.0"}' : "{}"),
		);
		await new Promise((r) => registry.listen(0, "127.0.0.1", r));
		try {
			const { stdout } = await execFileP(process.execPath, [bin, "status"], {
				env: { ...env, RUSUBAN_REGISTRY: `http://127.0.0.1:${registry.address().port}` },
			});
			assert.match(
				stdout,
				/\nrusuban 99\.0\.0 is out: npm i -g rusuban, then rusuban service install to restart\n/,
			);
		} finally {
			registry.close();
		}
	} finally {
		daemon.kill();
	}
});

test("status tells a slow daemon from a stopped one: it waits, and says how long it took", async () => {
	const home = tmp();
	// A daemon that answers its state after 3.5 s, as a busy one did.
	const slow = http.createServer(async (_req, res) => {
		await sleep(3500);
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({ version: "0.1.0", startedAt: new Date().toISOString(), armed: false }),
		);
	});
	await new Promise((r) => slow.listen(0, "127.0.0.1", r));
	fs.writeFileSync(
		path.join(home, "config.json"),
		JSON.stringify({
			version: 1,
			owner: { login: "alice" },
			port: slow.address().port,
			permissions: { mode: "allowlist" },
			limits: { maxWorkers: 1, maxRunMinutes: 10 },
			model: "claude-test",
			projects: [{ id: "demo", repos: [{ slug: "o/r" }] }],
		}),
	);
	const bin = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
	try {
		const { stdout } = await execFileP(process.execPath, [bin, "status"], {
			env: { ...process.env, RUSUBAN_HOME: home, RUSUBAN_REGISTRY: "http://127.0.0.1:9" },
		});
		assert.match(stdout, /^rusuban 0\.1\.0, up 0 min, on http:\/\/127\.0\.0\.1:\d+\/\n/);
		assert.match(stdout, /\nslow: it took 3\.\d s to answer; its log says why: .*daemon\.log\n/);
	} finally {
		slow.close();
	}
});

test("open: the default browser, never waited for", () => {
	const started = [];
	const start = (cmd, args, options) => {
		started.push([cmd, ...args].join(" "));
		assert.deepEqual([options.detached, options.stdio], [true, "ignore"]);
		return { on: () => ({ unref: () => {} }) };
	};
	for (const platform of ["win32", "darwin", "linux"]) openUrl(DASHBOARD, { platform, start });
	assert.deepEqual(started, [
		`cmd /c start  ${DASHBOARD}`,
		`open ${DASHBOARD}`,
		`xdg-open ${DASHBOARD}`,
	]);
});

// Task Scheduler's own parser, in memory: the definition is read back and never registered.
const READ_TASK = (file) => `
$s = New-Object -ComObject Schedule.Service; $s.Connect(); $t = $s.NewTask(0)
$t.XmlText = [IO.File]::ReadAllText('${file.replaceAll("'", "''")}')
[pscustomobject]@{
	triggers = @($t.Triggers | ForEach-Object { [pscustomobject]@{ type = $_.Type; user = $_.UserId; every = $_.Repetition.Interval } })
	logonType = $t.Principal.LogonType
	instances = $t.Settings.MultipleInstances
	limit = $t.Settings.ExecutionTimeLimit
	onBatteries = -not ($t.Settings.DisallowStartIfOnBatteries -or $t.Settings.StopIfGoingOnBatteries)
	command = $t.Actions.Item(1).Path
	arguments = $t.Actions.Item(1).Arguments
} | ConvertTo-Json -Depth 3`;

test("Task Scheduler reads the task file as install writes it", {
	skip: process.platform !== "win32" && "Task Scheduler is on Windows only",
}, () => {
	let task;
	const { exec } = fake((args) => {
		if (args[0] === "/Create")
			task = JSON.parse(
				execFileSync(
					"powershell",
					["-NoProfile", "-NonInteractive", "-Command", READ_TASK(args[args.indexOf("/XML") + 1])],
					{
						encoding: "utf8",
						windowsHide: true,
					},
				),
			);
	});
	const home = tmp();
	const env = { USERDOMAIN: "PC", USERNAME: "alice", APPDATA: home };
	installService({ port: 8788, platform: "win32", exec, home, env, command: WIN_COMMAND });
	assert.deepEqual(task, {
		triggers: [
			{ type: 9, user: String.raw`PC\alice`, every: null }, // at logon
			{ type: 1, user: null, every: "PT1M" }, // every minute, for ever
		],
		logonType: 3, // interactive: the user's own session, no stored password
		instances: 2, // a start while it runs is ignored
		limit: "PT0S",
		onBatteries: true,
		command: "conhost.exe",
		arguments: String.raw`--headless "C:\Program Files\nodejs\node.exe" "C:\R&D\rusuban\bin\rusuban.mjs" "start"`,
	});
});

test("launchd's plist parser accepts the agent", {
	skip: process.platform !== "darwin" && "plutil is on macOS only",
}, () => {
	const file = path.join(tmp(), "rusuban.plist");
	fs.writeFileSync(
		file,
		launchdPlist({ command: COMMAND, env: { PATH: "/usr/bin", RUSUBAN_HOME: "/a&b" } }),
	);
	execFileSync("plutil", ["-lint", file], { encoding: "utf8" });
});
