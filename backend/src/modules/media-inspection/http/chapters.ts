import {
	ChapterQuerySchema,
	ChaptersResponseSchema,
	ResourceParamsSchema,
} from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import type { MediaInspectionApplication } from "../application/inspection.js";

export function registerChapterRoutes(
	app: HttpInstance,
	inspection: MediaInspectionApplication,
): void {
	app.get(
		"/api/files/:id/chapters",
		{
			schema: {
				params: ResourceParamsSchema,
				querystring: ChapterQuerySchema,
				response: { 200: ChaptersResponseSchema },
			},
		},
		async (request, reply) => {
			const result = await inspection.chapters(
				request.params.id,
				request.query.sourceVersion,
			);
			reply.header("Cache-Control", "no-store");
			return result;
		},
	);
}
