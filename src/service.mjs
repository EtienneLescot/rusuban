// The service: the OS starts the daemon at logon and again when it stops (FR-002, research R10), and
// a menu shortcut opens the dashboard, so its URL is never lost. Windows: a Task Scheduler task and a
// Start menu shortcut. macOS: a launchd agent and an app in ~/Applications. Linux: a systemd user unit
// and a .desktop entry. File contents are pure functions and commands go through `exec`, so every OS
// is tested on every OS.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "rusuban"; // the task, the launchd label and the systemd unit
const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));

export const dashboardUrl = (port) => `http://127.0.0.1:${port}/`;

// ── File contents ─────────────────────────────────────────────────────────────────────────────
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const xml = (s) => s.replace(/[&<>"]/g, (c) => ENTITIES[c]);

// Task Scheduler restarts a task that fails to start, not a program that exits: the trigger every
// minute starts the daemon again once it has stopped, and is ignored while it runs (IgnoreNew).
// conhost --headless gives node a console without a window, Windows Terminal's included; it also
// hides node's exit code, so the task always ends with 0.
export const taskXml = ({ user, command }) => `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
	<RegistrationInfo>
		<Description>Starts rusuban at logon and keeps it running.</Description>
	</RegistrationInfo>
	<Triggers>
		<LogonTrigger>
			<UserId>${xml(user)}</UserId>
		</LogonTrigger>
		<TimeTrigger>
			<StartBoundary>2026-01-01T00:00:00</StartBoundary>
			<Repetition>
				<Interval>PT1M</Interval>
			</Repetition>
		</TimeTrigger>
	</Triggers>
	<Principals>
		<Principal id="Author">
			<UserId>${xml(user)}</UserId>
			<LogonType>InteractiveToken</LogonType>
		</Principal>
	</Principals>
	<Settings>
		<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
		<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
		<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
		<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
		<RestartOnFailure>
			<Interval>PT1M</Interval>
			<Count>3</Count>
		</RestartOnFailure>
	</Settings>
	<Actions Context="Author">
		<Exec>
			<Command>conhost.exe</Command>
			<Arguments>${xml(["--headless", ...command.map((a) => `"${a}"`)].join(" "))}</Arguments>
		</Exec>
	</Actions>
</Task>
`;

export const launchdPlist = ({ command, env }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${NAME}</string>
	<key>ProgramArguments</key>
	<array>
${command.map((a) => `\t\t<string>${xml(a)}</string>`).join("\n")}
	</array>
	<key>EnvironmentVariables</key>
	<dict>
${Object.entries(env)
	.map(([k, v]) => `\t\t<key>${xml(k)}</key>\n\t\t<string>${xml(v)}</string>`)
	.join("\n")}
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
</dict>
</plist>
`;

// systemd reads C escapes and expands %specifiers everywhere, $VAR in ExecStart only.
const quote = (s) => JSON.stringify(s).replaceAll("%", "%%");
// RestartSec: systemd gives up on a unit that fails 5 times in 10 s. KillMode=process: a run's
// runner outlives the daemon (src/agents.mjs), so a restart stops the daemon alone.
export const systemdUnit = ({ command, env }) => `[Unit]
Description=rusuban

[Service]
ExecStart=${command.map((a) => quote(a).replaceAll("$", () => "$$")).join(" ")}
${Object.entries(env)
	.map(([k, v]) => `Environment=${quote(`${k}=${v}`)}`)
	.join("\n")}
Restart=on-failure
RestartSec=10
KillMode=process

[Install]
WantedBy=default.target
`;

export const urlShortcut = (url) => `[InternetShortcut]\r\nURL=${url}\r\n`;

export const desktopEntry = (url) => `[Desktop Entry]
Type=Application
Name=Rusuban
Comment=The Rusuban dashboard
Exec=xdg-open ${url}
Icon=web-browser
Categories=Development;
`;

export const appleScript = (url) => `open location "${url}"`;

// ── Install ───────────────────────────────────────────────────────────────────────────────────
const run = (cmd, args) =>
	execFileSync(cmd, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
const tried = (fn) => {
	try {
		fn();
		return true;
	} catch {
		return false;
	}
};
const save = (file, text) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
};

// Where each OS keeps the service and the shortcut; on Linux, in the XDG base directories.
function places(platform, home, env) {
	if (platform === "win32") {
		const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
		return {
			service: `Task Scheduler task ${NAME}`,
			shortcut: path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Rusuban.url"),
		};
	}
	if (platform === "darwin")
		return {
			service: path.join(home, "Library", "LaunchAgents", `${NAME}.plist`),
			shortcut: path.join(home, "Applications", "Rusuban.app"),
		};
	if (platform === "linux")
		return {
			service: path.join(
				env.XDG_CONFIG_HOME || path.join(home, ".config"),
				"systemd",
				"user",
				`${NAME}.service`,
			),
			shortcut: path.join(
				env.XDG_DATA_HOME || path.join(home, ".local", "share"),
				"applications",
				`${NAME}.desktop`,
			),
		};
	throw new Error(`no service for ${platform}: rusuban installs on Windows, macOS and Linux`);
}

// Tests replace the platform, the commands and the folders.
const setup = ({
	platform = process.platform,
	exec = run,
	home = os.homedir(),
	env = process.env,
	uid = process.getuid?.(),
} = {}) => ({ platform, exec, env, uid, ...places(platform, home, env) });

// Installs the service and the shortcut, or replaces an earlier install, and starts the daemon.
export function installService({ port, command = [process.execPath, BIN, "start"], ...options }) {
	if (!Number.isInteger(port) || port < 1)
		throw new Error("the shortcut needs the dashboard on a fixed port: set port in config.json");
	const { platform, exec, env, uid, service, shortcut } = setup(options);
	const url = dashboardUrl(port);
	// launchd and systemd start the daemon with a short PATH of their own: it gets this one, to find
	// gh, claude and git, and the instance home it was installed for.
	const vars = Object.fromEntries(
		["PATH", "RUSUBAN_HOME"].filter((k) => env[k]).map((k) => [k, env[k]]),
	);
	if (platform === "win32") {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-"));
		try {
			const file = path.join(dir, "task.xml");
			const user = `${env.USERDOMAIN}\\${env.USERNAME}`;
			// UTF-16 with a byte order mark, as Task Scheduler writes its own.
			fs.writeFileSync(file, `\ufeff${taskXml({ user, command })}`, "utf16le");
			exec("schtasks", ["/Create", "/TN", NAME, "/XML", file, "/F"]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		tried(() => exec("schtasks", ["/End", "/TN", NAME])); // the daemon of an earlier install
		exec("schtasks", ["/Run", "/TN", NAME]);
		save(shortcut, urlShortcut(url));
	} else if (platform === "darwin") {
		save(service, launchdPlist({ command, env: vars }));
		tried(() => exec("launchctl", ["bootout", `gui/${uid}/${NAME}`])); // an earlier install
		// bootout returns before the old agent is gone, and bootstrap fails until it is.
		for (let attempt = 1; ; attempt++)
			try {
				exec("launchctl", ["bootstrap", `gui/${uid}`, service]);
				break;
			} catch (e) {
				if (attempt === 10) throw e;
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
			}
		fs.rmSync(shortcut, { recursive: true, force: true });
		fs.mkdirSync(path.dirname(shortcut), { recursive: true });
		exec("osacompile", ["-o", shortcut, "-e", appleScript(url)]);
	} else {
		save(service, systemdUnit({ command, env: vars }));
		exec("systemctl", ["--user", "daemon-reload"]);
		exec("systemctl", ["--user", "enable", `${NAME}.service`]);
		exec("systemctl", ["--user", "restart", `${NAME}.service`]); // an earlier install's daemon too
		save(shortcut, desktopEntry(url));
	}
	return { service, shortcut };
}

// Stops the daemon and removes the service and the shortcut. Nothing installed is not an error.
export function uninstallService(options) {
	const { platform, exec, uid, service, shortcut } = setup(options);
	if (platform === "win32") {
		if (tried(() => exec("schtasks", ["/Query", "/TN", NAME]))) {
			tried(() => exec("schtasks", ["/End", "/TN", NAME])); // fails when it does not run
			exec("schtasks", ["/Delete", "/TN", NAME, "/F"]);
		}
	} else if (platform === "darwin") {
		tried(() => exec("launchctl", ["bootout", `gui/${uid}/${NAME}`])); // fails when not loaded
		fs.rmSync(service, { force: true });
	} else if (fs.existsSync(service)) {
		exec("systemctl", ["--user", "disable", "--now", `${NAME}.service`]);
		fs.rmSync(service);
		exec("systemctl", ["--user", "daemon-reload"]);
	}
	fs.rmSync(shortcut, { recursive: true, force: true });
	return { service, shortcut };
}
