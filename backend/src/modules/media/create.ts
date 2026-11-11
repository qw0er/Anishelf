import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { MediaTools } from "../../platform/media/index.js";
import {
	mediaToolPolicy,
	validateMediaToolPolicy,
} from "../../platform/media/policy.js";
import { defaultSortingPolicy } from "../../shared/sorting.js";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { MediaAssetsApplication } from "./catalog.js";
import { registerMediaHttp } from "./http.js";
import { MediaInspectionApplication } from "./inspection/application.js";
import {
	mediaInspectionPolicy,
	validateMediaInspectionPolicy,
} from "./inspection/policy.js";
import type { MediaPersistence } from "./persistence.js";
import {
	createPreparationApplication,
	initializePreparationModule,
} from "./preparation/create.js";
import { createMediaProcessingModule } from "./preparation/execution/create.js";
import {
	mediaProcessingPolicy,
	validateMediaProcessingPolicy,
} from "./preparation/execution/policy.js";
import { MediaPlanningApplication } from "./preparation/planning/application/planning.js";
import {
	preparationPolicy,
	validatePreparationPolicy,
} from "./preparation/policy.js";
import type { MediaApi } from "./public.js";
import { EmbeddedSubtitles } from "./subtitles/application/embedded.js";
import { createSubtitleApplication } from "./subtitles/create.js";
import { subtitlePolicy, validateSubtitlePolicy } from "./subtitles/policy.js";

export interface MediaModulePolicy {
	mediaInspection: import("./inspection/policy.js").MediaInspectionPolicy;
	mediaProcessing: import("./preparation/execution/policy.js").MediaProcessingPolicy;
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
	await configuration.configureTranscodeValidation?.(
		(profiles) =>
			tools.validateProfiles<import("../system/public.js").TranscodeProfile>(
				profiles,
			),
		logger,
	);
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
	const planning = new MediaPlanningApplication({
		sources: library.sources,
		inspection,
		logger,
		profiles: () =>
			configuration.transcodeProfiles.filter(
				(profile) =>
					configuration.transcodeValidation?.[profile.id]?.status !==
					"unsupported",
			),
		refreshProfiles:
			configuration.refreshTranscodeValidation?.bind(configuration),
	});
	const processing = createMediaProcessingModule({
		dataDir: configuration.deployment.dataDir,
		sources: library.sources,
		inspection,
		tools,
		logger,
		toolPolicy: policy.mediaTools,
		policy: policy.mediaProcessing,
	});
	const preparation = createPreparationApplication({
		probe: tools.probe.bind(tools),
		sources: library.sources,
		repository: database.preparation,
		profiles: () => configuration.transcodeProfiles,
		dataDir: configuration.deployment.dataDir,
		planning,
		processing,
		logger,
		policy: policy.preparation,
	});
	for (const segments of [["cache", "subtitles"], ["subtitle-fonts"]]) {
		await rm(join(configuration.deployment.dataDir, ...segments), {
			recursive: true,
			force: true,
		}).catch((err) =>
			logger.warn(
				{ event: "media.retired_cache_cleanup_deferred", err },
				"Retired subtitle cache cleanup deferred.",
			),
		);
	}
	const subtitles = createSubtitleApplication({
		sources: library.sources,
		logger,
		policy: { subtitles: policy.subtitles, library: policy.library },
	});
	await initializePreparationModule(preparation, logger);
	const assets = new MediaAssetsApplication({
		inspection,
		preparation,
		sources: library.sources,
		logger,
	});
	const embeddedSubtitles = new EmbeddedSubtitles({
		sources: library.sources,
		catalog: assets,
		inspection,
		preparation,
		tools,
		maximumBytes: policy.subtitles.maximumBytes,
		logger,
	});
	const api: MediaApi = { listPlaybackAssets: assets.list.bind(assets) };
	let stopped: Promise<void> | undefined;
	let closed: Promise<void> | undefined;
	const quiesce = () =>
		(stopped ??= (async () => {
			embeddedSubtitles.close();
			await preparation.close();
		})());
	return {
		api,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerMediaHttp(app, {
				inspection,
				preparation,
				subtitles,
				embeddedSubtitles,
			}),
		quiesce,
		close: () =>
			(closed ??= (async () => {
				unsubscribeInspections();
				await quiesce();
				planning.close();
				await processing.close();
				await inspection.close();
			})()),
	};
}
