import type { Logger } from "pino";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { SettingsStore } from "../../system/public.js";
import { LibraryApplication } from "../library/application/library.js";
import { ScanCoordinator } from "../library/application/scan-coordinator.js";
import { SettingsApplication } from "../library/application/settings.js";
import type { LibraryIndex } from "../library/infrastructure/index.js";
import {
	type LibraryRuntimePolicy,
	libraryRuntimePolicy,
} from "../library/policy.js";
import { ResourceAccessApplication } from "../resource-access/application/access.js";
import {
	checkResourceRoot,
	ResourceAccess,
} from "../resource-access/infrastructure/access.js";
import type { ResourceRootApi } from "../resource-access/public.js";
/** Connect the catalog port without a resource-access -> library module dependency. */
export function createLibraryModule(options: {
	configuration: SettingsStore;
	index: LibraryIndex;
	logger: Logger;
	policy?: DeepReadonly<LibraryRuntimePolicy>;
}): LibraryApplication<LibraryRuntimePolicy> {
	const { index, configuration, logger } = options;
	const policy = options.policy ?? libraryRuntimePolicy;
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
	const rootFiles: ResourceRootApi = {
		checkRoot: (settings) => checkResourceRoot(settings),
		openRoot: (settings, policy) => ResourceAccess.create(settings, policy),
	};
	const scans = new ScanCoordinator({
		configuration,
		index,
		logger,
		policy,
		rootFiles,
	});
	const settings = new SettingsApplication({
		configuration,
		scans,
		logger,
		rootChanged: () => {
			sources.invalidateRoot();
			index.reset();
		},
	});
	return new LibraryApplication<LibraryRuntimePolicy>({
		rootFiles,
		configuration,
		index,
		policy,
		sources,
		scans,
		settings,
	});
}
