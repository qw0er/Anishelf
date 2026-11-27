import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

type ThemeChangeSource = "init" | "system" | "user";

const darkMediaQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function syncBrowserThemeColor(): void {
	const background = getComputedStyle(document.documentElement)
		.getPropertyValue("--background")
		.trim();
	if (!background) return;
	const meta = document.querySelector<HTMLMetaElement>(
		'meta[name="theme-color"]',
	);
	if (meta) meta.content = background;
}

function getTheme(): Theme {
	if (typeof document === "undefined") return "light";
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(next: Theme, source: ThemeChangeSource): void {
	if (typeof document === "undefined") return;
	const previous = getTheme();
	document.documentElement.classList.toggle("dark", next === "dark");
	document.documentElement.style.colorScheme = next;
	syncBrowserThemeColor();
	if (previous !== next) {
		console.debug("theme.changed", { theme: next, source });
	}
	for (const listener of listeners) listener();
}

export function setTheme(next: Theme): void {
	applyTheme(next, "user");
}

function subscribeTheme(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useTheme(): Theme {
	return useSyncExternalStore(subscribeTheme, getTheme, () => "light");
}

export function watchSystemTheme(signal?: AbortSignal): () => void {
	if (
		signal?.aborted ||
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return () => {};
	}
	const media = window.matchMedia(darkMediaQuery);
	applyTheme(media.matches ? "dark" : "light", "init");

	const onSystemThemeChange = (event: MediaQueryListEvent) => {
		applyTheme(event.matches ? "dark" : "light", "system");
	};
	media.addEventListener("change", onSystemThemeChange);

	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		media.removeEventListener("change", onSystemThemeChange);
		signal?.removeEventListener("abort", stop);
	};
	signal?.addEventListener("abort", stop, { once: true });
	return stop;
}
