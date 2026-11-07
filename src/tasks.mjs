// Recurring tasks (FR-070): one text file per task in the instance home, `tasks/<id>.md`, its front
// matter then its prompt. The daemon starts each at its times, once for slots it missed while it was
// down, and tasks of one lock group run one after the other (src/agents.mjs).
//
//   ---
//   title: Weekly digest
//   project: sandbox
//   schedule: daily 09:00,17:30      (optional: without it, the task runs on a click)
//   lock: sandbox.coordinator         (optional: tasks or runs sharing it go one at a time)
//   cwd: /path/to/folder              (optional: the project's scratch folder)
//   ---
//   <the prompt>
import fs from "node:fs";
import path from "node:path";
import { listRuns, requestRun, scratchOf } from "./agents.mjs";
import { homePath } from "./home.mjs";

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SAFE = /^[\w.-]+$/;
const KEYS = ["title", "project", "schedule", "lock", "cwd"];
// A run waits, works, or will be asked again (kickQueues in src/agents.mjs): no second one is asked
// for. A run that was asked again has handed its turn to the next.
export const waiting = (r) =>
	["queued", "running"].includes(r.state) ||
	(!r.retriedBy && (r.state === "limited" || (r.state === "interrupted" && (r.attempt ?? 1) < 3)));

// `daily 09:00,17:30` → [[9, 0], [17, 30]], or an error.
export function parseSchedule(schedule) {
	const m = /^daily\s+(.+)$/.exec(schedule.trim());
	if (!m) return { error: 'schedule is "daily HH:MM" or "daily HH:MM,HH:MM"' };
	const times = m[1].split(",").map((t) => /^(\d{1,2}):(\d{2})$/.exec(t.trim()));
	if (times.some((t) => !t || Number(t[1]) > 23 || Number(t[2]) > 59))
		return { error: `schedule "${schedule}": each time is HH:MM, from 00:00 to 23:59` };
	return { slots: times.map((t) => [Number(t[1]), Number(t[2])]) };
}

// A task file, checked against the instance's config. A task with a mistake is listed with its
// error and never started.
export function parseTask(id, text, config, since = 0) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	const errors = [];
	if (!ID.test(id)) errors.push("a task's file name is lowercase letters, digits and dashes");
	if (!m) errors.push("the file starts with a --- front matter ---");
	// Every line counts: one the parser skipped would drop a schedule without a word.
	const meta = {};
	for (const line of (m?.[1] ?? "").split(/\r?\n/)) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const kv = /^\s*(\w+)\s*:\s*(.*?)\s*$/.exec(line);
		if (!kv) errors.push(`"${line.trim()}" is not "field: value"`);
		else if (!KEYS.includes(kv[1])) errors.push(`unknown field "${kv[1]}"`);
		else meta[kv[1]] = kv[2];
	}
	const project = config.projects.find((p) => p.id === meta.project);
	if (!project)
		errors.push(
			`project must be one of this instance's: ${config.projects.map((p) => p.id).join(", ")}`,
		);
	const schedule = meta.schedule ? parseSchedule(meta.schedule) : { slots: [] };
	if (schedule.error) errors.push(schedule.error);
	const lock = meta.lock || `${meta.project}.task.${id}`;
	if (!SAFE.test(lock)) errors.push("lock is letters, digits, dots, dashes");
	// Without a folder of its own, a task works in its project's scratch folder, made when it runs.
	const cwd = meta.cwd || null;
	if (cwd && !(path.isAbsolute(cwd) && fs.existsSync(cwd)))
		errors.push(`cwd ${cwd} is not an existing absolute folder`);
	const prompt = text.slice(m?.[0].length ?? 0).trim();
	if (!prompt) errors.push("the prompt after the front matter is empty");
	return {
		id,
		title: meta.title || id,
		project: meta.project ?? null,
		schedule: meta.schedule ?? null,
		slots: schedule.slots ?? [],
		lock,
		cwd,
		prompt,
		since,
		error: errors.length ? errors.join("; ") : null,
	};
}

function load(id, config) {
	const file = homePath(`tasks/${id}.md`);
	try {
		return parseTask(id, fs.readFileSync(file, "utf8"), config, fs.statSync(file).mtimeMs);
	} catch {
		return null;
	}
}

// An id from the page or the command line names a file only when it is a task's name.
export const readTask = (id, config) => (ID.test(id ?? "") ? load(id, config) : null);

// Every file of the folder, a badly named one with its error.
export function listTasks(config) {
	let files = [];
	try {
		files = fs.readdirSync(homePath("tasks")).filter((f) => f.endsWith(".md"));
	} catch {}
	return files
		.map((f) => load(f.slice(0, -3), config))
		.filter(Boolean)
		.sort((a, b) => a.id.localeCompare(b.id));
}

// The slots of the day before `now`'s, of its day and of the next, as times; local hours, as
// written.
const slotTimes = (slots, now) =>
	[-1, 0, 1].flatMap((day) =>
		slots.map(([h, m]) => {
			const d = new Date(now);
			d.setDate(d.getDate() + day);
			d.setHours(h, m, 0, 0);
			return d.getTime();
		}),
	);
// The latest slot passed in the last 24 h, so one missed overnight still counts; or null.
export function lastSlot(slots, now = Date.now()) {
	const past = slotTimes(slots, now).filter((t) => t <= now && t > now - 86400e3);
	return past.length ? Math.max(...past) : null;
}
export function nextSlot(slots, now = Date.now()) {
	const next = slotTimes(slots, now).filter((t) => t > now);
	return next.length ? Math.min(...next) : null;
}
const iso = (t) => (t == null ? null : new Date(t).toISOString());

// The tasks to start now (T041): a slot passed since the task last started, and no run of it waits
// or works. Slots missed while the daemon was down start it once. A task never started counts
// only the slots after its file was written: adding a task does not fire it at once.
export function dueTasks({ tasks, runs, now = Date.now() }) {
	const out = [];
	for (const t of tasks) {
		if (t.error || !t.slots.length) continue;
		const slot = lastSlot(t.slots, now);
		if (slot == null) continue;
		const mine = runs.filter((r) => r.task === t.id);
		if (mine.some(waiting)) continue;
		const starts = mine.map((r) => Date.parse(r.createdAt)).filter(Number.isFinite);
		const last = starts.length ? Math.max(...starts) : null;
		if (last != null ? last >= slot : t.since > slot) continue;
		out.push({ task: t, slot });
	}
	return out;
}

export const busyRun = (id, runs = listRuns()) =>
	runs.find((r) => r.task === id && waiting(r)) ?? null;

export const startTask = (t, trigger, request = requestRun) => ({
	...request({
		kind: "task",
		project: t.project,
		mission: t.prompt,
		lock: t.lock,
		title: t.title,
		cwd: t.cwd,
		trigger,
		task: t.id,
	}),
	task: t.id,
});

// The catalog as the page and `task list` show it: each task with its slots, its state and its
// last runs, the conversation of each.
export function tasksState(config, now = Date.now()) {
	const runs = listRuns();
	return listTasks(config).map((t) => {
		const mine = runs.filter((r) => r.task === t.id);
		return {
			id: t.id,
			title: t.title,
			project: t.project,
			schedule: t.schedule,
			lock: t.lock,
			cwd: t.cwd ?? (t.project ? scratchOf(t.project) : null),
			error: t.error,
			lastSlot: iso(lastSlot(t.slots, now)),
			nextSlot: iso(nextSlot(t.slots, now)),
			state: busyRun(t.id, mine)?.state ?? "idle",
			runs: mine.slice(0, 5).map((r) => ({
				id: r.id,
				state: r.state,
				trigger: r.trigger,
				createdAt: r.createdAt,
				startedAt: r.startedAt,
				endedAt: r.endedAt,
				retryAt: r.retryAt ?? null,
				summary: r.summary,
				conversation: r.session ?? null,
			})),
		};
	});
}
