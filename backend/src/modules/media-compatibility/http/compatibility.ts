import { Type } from "typebox";
import {
	CompatibilityCheckRequestSchema,
	CompatibilityInspectionSchema,
	CompatibilityResultSchema,
	ResourceIdSchema,
} from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import type { MediaCompatibilityApplication } from "../application/compatibility.js";
export function registerCompatibilityRoutes(
	app: HttpInstance,
	compatibility: MediaCompatibilityApplication,
): void {
	const params = Type.Object(
		{ id: ResourceIdSchema },
		{ additionalProperties: false },
	);
	app.get(
		"/api/files/:id/compatibility",
		{ schema: { params, response: { 200: CompatibilityInspectionSchema } } },
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return compatibility.inspect(request.params.id);
		},
	);
	app.post(
		"/api/files/:id/compatibility",
		{
			schema: {
				params,
				body: CompatibilityCheckRequestSchema,
				response: { 200: CompatibilityResultSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return compatibility.check(request.params.id, request.body);
		},
	);
}
