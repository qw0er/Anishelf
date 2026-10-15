import {
	TrackingConfirmSchema,
	TrackingDisconnectSchema,
	TrackingPreviewRequestSchema,
	TrackingPreviewSchema,
	TrackingStatusSchema,
} from "../../../../contracts/schemas/tracking.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { TrackingApi } from "../public.js";
export function registerTrackingRoutes(
	app: HttpInstance,
	tracking: TrackingApi,
) {
	app.get(
		"/api/tracking/account",
		{ schema: { response: { 200: TrackingStatusSchema } } },
		async () => tracking.status(),
	);
	app.post(
		"/api/tracking/account/preview",
		{
			bodyLimit: 10 * 1024,
			schema: {
				body: TrackingPreviewRequestSchema,
				response: { 200: TrackingPreviewSchema },
			},
		},
		async (request) =>
			tracking.preview(request.session.sessionId, request.body.token),
	);
	app.post(
		"/api/tracking/account/confirm",
		{
			schema: {
				body: TrackingConfirmSchema,
				response: { 200: TrackingStatusSchema },
			},
		},
		async (request) =>
			tracking.confirm(
				request.session.sessionId,
				request.body.candidateId,
				request.body.generation,
			),
	);
	app.delete(
		"/api/tracking/account",
		{
			schema: {
				body: TrackingDisconnectSchema,
				response: { 200: TrackingStatusSchema },
			},
		},
		async (request) => tracking.disconnect(request.body.generation),
	);
	app.post(
		"/api/tracking/account/check",
		{ schema: { response: { 200: TrackingStatusSchema } } },
		async () => tracking.check(),
	);
}
