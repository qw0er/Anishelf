import { useSyncExternalStore } from "react";
import { getClientRuntime } from "./api/connection.js";
import type { ClientPlatform, ClientStorage } from "./platform.js";

export const themeStorageKey = "anishelf:theme";
export type ThemePreference = "system" | "light" | "dark";

type ResolvedTheme = "light" | "dark";
type ThemeChangeSource = "init" | "system" | "user" | "storage";

const darkMediaQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

let currentPreference: ThemePreference = "system";
let activePreferences: Pick<ClientStorage, "getItem" | "setItem"> | undefined;

function isThemePreference(
	value: string | null | undefined,
): value is ThemePreference {
	return value === "system" || value === "light" || value === "dark";
}

function getSystemTheme(): ResolvedTheme {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return "light";
	}
	return window.matchMedia(darkMediaQuery).matches ? "dark" : "light";
}

function getDocumentTheme(): ResolvedTheme {
	if (typeof document === "undefined") return "light";
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
	return preference === "system" ? getSystemTheme() : preference;
}

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

function readStoredThemePreference(
	storage: Pick<ClientStorage, "getItem">,
): ThemePreference {
	try {
		const value = storage.getItem(themeStorageKey);
		if (isThemePreference(value)) return value;
	} catch (error) {
		console.warn("theme.preference_read_failed", { error });
	}
	return "system";
}

function storeThemePreference(
	preference: ThemePreference,
	storage: Pick<ClientStorage, "setItem">,
): void {
	try {
		storage.setItem(themeStorageKey, preference);
	} catch (error) {
		console.warn("theme.preference_save_failed", { error });
	}
}

function applyThemePreference(
	preference: ThemePreference,
	source: ThemeChangeSource,
): void {
	const previousPreference = currentPreference;
	const previousResolved = getDocumentTheme();
	const resolved = resolveTheme(preference);
	currentPreference = preference;

	if (typeof document !== "undefined") {
		document.documentElement.classList.toggle("dark", resolved === "dark");
		document.documentElement.style.colorScheme = resolved;
		syncBrowserThemeColor();
	}

	if (previousPreference !== preference || previousResolved !== resolved) {
		console.debug("theme.changed", {
			preference,
			theme: resolved,
			source,
		});
	}

	if (previousPreference !== preference) {
		for (const listener of listeners) listener();
	}
}

export function setThemePreference(next: ThemePreference): void {
	const storage = activePreferences ?? getClientRuntime().platform.preferences;
	applyThemePreference(next, "user");
	storeThemePreference(next, storage);
}

function subscribeTheme(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getThemePreference(): ThemePreference {
	return currentPreference;
}

export function useThemePreference(): ThemePreference {
	return useSyncExternalStore(
		subscribeTheme,
		getThemePreference,
		() => "system",
	);
}

export function initializeTheme(
	platform: Pick<ClientPlatform, "preferences" | "onPreferenceChange">,
	signal?: AbortSignal,
): () => void {
	if (signal?.aborted) return () => {};

	const preferences = platform.preferences;
	activePreferences = preferences;
	applyThemePreference(readStoredThemePreference(preferences), "init");

	const media =
		typeof window !== "undefined" && typeof window.matchMedia === "function"
			? window.matchMedia(darkMediaQuery)
			: undefined;
	const onSystemThemeChange = () => {
		if (currentPreference !== "system") return;
		applyThemePreference("system", "system");
	};
	media?.addEventListener("change", onSystemThemeChange);

	const stopPreferenceWatch = platform.onPreferenceChange(
		themeStorageKey,
		() => {
			applyThemePreference(readStoredThemePreference(preferences), "storage");
		},
	);

	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		media?.removeEventListener("change", onSystemThemeChange);
		stopPreferenceWatch();
		signal?.removeEventListener("abort", stop);
		if (activePreferences === preferences) activePreferences = undefined;
	};
	signal?.addEventListener("abort", stop, { once: true });
	return stop;
}
