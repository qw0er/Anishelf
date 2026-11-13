import { resolveBrowserPlayerUrl } from "../features/settings/public.js";
import type { ClientPlatform } from "../shared/platform.js";

export type { ClientPlatform };
export { resolveBrowserPlayerUrl };

function downloadFile(url: string, filename: string) {
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.append(anchor);
	try {
		anchor.click();
		console.debug("platform.download_requested");
	} finally {
		anchor.remove();
	}
}

const preferencesChanged = "anishelf:preference-changed";

export const browserPlatform: ClientPlatform = {
	preferences: {
		getItem: (key) => window.localStorage.getItem(key),
		setItem(key, value) {
			window.localStorage.setItem(key, value);
			window.dispatchEvent(
				new CustomEvent(preferencesChanged, { detail: key }),
			);
		},
		removeItem(key) {
			window.localStorage.removeItem(key);
			window.dispatchEvent(
				new CustomEvent(preferencesChanged, { detail: key }),
			);
		},
	},
	sessionStorage: {
		getItem: (key) => window.sessionStorage.getItem(key),
		setItem: (key, value) => window.sessionStorage.setItem(key, value),
		removeItem: (key) => window.sessionStorage.removeItem(key),
	},
	preferredLanguages: () =>
		navigator.languages?.length ? navigator.languages : [navigator.language],
	get device() {
		return navigator;
	},
	onPreferenceChange(key, callback) {
		const local = (event: Event) => {
			if ((event as CustomEvent<unknown>).detail === key) callback();
		};
		const remote = (event: StorageEvent) => {
			if (event.key === key || event.key === null) callback();
		};
		window.addEventListener(preferencesChanged, local);
		window.addEventListener("storage", remote);
		return () => {
			window.removeEventListener(preferencesChanged, local);
			window.removeEventListener("storage", remote);
		};
	},
	openExternal(url) {
		window.open(url, "_blank", "noopener,noreferrer");
		console.debug("platform.external_link_requested");
	},
	openPlayer(request) {
		window.location.assign(resolveBrowserPlayerUrl(browserPlatform, request));
		console.debug("platform.external_player_requested");
	},
	async copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
		} catch (error) {
			console.debug("platform.clipboard_write_failed", {
				errorType: error instanceof Error ? error.name : "unknown",
			});
			throw error;
		}
	},
	downloadFile,
	downloadText(content, filename, mediaType) {
		const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
		try {
			downloadFile(url, filename);
		} finally {
			// Give the browser time to start the download.
			window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		}
	},
	isVisible: () => document.visibilityState !== "hidden",
	isOnline: () => navigator.onLine,
	onForegroundChange(callback) {
		window.addEventListener("focus", callback);
		document.addEventListener("visibilitychange", callback);
		return () => {
			window.removeEventListener("focus", callback);
			document.removeEventListener("visibilitychange", callback);
		};
	},
	onPlaybackLifecycle({ onBackground, onOnline }) {
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") onBackground();
		};
		window.addEventListener("pagehide", onBackground);
		window.addEventListener("online", onOnline);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			window.removeEventListener("pagehide", onBackground);
			window.removeEventListener("online", onOnline);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	},
};
