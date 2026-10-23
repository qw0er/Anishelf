import { createLibraryModule as createModule } from "../../src/modules/resources/composition/library.js";
import type { LibraryApplication } from "../../src/modules/resources/library/application/library.js";
import { SettingsApplication } from "../../src/modules/system/configuration/application/settings.js";

const settings = new WeakMap<LibraryApplication, SettingsApplication>();
export function createLibraryModule(
	options: Omit<Parameters<typeof createModule>[0], "configuration"> & {
		configuration: import("../../src/modules/system/public.js").SettingsStore & {
			patchSettings?: import("../../src/modules/system/public.js").SystemApi["patchSettings"];
		};
	},
) {
	const original = options.configuration;
	const configuration = {
		get settings() {
			return original.settings;
		},
		update: (
			value: import("../../src/modules/system/public.js").PersistentSettings,
		) => original.update(value),
		patchSettings: (
			patch: Partial<
				import("../../src/modules/system/public.js").PersistentSettings
			>,
		) =>
			original.patchSettings
				? original.patchSettings(patch)
				: original.update({ ...original.settings, ...patch }),
	};
	const library = createModule({ ...options, configuration });
	settings.set(
		library,
		new SettingsApplication(
			configuration,
			{
				applySettingsChange: (input, save) =>
					library.settings.applySettingsChange(input, save),
			},
			options.logger,
		),
	);
	return library;
}
export function fixtureSettings(
	library: LibraryApplication,
): SettingsApplication {
	const application = settings.get(library);
	if (!application)
		throw new Error("Library settings fixture was not assembled.");
	return application;
}
