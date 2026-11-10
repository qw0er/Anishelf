export type { PlaybackPolicy } from "./progress/policy.js";

import type { Logger } from "pino";
import type { MediaApi } from "../media/public.js";
import type { ResourcesApi } from "../resources/public.js";
import { registerPlaybackHttp } from "./http.js";
import type { PlaybackPersistence } from "./persistence.js";
import { PlaybackSelectionApplication } from "./playback-selection/application/selection.js";
import { PlaybackApplication } from "./progress/application/playback.js";
import { playbackPolicy, validatePlaybackPolicy } from "./progress/policy.js";
import type { PlaybackApi } from "./public.js";
export function createPlaybackModule(options: {
	resources: ResourcesApi;
	media: MediaApi;
	database: PlaybackPersistence;
	logger: Logger;
	completionObserver?:
		| import("./progress/domain/completion.js").PlaybackCompletionObserver
		| undefined;
	policy?: import("../../shared/policy.js").DeepReadonly<
		import("./progress/policy.js").PlaybackPolicy
	>;
}) {
	validatePlaybackPolicy(options.policy ?? playbackPolicy);
	options.logger.debug(
		{
			event: "playback.policy_resolved",
			overridden: options.policy !== undefined,
		},
		"Playback policy validated.",
	);
	const { resources: library, media, database, logger } = options;
	const playback = new PlaybackApplication({
		completionObserver: options.completionObserver,
		sources: library.sources,
		repository: database.playback,
		logger,
		...(options.policy ? { policy: options.policy } : {}),
	});
	const selection = new PlaybackSelectionApplication({
		assets: { list: media.listPlaybackAssets.bind(media) },
		logger,
	});
	const api: PlaybackApi = {
		open: playback.open.bind(playback),
		save: playback.save.bind(playback),
		release: playback.release.bind(playback),
		history: playback.history.bind(playback),
		inspect: selection.inspect.bind(selection),
		select: selection.select.bind(selection),
	};
	return {
		api,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerPlaybackHttp(app, playback, selection),
		close: playback.close.bind(playback),
	};
}
