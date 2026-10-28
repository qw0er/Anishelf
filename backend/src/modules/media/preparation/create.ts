import type { Logger } from "pino";
import type { MediaInfo } from "../../../platform/media/model.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import type { TranscodeProfile } from "../../system/public.js";
import type { MediaProcessingApi } from "../media-processing/public.js";
import { PreparationArtifacts } from "./application/artifacts.js";
import { PreparationContext } from "./application/context.js";
import { PreparationApplication } from "./application/preparation.js";
import { PreparationQueries } from "./application/queries.js";
import { PreparationRecovery } from "./application/recovery.js";
import { PreparationScheduler } from "./application/scheduler.js";
import { PreparationWorker } from "./application/worker.js";
import { PreparedMediaFiles } from "./infrastructure/files.js";
import {
	type PreparationPolicy,
	preparationPolicy,
	validatePreparationPolicy,
} from "./policy.js";
import type { PreparationPlanner, PreparationStore } from "./ports.js";

export function createPreparationApplication(options: {
	sources: ResourceAccessApi;
	planning: PreparationPlanner;
	processing: MediaProcessingApi;
	repository: PreparationStore;
	profiles: DeepReadonly<TranscodeProfile[]>;
	dataDir: string;
	logger: Logger;
	probe: (path: string) => Promise<MediaInfo>;
	policy?: DeepReadonly<PreparationPolicy>;
	maximumCacheBytes?: () => number;
}): PreparationApplication {
	const policy = freeze(structuredClone(options.policy ?? preparationPolicy));
	validatePreparationPolicy(policy);
	function services() {
		const context = new PreparationContext(
			options.repository,
			options.sources,
			options.processing,
			new PreparedMediaFiles(options.dataDir),
			options.profiles,
			policy,
			options.logger,
			options.probe,
			options.maximumCacheBytes,
		);

		const artifacts = new PreparationArtifacts(context);
		const scheduler = new PreparationScheduler(
			context,
			new PreparationWorker(context, artifacts),
		);
		const queries = new PreparationQueries({ context, artifacts });
		return {
			context,
			artifacts,
			scheduler,
			queries,
			recover: () => new PreparationRecovery(context, artifacts).run(),
		};
	}
	const system = services();
	options.logger.debug(
		{ event: "preparation.services_configured" },
		"Media preparation scheduler, queries and artifact services configured.",
	);
	return new PreparationApplication({
		planning: options.planning,
		policy,
		services: system,
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
