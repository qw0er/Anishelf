import { Type } from "typebox";
import {
	TrackingOperationCommandSchema,
	TrackingOperationSchema,
	TrackingOperationsSchema,
	TrackingResolveSchema,
	TrackingUpdateSchema,
} from "../../../../contracts/schemas/tracking-update.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { TrackingUpdatesApi } from "../public.js";
export function registerTrackingUpdateRoutes(
	app: HttpInstance,
	updates: TrackingUpdatesApi,
) {
	const params = Type.Object({ id: Type.String({ format: "uuid" }) });
	app.get(
		"/api/tracking/operations",
		{
			schema: {
				querystring: Type.Object(
					{ generation: Type.String({ format: "uuid" }) },
					{ additionalProperties: false },
				),
				response: { 200: TrackingOperationsSchema },
			},
		},
		async (request) => updates.operations(request.query.generation),
	);
	app.post(
		"/api/tracking/entries/:mediaId/updates",
		{
			schema: {
				params: Type.Object({
					mediaId: Type.String({ pattern: "^[1-9][0-9]{0,9}$" }),
				}),
				body: TrackingUpdateSchema,
				response: { 200: TrackingOperationSchema },
			},
		},
		async (request) =>
			updates.update(Number(request.params.mediaId), request.body),
	);
	app.post(
		"/api/tracking/operations/:id/retry",
		{
			schema: {
				params,
				body: TrackingOperationCommandSchema,
				response: { 200: TrackingOperationSchema },
			},
		},
		async (request) => updates.retryOperation(request.params.id, request.body),
	);
	app.post(
		"/api/tracking/operations/:id/resolve",
		{
			schema: {
				params,
				body: TrackingResolveSchema,
				response: { 200: TrackingOperationSchema },
			},
		},
		async (request) =>
			updates.resolveOperation(
				request.params.id,
				request.body,
				request.body.keepRemote,
			),
	);
}
