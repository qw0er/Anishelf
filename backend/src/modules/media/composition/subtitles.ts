import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import type { MediaInspectionApplication } from "../media-inspection/application.js";
import type { SubtitleApplication } from "../subtitles/application/subtitles.js";
import { subtitleRuntimePolicy } from "../subtitles/policy.js";
import { createSubtitleApplication } from "./subtitle-application.js";

type LibraryCapability = LibraryApi & { readonly sources: ResourceAccessApi };

import type { MediaTools } from "../../../platform/media/index.js";
import type { SystemApi } from "../../system/public.js";
import type { MediaPersistence } from "../persistence.js";

export function createSubtitleModule({
	configuration,
	library,
	database,
	tools,
	inspection,
	logger,
	policy = subtitleRuntimePolicy,
}: {
	configuration: SystemApi;
	library: LibraryCapability;
	database: MediaPersistence;
	tools: MediaTools;
	inspection: MediaInspectionApplication;
	logger: Logger;
	policy?: import("../../../shared/policy.js").DeepReadonly<
		import("../subtitles/policy.js").SubtitleRuntimePolicy
	>;
}) {
	return createSubtitleApplication({
		logger,
		sources: library.sources,
		policy,
		inspection,
		tools,
		dataDir: configuration.deployment.dataDir,
		repository: database.subtitles,
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
