export type { PlaybackPolicy } from "./progress/policy.js";

import type { Logger } from "pino";
import type { MediaApi } from "../media/public.js";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { createPlaybackModule as createProgressModule } from "./composition/playback.js";
import { registerPlaybackHttp } from "./http.js";
import type { PlaybackPersistence } from "./persistence.js";
import { PlaybackSelectionApplication } from "./playback-selection/application/selection.js";
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
	const playback = createProgressModule({
		configuration,
		completionObserver: options.completionObserver,
		library,
		database,
		logger,
		...(options.policy ? { policy: options.policy } : {}),
	});
	const selection = new PlaybackSelectionApplication({
		sources: library.sources,
		planning: {
			inspect: (input) => media.inspectCompatibility(input),
			check: (input) => media.checkCompatibility(input),
		},
		copies: {
			list: (id) => media.listPlaybackCopies(id),
			get: (id) => media.getPlaybackCopy(id),
		},
		selectedProfileId: () =>
			configuration.snapshot.settings.defaultTranscodeProfileId,
	});
	const api: PlaybackApi = {
		open: (id: string) => playback.open(id),
		save: (input: Parameters<typeof playback.save>[0]) => playback.save(input),
		release: (token: string) => playback.release(token),
		history: (limit?: number, view?: "continue" | "recent") =>
			playback.history(limit, view),
		inspect: (input: Parameters<typeof selection.inspect>[0]) =>
			selection.inspect(input),
		select: (input: Parameters<typeof selection.select>[0]) =>
			selection.select(input),
	};
	return {
		api,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerPlaybackHttp(app, playback, selection),
		close: () => playback.close(),
	};
}
