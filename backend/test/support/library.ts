import { createLibraryModule as createModule } from "../../src/modules/resources/composition/library.js";
import type { LibraryApplication } from "../../src/modules/resources/library/application/library.js";
import { SettingsApplication } from "../../src/modules/system/configuration/application/settings.js";

const settings = new WeakMap<LibraryApplication, SettingsApplication>();
export function createLibraryModule(
	options: Parameters<typeof createModule>[0],
) {
	const library = createModule(options);
	settings.set(
		library,
		new SettingsApplication(
			options.configuration,
			library.settings,
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
