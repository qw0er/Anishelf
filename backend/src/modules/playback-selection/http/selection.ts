import {
	PlaybackOptionsRequestSchema,
	PlaybackOptionsResponseSchema,
	PlaybackSelectionRequestSchema,
	PlaybackSelectionResponseSchema,
} from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import { playbackSelectionResponse } from "../../../transport/presenters/selection.js";
import type { PlaybackSelectionApi } from "../public.js";
export function registerPlaybackSelectionRoutes(
	app: HttpInstance,
	selection: PlaybackSelectionApi,
): void {
	app.post(
		"/api/playback/options",
		{
			schema: {
				body: PlaybackOptionsRequestSchema,
				response: { 200: PlaybackOptionsResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return selection.inspect(request.body);
		},
	);
	app.post(
		"/api/playback/selection",
		{
			schema: {
				body: PlaybackSelectionRequestSchema,
				response: { 200: PlaybackSelectionResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return playbackSelectionResponse(await selection.select(request.body));
		},
	);
}
