import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";
import { afterEach, expect, vi } from "vitest";
import changelog from "../../../CHANGELOG.md?raw";
import { configureClientRuntime } from "../src/shared/api/connection.js";
import { initializeLanguage } from "../src/shared/i18n.js";
import type { ClientPlatform } from "../src/shared/platform.js";

// Happy DOM does not implement the font readiness promise used by navigation measurements.
if (typeof document !== "undefined" && !document.fonts) {
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: { ready: Promise.resolve() },
	});
}

function onAuthRequired() {
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event("anishelf:auth-required"));
}

function downloadFile(url: string, filename: string) {
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
}

export const testPlatform: ClientPlatform = {
	preferences: {
		getItem: (key) =>
			typeof window === "undefined" ? null : window.localStorage.getItem(key),
		setItem(key, value) {
			window.localStorage.setItem(key, value);
			window.dispatchEvent(new StorageEvent("storage", { key }));
		},
		removeItem: (key) => window.localStorage.removeItem(key),
	},
	sessionStorage: {
		getItem: (key) => window.sessionStorage.getItem(key),
		setItem: (key, value) => window.sessionStorage.setItem(key, value),
		removeItem: (key) => window.sessionStorage.removeItem(key),
	},
	preferredLanguages: () =>
		typeof navigator === "undefined" ? [] : navigator.languages,
	get device() {
		return navigator;
	},
	onPreferenceChange(key, callback) {
		const onStorage = (event: StorageEvent) => {
			if (event.key === key || event.key === null) callback();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	},
	openExternal: vi.fn(),
	openPlayer: vi.fn(),
	copyText: (text) => navigator.clipboard.writeText(text),
	downloadFile,
	downloadText: (content, filename, mediaType) =>
		downloadFile(
			URL.createObjectURL(new Blob([content], { type: mediaType })),
			filename,
		),
	isVisible: () => document.visibilityState !== "hidden",
	isOnline: () => typeof navigator === "undefined" || navigator.onLine,
	onForegroundChange(callback) {
		window.addEventListener("focus", callback);
		document.addEventListener("visibilitychange", callback);
		return () => {
			window.removeEventListener("focus", callback);
			document.removeEventListener("visibilitychange", callback);
		};
	},
	onPlaybackLifecycle({ onBackground, onOnline }) {
		const visibility = () => {
			if (document.visibilityState === "hidden") onBackground();
		};
		window.addEventListener("pagehide", onBackground);
		window.addEventListener("online", onOnline);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			window.removeEventListener("pagehide", onBackground);
			window.removeEventListener("online", onOnline);
			document.removeEventListener("visibilitychange", visibility);
		};
	},
};

const cookieSession = createCookieConnection({
	origin:
		typeof window === "undefined" ? "http://localhost" : window.location.origin,
	fetch: (path, init) => fetch(path, init),
	onAuthRequired,
});
export const { clearCsrfToken } = cookieSession;

export const testRuntime = configureClientRuntime({
	...cookieSession,
	buildInfo: {
		version: "1.0.2",
		commit: "test",
		channel: "development",
		builtAt: null,
	},
	changelog,
	onAuthRequired,
	platform: testPlatform,
	navigate: vi.fn(),
	restartSession: vi.fn(),
});
await initializeLanguage(testPlatform);
export const { queryClient } = testRuntime;

const unexpectedRequests: string[] = [];

// Per-test fetch stubs restore this offline baseline, never native fetch.
// Keep a separate ledger because callers may catch the rejected promise.
globalThis.fetch = vi.fn<typeof fetch>(async (input) => {
	const url =
		typeof input === "string" || input instanceof URL
			? String(input)
			: input.url;
	const path = new URL(url, "http://test.invalid").pathname;
	unexpectedRequests.push(path);
	throw new Error(`Unexpected fetch in a web test: ${path}`);
});

afterEach(() => {
	const requests = unexpectedRequests.splice(0);
	expect(
		requests,
		"Mock each API request explicitly, including background queries.",
	).toEqual([]);
});
