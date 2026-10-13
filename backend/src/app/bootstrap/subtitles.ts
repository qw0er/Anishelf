import type { Logger } from "pino";
import type { MediaInspectionApplication } from "../../modules/media/media-inspection/application.js";
import { SubtitleApplication } from "../../modules/media/subtitles/application/subtitles.js";
import type { LibraryApplication } from "../../modules/resources/library/application/library.js";
import type { ConfigurationService } from "../../modules/system/configuration/application/service.js";
import type { MediaTools } from "../../platform/media/index.js";
import type { ApplicationDatabase } from "./database.js";

export function createSubtitleModule({
	configuration,
	library,
	database,
	tools,
	inspection,
	logger,
}: {
	configuration: ConfigurationService;
	library: LibraryApplication;
	database?: ApplicationDatabase | undefined;
	tools: MediaTools;
	inspection: MediaInspectionApplication;
	logger: Logger;
}) {
	return new SubtitleApplication({
		logger,
		sources: library.sources,
		policy: configuration.policy,
		inspection,
		tools,
		dataDir: configuration.deployment.dataDir,
		...(database ? { repository: database.subtitles } : {}),
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
