import type { Logger } from "pino";
import { preparationConstraints } from "../../contracts/defaults.js";
import { PreparationApplication } from "../../modules/media/preparation/application/preparation.js";
import type { LibraryApplication } from "../../modules/resources/library/application/library.js";
import type { ConfigurationService } from "../../modules/system/configuration/application/service.js";
import type { ApplicationDatabase } from "./database.js";

import type { createMediaExecutionModule } from "./media-execution.js";

export function createPreparationModule({
	configuration,
	library,
	database,
	planning,
	processing,
	logger,
}: {
	configuration: ConfigurationService;
	library: LibraryApplication;
	database?: ApplicationDatabase | undefined;
	planning: ReturnType<typeof createMediaExecutionModule>["planning"];
	processing: ReturnType<typeof createMediaExecutionModule>["processing"];
	logger: Logger;
}) {
	return new PreparationApplication({
		sources: library.sources,
		planning,
		processing: processing,
		profiles: configuration.transcodeProfiles,
		dataDir: configuration.deployment.dataDir,
		logger,
		policy: configuration.policy.preparation,
		maximumCacheBytes: () =>
			(configuration.settings.transcodeCacheBudgetGiB ??
				preparationConstraints.defaultCacheBudgetGiB) *
			1024 ** 3,
		...(database ? { repository: database.preparation } : {}),
	});
}

export async function initializePreparationModule(
	preparation: PreparationApplication,
	logger: Logger,
): Promise<void> {
	try {
		await preparation.initialize();
	} catch (error) {
		logger.warn(
			{
				event: "preparation.unavailable",
				errorName: error instanceof Error ? error.name : "unknown",
			},
			"Media preparation is unavailable.",
		);
	}
}
