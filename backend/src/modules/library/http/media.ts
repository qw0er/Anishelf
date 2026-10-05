import {
	FileResponseSchema,
	ResourceParamsSchema,
} from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import { sendMediaResponse } from "../../../transport/media.js";
import { fileDto } from "../../../transport/presenters.js";
import type { LibraryApplication } from "../application/library.js";

export function registerMediaRoutes(
	app: HttpInstance,
	library: LibraryApplication,
): void {
	app.get(
		"/api/files/:id",
		{
			schema: {
				params: ResourceParamsSchema,
				response: { 200: FileResponseSchema },
			},
		},
		async (request, reply) => {
			const file = await library.getFile(request.params.id);
			reply.header("Cache-Control", "no-store");
			return {
				file: fileDto(file),
				playbackUrl: `/api/media/${encodeURIComponent(file.id)}`,
			};
		},
	);
	app.route({
		method: ["GET", "HEAD"],
		url: "/api/media/:id",
		schema: { params: ResourceParamsSchema },
		handler: async (request, reply) =>
			sendMediaResponse(
				request,
				reply,
				await library.openMedia(request.params.id),
				request.params.id,
			),
	});
}
