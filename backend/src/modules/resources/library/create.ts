import type { Logger } from "pino";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { SettingsStore } from "../../system/public.js";
import { createResourceAccess } from "../resource-access/create.js";
import { ChangeProcessor } from "./application/change-processor.js";
import { LibraryApplication } from "./application/library.js";
import { LibrarySynchronizer } from "./application/library-synchronizer.js";
import { ResourceCommands } from "./application/mutations.js";
import { RootMonitorManager } from "./application/root-monitor-manager.js";
import { ScanRunner } from "./application/scan-runner.js";
import { ResourceSettingsApplication } from "./application/settings.js";
import { LibraryIndex } from "./infrastructure/index.js";
import { LibraryScanner } from "./infrastructure/scanner.js";
import { type LibraryRuntimePolicy, libraryRuntimePolicy } from "./policy.js";

/** Constructs collaborators; source access and library synchronization share one directory owner. */
export function createLibraryModule(options: {
	configuration: Pick<SettingsStore, "settings">;
	index?: LibraryIndex;
	logger: Logger;
	policy?: DeepReadonly<LibraryRuntimePolicy>;
}): LibraryApplication<LibraryRuntimePolicy> {
	const { configuration } = options;
	const index = options.index ?? new LibraryIndex();
	const policy = options.policy ?? libraryRuntimePolicy;
	const logger = options.logger.child({ module: "library" });
	index.configure(policy.library);
	const { roots, sources, api } = createResourceAccess({
		configuration,
		policy,
		catalog: {
			get hasSnapshot() {
				return index.scannedAt !== null;
			},
			getFile: index.getFile.bind(index),
		},
	});
	const monitoring = new RootMonitorManager({ policy: policy.library, logger });
	const scans = new ScanRunner({
		roots,
		scanner: new LibraryScanner(logger.child({ module: "scanner" }), policy),
		logger,
		warningMessageLimit: policy.library.warningMessageLimit,
	});
	const changes = new ChangeProcessor({ roots, index, policy });
	const synchronizer = new LibrarySynchronizer({
		configuration,
		roots,
		index,
		scans,
		changes,
		monitoring,
		logger,
	});
	const settings = new ResourceSettingsApplication({
		configuration,
		synchronizer,
		logger,
		rootChanged: async () => {
			sources.invalidateRoot();
			const directories = await roots.list(configuration.settings);
			index.reset(
				directories.map((root) => ({ id: root.scopeId, name: root.name })),
			);
		},
	});
	logger.debug(
		{ event: "library.services_configured" },
		"Resource access, library scanning and synchronization configured.",
	);
	return new LibraryApplication<LibraryRuntimePolicy>({
		roots,
		index,
		policy,
		sources: api,
		synchronizer,
		settings,
		commands: new ResourceCommands({
			index,
			roots,
			settings: () => configuration.settings,
			synchronizer,
			logger,
		}),
	});
}
