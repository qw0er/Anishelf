import type { Logger } from "pino";
import type { DeepReadonly } from "../../shared/policy.js";
import type { SystemApi } from "../system/public.js";
import { registerResourcesHttp } from "./http.js";
import { createLibraryModule } from "./library/create.js";
import {
	type LibraryRuntimePolicy,
	libraryRuntimePolicy,
	validateLibraryPolicy,
} from "./library/policy.js";
import type { ResourcesApi } from "./public.js";
import { validateResourceAccessPolicy } from "./resource-access/policy.js";
export async function createResourcesModule(options: {
	system: SystemApi;
	logger: Logger;
	policy?: DeepReadonly<Partial<LibraryRuntimePolicy>>;
}) {
	const policy = { ...libraryRuntimePolicy, ...options.policy };
	validateLibraryPolicy(policy.library);
	validateResourceAccessPolicy(policy.resourceAccess);
	options.logger.debug(
		{
			event: "resources.policy_resolved",
			overrides: Object.keys(options.policy ?? {}),
		},
		"Resource policies validated.",
	);
	const library = createLibraryModule({
		configuration: options.system,
		logger: options.logger,
		policy,
	});
	const sources = library.sources;
	const api: ResourcesApi = {
		sources,
		acquisition: {
			roots: library.downloadRoots.bind(library),
			validate: library.validateDownloadRoot.bind(library),
			inspect: library.inspectDownload.bind(library),
			refresh: library.refreshDownload.bind(library),
		},
		applySettingsChange: library.settings.applySettingsChange.bind(
			library.settings,
		),
		onSnapshotChanged: library.onSnapshotChanged.bind(library),
		readDirectoryFiles: library.readDirectoryFiles.bind(library),
		readFilePage: library.readFilePage.bind(library),
		getStatus: library.getStatus.bind(library),
		getDirectory: library.getDirectory.bind(library),
		getFile: library.getFile.bind(library),
		startScan: library.startScan.bind(library),
		cancelScan: library.cancelScan.bind(library),
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
		quiesce: library.close.bind(library),
		close: library.close.bind(library),
	};
}
