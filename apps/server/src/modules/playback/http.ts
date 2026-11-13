import type { HttpInstance } from "../../transport/instance.js";
import { registerPlaybackSelectionRoutes } from "./playback-selection/http/selection.js";
import type { PlaybackSelectionApi } from "./playback-selection/public.js";
import type { PlaybackApplication } from "./progress/application/playback.js";
import { registerPlaybackRoutes } from "./progress/http/playback.js";
export function registerPlaybackHttp(
	app: HttpInstance,
	playback: PlaybackApplication,
	selection: PlaybackSelectionApi,
): void {
	registerPlaybackRoutes(app, playback);
	registerPlaybackSelectionRoutes(app, selection);
}
