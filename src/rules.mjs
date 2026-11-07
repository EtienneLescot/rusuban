// A repo's rules, read from its default branch through the contents API, never from a PR head or a
// local checkout (research R4): `.rusuban/rules/*.md` in file-name order, and the optional
// `.rusuban/locks.json`. Cached by the tree sha of `.rusuban/`. No rules: the repo is only observed.
import { gh } from "./github.mjs";

const getJson = async (endpoint) => JSON.parse(await gh(["api", endpoint]));
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const decode = (file) => Buffer.from(file.content ?? "", "base64").toString("utf8");
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

const isStrings = (v) =>
	Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
const strings = (v) => isStrings(v) || "must be a list of non-empty strings";
const count = (v) => (Number.isInteger(v) && v > 0) || "must be a positive integer";
const FIELDS = {
	mergeMethod: (v) =>
		["merge", "squash", "rebase"].includes(v) || 'must be "merge", "squash" or "rebase"',
	lockedPaths: strings,
	sizeExempt: strings,
	requiredChecks: strings,
	requiredReviewers: strings,
	maxLines: count,
	maxFiles: count,
	evidence: (v) =>
		(Array.isArray(v) &&
			v.every(
				(e) => isStrings(e?.paths) && e.paths.length && typeof e.what === "string" && e.what.trim(),
			)) ||
		"must be a list of { paths: [globs], what: text }",
};

// A locks file with any mistake yields no locks at all, only errors: the model then refuses every
// merge of that repo rather than run with a lock silently missing (a typo in a field name, say).
export function validateLocks(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { locks: null, errors: [`locks.json is not valid JSON: ${e.message}`] };
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		return { locks: null, errors: ["locks.json must be an object"] };
	const errors = [];
	for (const [k, v] of Object.entries(raw)) {
		const check = FIELDS[k];
		const verdict = check ? check(v) : `is not a known field (${Object.keys(FIELDS).join(", ")})`;
		if (verdict !== true) errors.push(`locks.json: ${k} ${verdict}`);
	}
	return errors.length ? { locks: null, errors } : { locks: raw, errors: [] };
}

export async function loadRules(slug, ref, cached = null, get = getJson) {
	const at = (p) =>
		`repos/${slug}/contents${p ? `/${encodePath(p)}` : ""}?ref=${encodeURIComponent(ref)}`;
	const checkedAt = new Date().toISOString();
	const root = await get(at(""));
	const dir = root.find((e) => e.name === ".rusuban" && e.type === "dir");
	if (!dir)
		return {
			ref,
			treeSha: null,
			observeOnly: true,
			files: [],
			locks: null,
			errors: [],
			loadedAt: checkedAt,
			checkedAt,
		};
	if (cached?.treeSha === dir.sha && cached.ref === ref) return { ...cached, checkedAt };
	const entries = await get(at(".rusuban"));
	const rulesDir = entries.find((e) => e.name === "rules" && e.type === "dir");
	const listed = rulesDir ? await get(at(".rusuban/rules")) : [];
	const md = listed.filter((e) => e.type === "file" && e.name.endsWith(".md")).sort(byName);
	const files = await Promise.all(
		md.map(async (f) => ({ name: f.name, text: decode(await get(at(f.path))) })),
	);
	const lockFile = entries.find((e) => e.name === "locks.json" && e.type === "file");
	const { locks, errors } = lockFile
		? validateLocks(decode(await get(at(lockFile.path))))
		: { locks: null, errors: [] };
	return {
		ref,
		treeSha: dir.sha,
		observeOnly: files.length === 0,
		files,
		locks,
		errors,
		loadedAt: checkedAt,
		checkedAt,
	};
}
