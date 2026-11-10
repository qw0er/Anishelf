import { Type } from "typebox";
import {
	ResourceParamsSchema,
	SubtitleContentParamsSchema,
	SubtitleContentQuerySchema,
	SubtitleDiscoveryResponseSchema,
} from "../../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { SubtitleApplication } from "../application/subtitles.js";
import { subtitleDiscoveryResponse } from "./presenters.js";
export function registerSubtitleRoutes(
	app: HttpInstance,
	subtitles: SubtitleApplication,
): void {
	app.get(
		"/api/files/:id/subtitles",
		{
			schema: {
				params: ResourceParamsSchema,
				response: { 200: SubtitleDiscoveryResponseSchema },
			},
		},
		async (request, reply) => {
			const result = await subtitles.discoverSubtitles(request.params.id);
			reply.header("Cache-Control", "no-store");
			return subtitleDiscoveryResponse(result);
		},
	);
	app.get(
		"/api/files/:id/subtitles/:trackId/content",
		{
			schema: {
				params: SubtitleContentParamsSchema,
				querystring: SubtitleContentQuerySchema,
				response: { 200: Type.String() },
			},
		},
		async (request, reply) => {
			const result = await subtitles.getSubtitleContent(
				request.params.id,
				request.params.trackId,
				request.query.sourceVersion,
				request.query.subtitleVersion,
			);
			reply.header("Cache-Control", "no-store");
			reply.header("X-Content-Type-Options", "nosniff");
			reply.type("text/plain; charset=utf-8");
			return result.text;
		},
	);
}
