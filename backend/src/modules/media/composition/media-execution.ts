import type { Logger } from "pino";
import { preparationConstraints } from "../../../contracts/defaults.js";
import {
	FfmpegExecutionAdapter,
	type MediaTools,
} from "../../../platform/media/index.js";
import { mediaToolPolicy } from "../../../platform/media/policy.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import type { SystemApi } from "../../system/public.js";
import type { MediaInspectionApi } from "../media-inspection/public.js";
import { MediaPlanningApplication } from "../media-planning/application/planning.js";
import { MediaProcessingApplication } from "../media-processing/application/processing.js";
import { mediaProcessingPolicy } from "../media-processing/policy.js";

/** Internal execution composition; HTTP jobs and persistent artifacts are separate workflows. */
export function createMediaExecutionModule(options: {
	configuration: SystemApi;
	sources: ResourceAccessApi;
	inspection: MediaInspectionApi;
	tools: MediaTools;
	logger?: Logger;
	toolPolicy?: import("../../../platform/media/policy.js").MediaToolPolicy;
	processingPolicy?: import("../media-processing/policy.js").MediaProcessingPolicy;
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
			options.toolPolicy ?? mediaToolPolicy,
			options.logger,
		),
		dataDir: configuration.deployment.dataDir,
		policy: options.processingPolicy ?? mediaProcessingPolicy,
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
