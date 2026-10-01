import type { SettingsStore } from "../src/application/library.js";
import type { PersistentSettings } from "../src/config/model.js";

/** In-memory persistence adapter for tests that do not exercise disk writes. */
export function settingsStore(resourceRoot: string): SettingsStore {
	let current: PersistentSettings = { resourceRoot };
	return {
		get settings() {
			return { ...current };
		},
		async update(next) {
			current = { ...next };
			return { ...current };
		},
	};
}
