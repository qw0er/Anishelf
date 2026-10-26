import type { Logger } from "pino";
import {
	FfmpegExecutionAdapter,
	type MediaTools,
} from "../../../platform/media/index.js";
import {
	type MediaToolPolicy,
	mediaToolPolicy,
} from "../../../platform/media/policy.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import type { MediaInspectionApi } from "../media-inspection/public.js";
import { MediaProcessingApplication } from "./application/processing.js";
import { type MediaProcessingPolicy, mediaProcessingPolicy } from "./policy.js";

export function createMediaProcessingModule(options: {
	sources: ResourceAccessApi;
	inspection: MediaInspectionApi;
	tools: MediaTools;
	dataDir: string;
	maximumProcessedBytes: () => number;
	logger?: Logger;
	toolPolicy?: MediaToolPolicy;
	policy?: MediaProcessingPolicy;
}) {
	const { sources, inspection, tools } = options;
	return new MediaProcessingApplication({
		sources,
		inspection,
		tools,
		executor: new FfmpegExecutionAdapter(
			() => tools.toolStatus("ffmpeg"),
			options.toolPolicy ?? mediaToolPolicy,
			options.logger,
		),
		dataDir: options.dataDir,
		policy: options.policy ?? mediaProcessingPolicy,
		maximumProcessedBytes: options.maximumProcessedBytes,
		...(options.logger ? { logger: options.logger } : {}),
	});
}
