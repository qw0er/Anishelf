import { Type } from "typebox";
import type { LibraryApplication } from "../application/library.js";
import type { HttpInstance } from "./instance.js";
import {
	ResourceParamsSchema,
	SubtitleContentParamsSchema,
	SubtitleContentQuerySchema,
	SubtitleDiscoveryResponseSchema,
} from "./schemas/index.js";
export function registerSubtitleRoutes(
	app: HttpInstance,
	library: LibraryApplication,
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
			const result = await library.discoverSubtitles(request.params.id);
			reply.header("Cache-Control", "no-store");
			return {
				sourceVersion: result.sourceVersion,
				tracks: result.tracks.map(
					({
						id,
						name,
						format,
						language,
						label,
						sizeBytes,
						sourceVersion,
					}) => ({
						id,
						name,
						format,
						language,
						label,
						sizeBytes,
						sourceVersion,
					}),
				),
				warnings: result.warnings.map(({ name, code }) => ({ name, code })),
			};
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
			const result = await library.getSubtitleContent(
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
