import type { Logger } from "pino";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
	type SettingsStore,
} from "../modules/configuration/public.js";
import { LibraryApplication } from "../modules/library/application/library.js";
import { ScanCoordinator } from "../modules/library/application/scan-coordinator.js";
import { SettingsApplication } from "../modules/library/application/settings.js";
import type { LibraryIndex } from "../modules/library/infrastructure/index.js";
import { ResourceAccessApplication } from "../modules/resource-access/application/access.js";
/** Connect the catalog port without a resource-access -> library module dependency. */
export function createLibraryModule(options: {
	configuration: SettingsStore;
	index: LibraryIndex;
	logger: Logger;
	policy?: DeepReadonly<BuiltinPolicy>;
}): LibraryApplication {
	const { index, configuration, logger } = options;
	const policy = options.policy ?? builtinPolicy;
	const sources = new ResourceAccessApplication({
		configuration,
		policy,
		catalog: {
			get hasSnapshot() {
				return index.scannedAt !== null;
			},
			getFile: (id) => index.getFile(id),
		},
	});
	const scans = new ScanCoordinator({ configuration, index, logger, policy });
	const settings = new SettingsApplication({
		configuration,
		scans,
		logger,
		rootChanged: () => {
			sources.invalidateRoot();
			index.reset();
		},
	});
	return new LibraryApplication({
		configuration,
		index,
		policy,
		sources,
		scans,
		settings,
	});
}
