import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	appleScript,
	dashboardUrl,
	desktopEntry,
	installService,
	launchdPlist,
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
