import type { Logger } from "pino";
import { createHttpApp as createProtocolHttpApp } from "../../src/app/bootstrap/http.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../../src/app/policy.js";
import { registerCatalogRoutes } from "../../src/modules/anime/anime-catalog/http/catalog.js";
import type { AnimeCatalogApi } from "../../src/modules/anime/anime-catalog/public.js";
import { registerMetadataRoutes } from "../../src/modules/anime/metadata/http/metadata.js";
import type { MetadataApi } from "../../src/modules/anime/metadata/public.js";
import { createSubtitleApplication } from "../../src/modules/media/composition/subtitle-application.js";
import type { MediaInspectionApplication } from "../../src/modules/media/media-inspection/application.js";
import { registerChapterRoutes } from "../../src/modules/media/media-inspection/http/chapters.js";
import type { MediaPlanningApplication } from "../../src/modules/media/media-planning/application/planning.js";
import { registerMediaPlanningRoutes } from "../../src/modules/media/media-planning/http/planning.js";
import type { PreparationApplication } from "../../src/modules/media/preparation/application/preparation.js";
import { registerPreparationRoutes } from "../../src/modules/media/preparation/http/preparation.js";
import type { SubtitleApplication } from "../../src/modules/media/subtitles/application/subtitles.js";
import { registerSubtitleRoutes } from "../../src/modules/media/subtitles/http/subtitles.js";
import { registerPlaybackSelectionRoutes } from "../../src/modules/playback/playback-selection/http/selection.js";
import type { PlaybackSelectionApi } from "../../src/modules/playback/playback-selection/public.js";
import type { PlaybackApplication } from "../../src/modules/playback/progress/application/playback.js";
import { registerPlaybackRoutes } from "../../src/modules/playback/progress/http/playback.js";
import type { LibraryApplication } from "../../src/modules/resources/library/application/library.js";
import { registerLibraryRoutes } from "../../src/modules/resources/library/http/library.js";
import { registerMediaRoutes } from "../../src/modules/resources/library/http/media.js";
import type { DeploymentConfig } from "../../src/modules/system/configuration/domain/model.js";
import { registerSettingsRoutes } from "../../src/modules/system/configuration/http/settings.js";
import { registerTranscodeProfileRoutes } from "../../src/modules/system/configuration/http/transcode-profiles.js";
import { fixtureSettings } from "./library.js";
export function createHttpApp(options: {
	metadata?: MetadataApi;
	catalog?: AnimeCatalogApi;
	playbackSelection?: PlaybackSelectionApi;
	config: Pick<DeploymentConfig, "host" | "port" | "publicOrigin">;
	logger: Logger;
	policy?: DeepReadonly<BuiltinPolicy>;
	development?: boolean;
	library?: LibraryApplication;
	playback?: PlaybackApplication;
	preparation?: PreparationApplication;
	subtitles?: SubtitleApplication;
	mediaPlanning?: MediaPlanningApplication;
	inspection?: MediaInspectionApplication;
	frontendRoot?: string;
	configuration?: import("../../src/modules/system/public.js").SystemApi;
	/** Bootstrap can own shutdown of shared dependencies. */
	closeDependencies?: () => Promise<void>;
}) {
	const policy = options.policy ?? {
		...builtinPolicy,
		...options.library?.policy,
		subtitles: {
			...builtinPolicy.subtitles,
			...options.library?.policy.subtitles,
		},
	};
	let ownedSubtitles = options.subtitles;
	return createProtocolHttpApp({
		config: options.config,
		logger: options.logger,
		policy,
		...(options.development === undefined
			? {}
			: { development: options.development }),
		...(options.frontendRoot ? { frontendRoot: options.frontendRoot } : {}),
		registrations: [
			(app) => {
				if (options.metadata) registerMetadataRoutes(app, options.metadata);
				if (options.catalog) registerCatalogRoutes(app, options.catalog);
				if (options.library) {
					const library = options.library;

					registerLibraryRoutes(app, library);
					registerMediaRoutes(app, library);
					const subtitles =
						options.subtitles ??
						createSubtitleApplication({
							sources: library.sources,
							logger: options.logger,
							policy,
						});
					ownedSubtitles = subtitles;
					registerSubtitleRoutes(app, subtitles);
					registerSettingsRoutes(
						app,
						fixtureSettings(library),
						policy.library.maximumScanIntervalMinutes,
					);
				}

				if (options.configuration)
					registerTranscodeProfileRoutes(app, options.configuration);

				if (options.playback) {
					const playback = options.playback;

					registerPlaybackRoutes(app, playback);
				}

				if (options.playbackSelection)
					registerPlaybackSelectionRoutes(app, options.playbackSelection);
				if (options.inspection) registerChapterRoutes(app, options.inspection);
				if (options.mediaPlanning)
					registerMediaPlanningRoutes(app, options.mediaPlanning);
				if (options.preparation) {
					const preparation = options.preparation;

					registerPreparationRoutes(app, preparation);
				}
			},
		],
		closeDependencies:
			options.closeDependencies ??
			(async () => {
				options.catalog?.close();
				await options.preparation?.close();
				options.playback?.close();
				options.mediaPlanning?.close();
				await ownedSubtitles?.close();
				await options.library?.close();
			}),
	});
}
