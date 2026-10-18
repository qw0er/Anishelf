import { Type } from "typebox";
import {
	TrackingEpisodeCommandSchema,
	TrackingEpisodeResolutionSchema,
	TrackingOperationCommandSchema,
	TrackingOperationSchema,
	TrackingOperationsSchema,
	TrackingResolveSchema,
	TrackingUpdateSchema,
} from "../../../../contracts/schemas/tracking-update.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { TrackingUpdatesApi, TrackingViewingApi } from "../public.js";
export function registerTrackingUpdateRoutes(
	app: HttpInstance,
	updates: TrackingUpdatesApi,
	viewing?: TrackingViewingApi,
) {
	if (viewing) {
		app.get(
			"/api/tracking/episode-target",
			{
				schema: {
					querystring: Type.Object(
						{
							fileId: Type.String({ minLength: 1 }),
							sourceVersion: Type.String({ minLength: 1 }),
						},
						{ additionalProperties: false },
					),
					response: {
						200: TrackingEpisodeResolutionSchema,
					},
				},
			},
			async (request) =>
				viewing.resolveTarget(
					request.query.fileId,
					request.query.sourceVersion,
				),
		);
		app.post(
			"/api/tracking/episode-commands",
			{
				schema: {
					body: TrackingEpisodeCommandSchema,
					response: { 200: TrackingOperationSchema },
				},
			},
			async (request) => viewing.mark(request.body),
		);
	}
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
					mediaId: Type.String({ minLength: 1, maxLength: 1024 }),
				}),
				body: TrackingUpdateSchema,
				response: { 200: TrackingOperationSchema },
			},
		},
		async (request) => updates.update(request.params.mediaId, request.body),
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
