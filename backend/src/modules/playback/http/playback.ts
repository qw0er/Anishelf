import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
	ContinueWatchingQuerySchema,
	ContinueWatchingResponseSchema,
	OpenPlaybackRequestSchema,
	PlaybackSessionResponseSchema,
	PlaybackTokenParamsSchema,
	SavePlaybackProgressRequestSchema,
	SavePlaybackProgressResponseSchema,
} from "../../../contracts/schemas/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { HttpInstance } from "../../../transport/instance.js";
import {
	continueWatchingResponse,
	playbackProgressDto,
	playbackSessionResponse,
} from "../../../transport/presenters.js";
import type { PlaybackApplication } from "../application/playback.js";

export function registerPlaybackRoutes(
	app: HttpInstance,
	playback: PlaybackApplication,
): void {
	app.register(async (instance) => {
		const scope = instance.withTypeProvider<TypeBoxTypeProvider>();
		scope.addHook("onRequest", async (_request, reply) => {
			reply.header("Cache-Control", "no-store");
		});
		scope.post(
			"/api/playback/sessions",
			{
				schema: {
					body: OpenPlaybackRequestSchema,
					response: { 201: PlaybackSessionResponseSchema },
				},
			},
			async (request, reply) =>
				reply
					.code(201)
					.send(
						playbackSessionResponse(await playback.open(request.body.fileId)),
					),
		);
		scope.put(
			"/api/playback/sessions/:token/progress",
			{
				schema: {
					params: PlaybackTokenParamsSchema,
					body: SavePlaybackProgressRequestSchema,
					response: { 200: SavePlaybackProgressResponseSchema },
				},
			},
			async (request) => {
				const result = await playback.save({
					...request.body,
					token: request.params.token,
				});
				if (result.status === "stale")
					throw new DomainError(
						"PLAYBACK_CONFLICT",
						"The progress update is stale.",
					);
				return {
					status: result.status,
					progress: playbackProgressDto(result.progress),
				};
			},
		);
		scope.delete(
			"/api/playback/sessions/:token",
			{ schema: { params: PlaybackTokenParamsSchema } },
			async (request, reply) => {
				playback.release(request.params.token);
				return reply.code(204).send();
			},
		);
		scope.get(
			"/api/history",
			{
				schema: {
					querystring: ContinueWatchingQuerySchema,
					response: { 200: ContinueWatchingResponseSchema },
				},
			},
			async (request) =>
				continueWatchingResponse(
					await playback.history(
						request.query.limit === undefined
							? undefined
							: Number(request.query.limit),
					),
				),
		);
	});
}
