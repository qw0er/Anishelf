import type { Logger } from "pino";
import type { ExecutableSearch } from "../../platform/environment.js";
import type { MediaToolsConfig } from "../../platform/media/config.js";
import { MediaTools } from "../../platform/media/index.js";

export async function initializeMediaTools(
	config: MediaToolsConfig,
	logger: Logger,
	environment: ExecutableSearch,
): Promise<MediaTools> {
	const mediaTools = await MediaTools.create(
		config,
		undefined,
		environment,
		logger,
	);
	for (const [tool, status] of Object.entries(mediaTools.status)) {
		if (status.available) {
			logger.info(
				{ event: "media.tool_ready", tool, ...status },
				"Media tool ready.",
			);
		} else {
			logger.warn({ event: "media.tool_unavailable", tool }, status.message);
		}
	}
	return mediaTools;
}
