import { compatibilityView } from "./views.js";

export type { MediaInspectionPolicy } from "./media-inspection/policy.js";
export {
	mediaInspectionPolicy,
	validateMediaInspectionPolicy,
} from "./media-inspection/policy.js";
export type { MediaProcessingPolicy } from "./media-processing/policy.js";
export {
	mediaProcessingPolicy,
	validateMediaProcessingPolicy,
} from "./media-processing/policy.js";
export type { PreparationPolicy } from "./preparation/policy.js";
export {
	preparationPolicy,
	validatePreparationPolicy,
} from "./preparation/policy.js";
export type { SubtitlePolicy } from "./subtitles/policy.js";
export { subtitlePolicy, validateSubtitlePolicy } from "./subtitles/policy.js";

import type { Logger } from "pino";
import type { MediaTools } from "../../platform/media/index.js";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { createMediaExecutionModule } from "./composition/media-execution.js";
import { createPlaybackCopies } from "./composition/playback-selection.js";
import {
	createPreparationModule,
	initializePreparationModule,
} from "./composition/preparation.js";
import {
	createSubtitleModule,
	initializeSubtitleModule,
} from "./composition/subtitles.js";
import { registerMediaHttp } from "./http.js";
import { MediaInspectionApplication } from "./media-inspection/application.js";
import { mediaInspectionPolicy } from "./media-inspection/policy.js";
import type { MediaPersistence } from "./persistence.js";
import type { MediaApi } from "./public.js";
export interface MediaModulePolicy {
	mediaInspection: import("./media-inspection/policy.js").MediaInspectionPolicy;
	mediaProcessing: import("./media-processing/policy.js").MediaProcessingPolicy;
	preparation: import("./preparation/policy.js").PreparationPolicy;
	subtitles: import("./subtitles/policy.js").SubtitlePolicy;
	library: import("../../shared/sorting.js").SortingPolicy;
	mediaTools: import("../../platform/media/policy.js").MediaToolPolicy;
}
export async function createMediaModule(options: {
	system: SystemApi;
	resources: ResourcesApi;
	database?: MediaPersistence | undefined;
	tools: MediaTools;
	logger: Logger;
	policy?: import("../../shared/policy.js").DeepReadonly<MediaModulePolicy>;
}) {
	const {
		system: configuration,
		resources: library,
		database,
		tools,
		logger,
	} = options;
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools,
		logger,
		policy: options.policy?.mediaInspection ?? mediaInspectionPolicy,
	});
	const execution = createMediaExecutionModule({
		configuration,
		sources: library.sources,
		inspection,
		tools,
		logger,
		...(options.policy
			? {
					toolPolicy: options.policy.mediaTools,
					processingPolicy: options.policy.mediaProcessing,
				}
			: {}),
	});
	const preparation = createPreparationModule({
		configuration,
		library,
		database,
		planning: execution.planning,
		processing: execution.processing,
		logger,
		...(options.policy ? { policy: options.policy.preparation } : {}),
	});
	const subtitles = createSubtitleModule({
		configuration,
		library,
		database,
		tools,
		inspection,
		logger,
		...(options.policy
			? {
					policy: {
						subtitles: options.policy.subtitles,
						library: options.policy.library,
					},
				}
			: {}),
	});
	await initializePreparationModule(preparation, logger);
	await initializeSubtitleModule(subtitles, logger);
	const copies = createPlaybackCopies(preparation);
	const api: MediaApi = {
		inspectCompatibility: (input) => execution.planning.inspect(input),
		checkCompatibility: async (input) =>
			compatibilityView(await execution.planning.check(input)),
		listPlaybackCopies: (id) => copies.list(id),
		getPlaybackCopy: (id) => copies.get(id),
	};
	let stopped: Promise<void> | undefined;
	let closed: Promise<void> | undefined;
	const quiesce = () => (stopped ??= preparation.close());
	return {
		api,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerMediaHttp(app, {
				inspection,
				planning: execution.planning,
				preparation,
				subtitles,
			}),
		quiesce,
		close: () =>
			(closed ??= (async () => {
				await quiesce();
				await subtitles.close();
				await execution.close();
				await inspection.close();
			})()),
	};
}
