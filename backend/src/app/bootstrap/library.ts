import type { Logger } from "pino";
import { LibraryApplication } from "../../modules/resources/library/application/library.js";
import { ScanCoordinator } from "../../modules/resources/library/application/scan-coordinator.js";
import { SettingsApplication } from "../../modules/resources/library/application/settings.js";
import { LibraryIndex } from "../../modules/resources/library/infrastructure/index.js";
import { ResourceAccessApplication } from "../../modules/resources/resource-access/application/access.js";
import {
	checkResourceRoot,
	ResourceAccess,
} from "../../modules/resources/resource-access/infrastructure/access.js";
import type { ResourceRootApi } from "../../modules/resources/resource-access/public.js";
import type { ConfigurationService } from "../../modules/system/configuration/application/service.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
	type SettingsStore,
} from "../../modules/system/configuration/public.js";
/** Connect the catalog port without a resource-access -> library module dependency. */
export function createLibraryModule(options: {
	configuration: SettingsStore;
	index: LibraryIndex;
	logger: Logger;
	policy?: DeepReadonly<BuiltinPolicy>;
}): LibraryApplication<BuiltinPolicy> {
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
	return new LibraryApplication<BuiltinPolicy>({
		rootFiles,
		configuration,
		index,
		policy,
		sources,
		scans,
		settings,
	});
}

export async function initializeLibrary(
	configuration: ConfigurationService,
	logger: Logger,
): Promise<LibraryApplication> {
	const library = createLibraryModule({
		configuration,
		policy: configuration.policy,
		index: new LibraryIndex(),
		logger,
	});
	const libraryError = (await library.getStatus()).error;
	if (libraryError) {
		const setupRequired = libraryError.code === "RESOURCE_ROOT_NOT_CONFIGURED";
		logger[setupRequired ? "info" : "warn"](
			{
				event: setupRequired
					? "library.setup_required"
					: "library.root_unavailable",
				...libraryError,
			},
			libraryError.message,
		);
	}
	if (library.getSettings().resourceRoot !== null) {
		try {
			const scan = await library.startScan();
			logger.info(
				{ event: "library.startup_scan_started", scanId: scan.id },
				"Startup library scan started.",
			);
		} catch (err) {
			logger.warn(
				{ event: "library.startup_scan_failed", err },
				"Startup library scan could not be started.",
			);
		}
	}
	return library;
}
