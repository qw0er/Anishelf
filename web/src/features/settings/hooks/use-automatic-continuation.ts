import { useEffect, useState } from "react";

const storageKey = "anishelf.autoContinue";
const changeEvent = "anishelf:automatic-continuation-changed";

function load() {
	try {
		return {
			enabled: window.localStorage.getItem(storageKey) === "true",
			error: false,
		};
	} catch {
		return { enabled: false, error: true };
	}
}

/** One browser preference shared by Settings, player options and episode navigation. */
export function useAutomaticContinuation() {
	const [state, setState] = useState(load);
	useEffect(() => {
		const refresh = () => setState(load());
		const storageChanged = (event: StorageEvent) => {
			if (event.key === storageKey || event.key === null) refresh();
		};
		window.addEventListener(changeEvent, refresh);
		window.addEventListener("storage", storageChanged);
		refresh();
		return () => {
			window.removeEventListener(changeEvent, refresh);
			window.removeEventListener("storage", storageChanged);
		};
	}, []);
	return {
		...state,
		setEnabled(enabled: boolean) {
			try {
				window.localStorage.setItem(storageKey, String(enabled));
			} catch (error) {
				console.warn(
					"[playback] Automatic continuation preference could not be saved.",
				);
				throw error;
			}
			console.info("[playback] Automatic continuation preference changed.", {
				enabled,
			});
			window.dispatchEvent(new Event(changeEvent));
		},
	};
}
