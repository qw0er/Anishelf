import type { DesktopBridge } from "../ipc/desktop.js";

export function syncWindowControlsTheme(
	desktop: Pick<DesktopBridge, "setWindowControlsColors">,
): void {
	const root = document.documentElement;

	function applyTheme() {
		const style = getComputedStyle(root);
		void desktop
			.setWindowControlsColors(
				style.getPropertyValue("--background").trim(),
				style.getPropertyValue("--foreground").trim(),
			)
			.catch((error: unknown) => {
				console.warn("desktop.window_controls_theme_failed", { error });
			});
	}

	// The shared theme toggle updates the root class.
	const observer = new MutationObserver(applyTheme);
	observer.observe(root, { attributes: true, attributeFilter: ["class"] });
	applyTheme();
}
