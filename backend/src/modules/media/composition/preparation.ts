import type { Logger } from "pino";
import { preparationConstraints } from "../../../contracts/defaults.js";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import type { PreparationApplication } from "../preparation/application/preparation.js";
import { preparationPolicy } from "../preparation/policy.js";
import { createPreparationApplication } from "./preparation-application.js";

type LibraryCapability = LibraryApi & { readonly sources: ResourceAccessApi };

import type { SystemApi } from "../../system/public.js";
import type { MediaPersistence } from "../persistence.js";

import type { createMediaExecutionModule } from "./media-execution.js";

export function createPreparationModule({
	configuration,
	library,
	database,
	planning,
	processing,
	logger,
	policy = preparationPolicy,
}: {
	configuration: SystemApi;
	library: LibraryCapability;
	database?: MediaPersistence | undefined;
	planning: ReturnType<typeof createMediaExecutionModule>["planning"];
	processing: ReturnType<typeof createMediaExecutionModule>["processing"];
	logger: Logger;
	policy?: import("../../../shared/policy.js").DeepReadonly<
		import("../preparation/policy.js").PreparationPolicy
	>;
}) {
	return createPreparationApplication({
		sources: library.sources,
		planning,
		processing: processing,
		profiles: configuration.transcodeProfiles,
		dataDir: configuration.deployment.dataDir,
		logger,
		policy,
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
