import type { Logger } from "pino";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { SettingsStore } from "../../system/public.js";
import { ChangeProcessor } from "../library/application/change-processor.js";
import { LibraryApplication } from "../library/application/library.js";
import { LibrarySynchronizer } from "../library/application/library-synchronizer.js";
import { RootMonitorManager } from "../library/application/root-monitor-manager.js";
import { ScanRunner } from "../library/application/scan-runner.js";
import { ResourceSettingsApplication } from "../library/application/settings.js";
import type { LibraryIndex } from "../library/infrastructure/index.js";
import { LibraryScanner } from "../library/infrastructure/scanner.js";
import {
	type LibraryRuntimePolicy,
	libraryRuntimePolicy,
} from "../library/policy.js";
import { ResourceAccessApplication } from "../resource-access/application/access.js";
import { ResourceRoots } from "../resource-access/application/roots.js";

/** Constructs collaborators; source access and library synchronization share one directory owner. */
export function createLibraryModule(options: {
	configuration: SettingsStore;
	index: LibraryIndex;
	logger: Logger;
	policy?: DeepReadonly<LibraryRuntimePolicy>;
}): LibraryApplication<LibraryRuntimePolicy> {
	const { index, configuration } = options;
	const policy = options.policy ?? libraryRuntimePolicy;
	const logger = options.logger.child({ module: "library" });
	index.configure(policy.library);
	const roots = new ResourceRoots(policy);
	const sources = new ResourceAccessApplication({
		configuration,
		roots,
		catalog: {
			get hasSnapshot() {
				return index.scannedAt !== null;
			},
			getFile: (id) => index.getFile(id),
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
	return new LibraryApplication<LibraryRuntimePolicy>({
		roots,
		index,
		policy,
		sources,
		synchronizer,
		settings,
	});
}
