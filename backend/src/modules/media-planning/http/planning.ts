import { Type } from "typebox";
import {
	CompatibilityCheckRequestSchema,
	CompatibilityInspectionQuerySchema,
	CompatibilityInspectionSchema,
	CompatibilityResultSchema,
	ResourceIdSchema,
} from "../../../contracts/schemas/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { HttpInstance } from "../../../transport/instance.js";
import { presentCompatibility } from "../../../transport/presenters.js";
import type { MediaPlanningApi } from "../public.js";
export function registerMediaPlanningRoutes(
	app: HttpInstance,
	planning: MediaPlanningApi,
): void {
	const params = Type.Object(
		{ id: ResourceIdSchema },
		{ additionalProperties: false },
	);
	app.get(
		"/api/files/:id/compatibility",
		{
			schema: {
				params,
				querystring: CompatibilityInspectionQuerySchema,
				response: { 200: CompatibilityInspectionSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			const { sourceVersion, profileId, target, audioStreamIndices } =
				request.query;
			if (target && !profileId)
				throw new DomainError(
					"INVALID_REQUEST",
					"A profile ID is required with a delivery target.",
				);
			return planning.inspect({
				fileId: request.params.id,
				...(audioStreamIndices !== undefined
					? {
							audioStreamIndices:
								audioStreamIndices === ""
									? []
									: audioStreamIndices.split(",").map(Number),
						}
					: {}),
				...(sourceVersion ? { sourceVersion } : {}),
				output: profileId ? { profileId, target: target ?? "file" } : null,
			});
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
			return presentCompatibility(
				await planning.check({
					fileId: request.params.id,
					...request.body,
				}),
			);
		},
	);
}
