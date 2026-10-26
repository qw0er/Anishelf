export type { PlaybackPolicy } from "./progress/policy.js";

import type { Logger } from "pino";
import type { MediaApi } from "../media/public.js";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { registerPlaybackHttp } from "./http.js";
import type { PlaybackPersistence } from "./persistence.js";
import { PlaybackSelectionApplication } from "./playback-selection/application/selection.js";
import { PlaybackApplication } from "./progress/application/playback.js";
import { playbackPolicy, validatePlaybackPolicy } from "./progress/policy.js";
import type { PlaybackApi } from "./public.js";
export function createPlaybackModule(options: {
	system: SystemApi;
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
	const {
		system: configuration,
		resources: library,
		media,
		database,
		logger,
	} = options;
	const playback = new PlaybackApplication({
		completionObserver: options.completionObserver,
		sources: library.sources,
		repository: database.playback,
		logger,
		...(options.policy ? { policy: options.policy } : {}),
	});
	const selection = new PlaybackSelectionApplication({
		sources: library.sources,
		planning: {
			inspect: media.inspectCompatibility.bind(media),
			check: media.checkCompatibility.bind(media),
		},
		copies: {
			list: media.listPlaybackCopies.bind(media),
			get: media.getPlaybackCopy.bind(media),
		},
		selectedProfileId: () =>
			configuration.snapshot.settings.defaultTranscodeProfileId,
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
