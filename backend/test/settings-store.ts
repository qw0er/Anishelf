import type { PersistentSettings } from "../src/modules/configuration/domain/model.js";
import type { SettingsStore } from "../src/modules/configuration/public.js";

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
