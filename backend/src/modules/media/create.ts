import type { Logger } from "pino";
import type { MediaTools } from "../../platform/media/index.js";
import {
	mediaToolPolicy,
	validateMediaToolPolicy,
} from "../../platform/media/policy.js";
import { defaultSortingPolicy } from "../../shared/sorting.js";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { createMediaExecutionModule } from "./composition/media-execution.js";
import { createPlaybackCopies } from "./composition/playback-selection.js";
import {
	createPreparationModule,
	initializePreparationModule,
} from "./composition/preparation.js";
import {
	createSubtitleModule,
	initializeSubtitleModule,
} from "./composition/subtitles.js";
import { registerMediaHttp } from "./http.js";
import { MediaInspectionApplication } from "./media-inspection/application.js";
import {
	mediaInspectionPolicy,
	validateMediaInspectionPolicy,
} from "./media-inspection/policy.js";
import {
	mediaProcessingPolicy,
	validateMediaProcessingPolicy,
} from "./media-processing/policy.js";
import type { MediaPersistence } from "./persistence.js";
import {
	preparationPolicy,
	validatePreparationPolicy,
} from "./preparation/policy.js";
import type { MediaApi } from "./public.js";
import { subtitlePolicy, validateSubtitlePolicy } from "./subtitles/policy.js";
import { compatibilityView } from "./views.js";

export interface MediaModulePolicy {
	mediaInspection: import("./media-inspection/policy.js").MediaInspectionPolicy;
	mediaProcessing: import("./media-processing/policy.js").MediaProcessingPolicy;
	preparation: import("./preparation/policy.js").PreparationPolicy;
	subtitles: import("./subtitles/policy.js").SubtitlePolicy;
	library: import("../../shared/sorting.js").SortingPolicy;
	mediaTools: import("../../platform/media/policy.js").MediaToolPolicy;
}
export async function createMediaModule(options: {
	system: SystemApi;
	resources: ResourcesApi;
	database: MediaPersistence;
	tools: MediaTools;
	logger: Logger;
	policy?: import("../../shared/policy.js").DeepReadonly<
		Partial<MediaModulePolicy>
	>;
}) {
	const policy = {
		mediaInspection: mediaInspectionPolicy,
		mediaProcessing: mediaProcessingPolicy,
		preparation: preparationPolicy,
		subtitles: subtitlePolicy,
		library: defaultSortingPolicy,
		mediaTools: mediaToolPolicy,
		...options.policy,
	};
	validateMediaInspectionPolicy(policy.mediaInspection);
	validateMediaProcessingPolicy(policy.mediaProcessing);
	validatePreparationPolicy(policy.preparation);
	validateSubtitlePolicy(policy.subtitles);
	validateMediaToolPolicy(policy.mediaTools);
	options.logger.debug(
		{
			event: "media.policy_resolved",
			overrides: Object.keys(options.policy ?? {}),
		},
		"Media policies validated.",
	);
	const {
		system: configuration,
		resources: library,
		database,
		tools,
		logger,
	} = options;
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools,
		repository: database.inspections,
		cacheVersion: `probe:1:${tools.status.ffprobe.available ? tools.status.ffprobe.version : "unavailable"}`,
		logger,
		policy: policy.mediaInspection,
	});
	const reconcileInspections = () =>
		void inspection.reconcile(library).catch((error) =>
			logger.debug(
				{
					event: "media.inspection_cache_reconcile_deferred",
					errorName: error instanceof Error ? error.name : "unknown",
				},
				"Inspection cache cleanup deferred until the next resource publication.",
			),
		);
	const unsubscribeInspections =
		library.onSnapshotChanged(reconcileInspections);
	reconcileInspections();
	const execution = createMediaExecutionModule({
		configuration,
		sources: library.sources,
		inspection,
		tools,
		logger,
		toolPolicy: policy.mediaTools,
		processingPolicy: policy.mediaProcessing,
	});
	const preparation = createPreparationModule({
		configuration,
		library,
		database,
		planning: execution.planning,
		processing: execution.processing,
		logger,
		policy: policy.preparation,
	});
	const subtitles = createSubtitleModule({
		configuration,
		library,
		database,
		tools,
		inspection,
		logger,
		policy: { subtitles: policy.subtitles, library: policy.library },
	});
	await initializePreparationModule(preparation, logger);
	await initializeSubtitleModule(subtitles, logger);
	const copies = createPlaybackCopies(preparation);
	const api: MediaApi = {
		inspectCompatibility: (input) => execution.planning.inspect(input),
		checkCompatibility: async (input) =>
			compatibilityView(await execution.planning.check(input)),
		listPlaybackCopies: (id) => copies.list(id),
		getPlaybackCopy: (id) => copies.get(id),
	};
	let stopped: Promise<void> | undefined;
	let closed: Promise<void> | undefined;
	const quiesce = () => (stopped ??= preparation.close());
	return {
		api,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerMediaHttp(app, {
				inspection,
				planning: execution.planning,
				preparation,
				subtitles,
			}),
		quiesce,
		close: () =>
			(closed ??= (async () => {
				unsubscribeInspections();
				await quiesce();
				await subtitles.close();
				await execution.close();
				await inspection.close();
			})()),
	};
}
