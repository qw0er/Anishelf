import type { Logger } from "pino";
import { PlaybackApplication } from "../../modules/playback/playback/application/playback.js";
import type { LibraryApplication } from "../../modules/resources/library/application/library.js";
import type { ConfigurationService } from "../../modules/system/configuration/application/service.js";
import type { ApplicationDatabase } from "./database.js";

export function createPlaybackModule({
	configuration,
	library,
	database,
	logger,
}: {
	configuration: ConfigurationService;
	library: LibraryApplication;
	database?: ApplicationDatabase | undefined;
	logger: Logger;
}) {
	return new PlaybackApplication({
		policy: configuration.policy.playback,
		sources: library.sources,
		logger,
		...(database ? { repository: database.playback } : {}),
	});
}
