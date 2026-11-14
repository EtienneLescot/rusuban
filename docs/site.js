// The theme switch and the copy buttons, on every page of rusuban.dev.
const root = document.documentElement;
const themeBtn = document.getElementById("theme");
const isDark = () =>
	root.dataset.theme
		? root.dataset.theme === "dark"
		: matchMedia("(prefers-color-scheme: dark)").matches;
const label = () =>
	themeBtn.setAttribute(
		"aria-label",
		isDark() ? "Switch to the light theme" : "Switch to the dark theme",
	);
label();
themeBtn.onclick = () => {
	root.dataset.theme = isDark() ? "light" : "dark";
	try {
		localStorage.setItem("theme", root.dataset.theme);
	} catch {}
	label();
};

// A button with data-copy="<id>" copies that element's text.
for (const btn of document.querySelectorAll("[data-copy]")) {
	btn.onclick = async () => {
		const text = document.getElementById(btn.dataset.copy);
		try {
			await navigator.clipboard.writeText(text.textContent);
			btn.setAttribute("aria-label", "Copied");
		} catch {
			getSelection().selectAllChildren(text);
		}
	};
}
