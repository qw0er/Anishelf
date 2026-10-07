import type { Logger } from "pino";
import { preparationConstraints } from "../contracts/defaults.js";
import type { ConfigurationService } from "../modules/configuration/application/service.js";
import type { MediaInspectionApi } from "../modules/media-inspection/public.js";
import { MediaPlanningApplication } from "../modules/media-planning/application/planning.js";
import { MediaProcessingApplication } from "../modules/media-processing/application/processing.js";
import type { ResourceAccessApi } from "../modules/resource-access/public.js";
import {
	FfmpegExecutionAdapter,
	type MediaTools,
} from "../platform/media/index.js";

/** Internal execution composition; HTTP jobs and persistent artifacts are separate workflows. */
export function createMediaExecutionModule(options: {
	configuration: ConfigurationService;
	sources: ResourceAccessApi;
	inspection: MediaInspectionApi;
	tools: MediaTools;
	logger?: Logger;
}) {
	const { configuration, sources, inspection, tools } = options;
	const planning = new MediaPlanningApplication({
		sources,
		inspection,
		...(options.logger ? { logger: options.logger } : {}),
		profiles: configuration.transcodeProfiles,
		preparationMode: () => configuration.snapshot.settings.preparationMode,
	});
	const processing = new MediaProcessingApplication({
		sources,
		inspection,
		tools,
		executor: new FfmpegExecutionAdapter(
			tools.status.ffmpeg,
			configuration.policy.mediaTools,
			options.logger,
		),
		dataDir: configuration.deployment.dataDir,
		policy: configuration.policy.mediaProcessing,
		maximumProcessedBytes: () =>
			(configuration.settings.transcodeCacheBudgetGiB ??
				preparationConstraints.defaultCacheBudgetGiB) *
			1024 ** 3,
		...(options.logger ? { logger: options.logger } : {}),
	});
	return {
		planning,
		processing,
		close: async () => {
			planning.close();
			await processing.close();
		},
	};
}
