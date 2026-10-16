import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import { PlaybackApplication } from "../progress/application/playback.js";
import { playbackPolicy } from "../progress/policy.js";

type LibraryCapability = LibraryApi & { readonly sources: ResourceAccessApi };

import type { SystemApi } from "../../system/public.js";
import type { PlaybackPersistence } from "../persistence.js";

export function createPlaybackModule({
	library,
	database,
	logger,
	policy = playbackPolicy,
	completionObserver,
	sourceDuration,
}: {
	configuration: SystemApi;
	sourceDuration?:
		| ((fileId: string, sourceVersion: string) => Promise<number | null>)
		| undefined;
	library: LibraryCapability;
	database?: PlaybackPersistence | undefined;
	logger: Logger;
	completionObserver?:
		| import("../progress/domain/completion.js").PlaybackCompletionObserver
		| undefined;
	policy?: import("../../../shared/policy.js").DeepReadonly<
		import("../progress/policy.js").PlaybackPolicy
	>;
}) {
	return new PlaybackApplication({
		policy,
		completionObserver,
		sourceDuration,
		sources: library.sources,
		logger,
		...(database ? { repository: database.playback } : {}),
	});
}
