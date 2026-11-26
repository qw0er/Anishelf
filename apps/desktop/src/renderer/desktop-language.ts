import type { DesktopBridge } from "../ipc/desktop.js";

/** Sync the document language attribute to the Electron main process menus. */
export function syncDesktopLanguage(
	desktop: Pick<DesktopBridge, "setLanguage">,
): () => void {
	const root = document.documentElement;
	let lastLanguage = "";

	function applyLanguage() {
		const language = root.lang.trim();
		if (!language || language === lastLanguage) return;
		lastLanguage = language;
		void desktop.setLanguage(language).catch((error: unknown) => {
			console.warn("desktop.language_sync_failed", { error });
		});
	}

	// Shared language initialization and toggles update <html lang>.
	const observer = new MutationObserver(applyLanguage);
	observer.observe(root, { attributes: true, attributeFilter: ["lang"] });
	applyLanguage();
	return () => observer.disconnect();
}
