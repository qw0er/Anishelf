import type { Logger } from "pino";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import type { TranscodeProfile } from "../../system/public.js";
import type { MediaProcessingApi } from "../media-processing/public.js";
import { PreparationArtifacts } from "../preparation/application/artifacts.js";
import { PreparationContext } from "../preparation/application/context.js";
import { PreparationApplication } from "../preparation/application/preparation.js";
import { PreparationQueries } from "../preparation/application/queries.js";
import { PreparationRecovery } from "../preparation/application/recovery.js";
import { PreparationScheduler } from "../preparation/application/scheduler.js";
import { PreparationWorker } from "../preparation/application/worker.js";
import { PreparedMediaFiles } from "../preparation/infrastructure/files.js";
import {
	type PreparationPolicy,
	preparationPolicy,
	validatePreparationPolicy,
} from "../preparation/policy.js";
import type {
	PreparationPlanner,
	PreparationStore,
} from "../preparation/ports.js";

export function createPreparationApplication(options: {
	sources: ResourceAccessApi;
	planning: PreparationPlanner;
	processing: MediaProcessingApi;
	repository: PreparationStore;
	profiles: DeepReadonly<TranscodeProfile[]>;
	dataDir: string;
	logger: Logger;
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
	return new PreparationApplication({
		planning: options.planning,
		policy,
		services: system,
	});
}
