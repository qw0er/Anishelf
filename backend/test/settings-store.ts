import type { PersistentSettings } from "../src/modules/system/configuration/domain/model.js";
import type { SettingsStore } from "../src/modules/system/configuration/public.js";

/** In-memory persistence adapter for tests that do not exercise disk writes. */
export function settingsStore(resourceRoots: string): SettingsStore {
	let current: PersistentSettings = { resourceRoots: [resourceRoots] };
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
