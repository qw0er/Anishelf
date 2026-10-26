import type { Logger } from "pino";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import type { MediaInspectionApi } from "../media-inspection/public.js";
import { SubtitleDiscoveryService } from "./application/discovery.js";
import { SubtitleFontPreparation } from "./application/font-preparation.js";
import { SubtitlePreparationApplication } from "./application/subtitle-preparation.js";
import { SubtitleApplication } from "./application/subtitles.js";
import { type SubtitleRuntimePolicy, subtitleRuntimePolicy } from "./policy.js";
import type { SubtitleExtractor } from "./ports.js";
import type { SubtitleStore } from "./storage.js";

export function createSubtitleApplication(options: {
	logger?: Logger;
	sources: ResourceAccessApi;
	policy?: DeepReadonly<SubtitleRuntimePolicy>;
	inspection: MediaInspectionApi;
	tools: SubtitleExtractor;
	repository: SubtitleStore;
	dataDir: string;
}): SubtitleApplication {
	const logger = options.logger?.child({ module: "subtitles" });
	const policy = options.policy ?? subtitleRuntimePolicy;

	const dependencies = {
		dataDir: options.dataDir,
		repository: options.repository,
		sources: options.sources,
		tools: options.tools,
		...(logger ? { logger } : {}),
	};
	const fonts = new SubtitleFontPreparation({
		...dependencies,
		policy: policy.subtitles,
	});
	const preparation = new SubtitlePreparationApplication({
		...dependencies,
		policy,
		tools: {
			extractSubtitle: options.tools.extractSubtitle.bind(options.tools),
		},
	});
	logger?.debug(
		{ event: "subtitles.services_configured" },
		"Subtitle discovery, font and preparation services configured.",
	);
	return new SubtitleApplication({
		sources: options.sources,
		policy,
		discovery: new SubtitleDiscoveryService({
			sources: options.sources,
			policy,
			inspection: options.inspection,
			...(logger ? { logger } : {}),
		}),
		...(logger ? { logger } : {}),
		fonts,
		preparation,
	});
}

export async function initializeSubtitleModule(
	subtitles: SubtitleApplication,
	logger: Logger,
): Promise<void> {
	try {
		await subtitles.initialize();
	} catch (err) {
		logger.warn(
			{ event: "subtitles.cache_unavailable", err },
			"Subtitle preparation is unavailable; direct playback and external subtitles remain usable.",
		);
	}
}
