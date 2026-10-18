import type { ResourceAccessApi } from "./public.js";

export type { LibraryPolicy } from "./library/policy.js";
export { libraryPolicy, validateLibraryPolicy } from "./library/policy.js";
export type { ResourceAccessPolicy } from "./resource-access/policy.js";
export {
	resourceAccessPolicy,
	validateResourceAccessPolicy,
} from "./resource-access/policy.js";

import type { Logger } from "pino";
import type { DeepReadonly } from "../../shared/policy.js";
import type { SystemApi } from "../system/public.js";
import { createLibraryModule } from "./composition/library.js";
import { registerResourcesHttp } from "./http.js";
import { LibraryIndex } from "./library/infrastructure/index.js";
import {
	type LibraryRuntimePolicy,
	libraryRuntimePolicy,
} from "./library/policy.js";
import type { ResourcesApi } from "./public.js";
export async function createResourcesModule(options: {
	system: SystemApi;
	logger: Logger;
	policy?: DeepReadonly<LibraryRuntimePolicy>;
}) {
	const library = createLibraryModule({
		configuration: options.system,
		index: new LibraryIndex(),
		logger: options.logger,
		policy: {
			library: (options.policy ?? libraryRuntimePolicy).library,
			resourceAccess: (options.policy ?? libraryRuntimePolicy).resourceAccess,
			subtitles: {
				formats: (options.policy ?? libraryRuntimePolicy).subtitles.formats,
			},
		},
	});
	const sources: ResourceAccessApi = {
		get accessRevision() {
			return library.sources.accessRevision;
		},
		get hasSnapshot() {
			return library.sources.hasSnapshot;
		},
		resolveSource: (id, version) => library.sources.resolveSource(id, version),
		revalidateSource: (source) => library.sources.revalidateSource(source),
		assertAccessRevision: (epoch) =>
			library.sources.assertAccessRevision(epoch),
		getScope: () => library.sources.getScope(),
		filePath: (expected) => library.sources.filePath(expected),
		getFile: (id) => library.sources.getFile(id),
		openMedia: (id) => library.sources.openMedia(id),
		openResources: (source) => library.sources.openResources(source),
	};
	const api: ResourcesApi = {
		sources,
		applySettingsChange: (input, save) =>
			library.settings.applySettingsChange(input, save),
		onSnapshotChanged: (listener) => library.onSnapshotChanged(listener),
		readDirectoryFiles: (id) => library.readDirectoryFiles(id),
		readFilePage: (revision, offset, limit) =>
			library.readFilePage(revision, offset, limit),
		getStatus: () => library.getStatus(),
		getDirectory: (id) => library.getDirectory(id),
		getFile: (id) => library.getFile(id),
		startScan: () => library.startScan(),
		cancelScan: () => library.cancelScan(),
	};
	try {
		const status = await api.getStatus();
		if (status.error) {
			const setupRequired =
				status.error.code === "RESOURCE_ROOT_NOT_CONFIGURED";
			options.logger[setupRequired ? "info" : "warn"](
				{
					...status.error,
					event: setupRequired
						? "library.setup_required"
						: "library.root_unavailable",
				},
				status.error.message,
			);
		}
		if (options.system.settings.resourceRoots.length > 0) {
			const scan = await api.startScan();
			options.logger.info(
				{ event: "library.startup_scan_started", scanId: scan.id },
				"Startup library scan started.",
			);
		}
	} catch (err) {
		options.logger.warn(
			{ event: "library.startup_scan_failed", err },
			"Startup library scan could not be started.",
		);
	}
	return {
		api,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerResourcesHttp(app, library),
		quiesce: () => library.close(),
		close: () => library.close(),
	};
}
