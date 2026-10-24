import { Type } from "typebox";
import {
	TrackingEntrySchema,
	TrackingGenerationSchema,
	TrackingListSchema,
} from "../../../../contracts/schemas/tracking-list.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { TrackingListsApi } from "../public.js";
export function registerTrackingListRoutes(
	app: HttpInstance,
	lists: TrackingListsApi,
) {
	app.post(
		"/api/tracking/refresh",
		{
			schema: {
				body: TrackingGenerationSchema,
				response: { 200: TrackingListSchema },
			},
		},
		async (request) => lists.refreshList(request.body.generation),
	);
	app.get(
		"/api/tracking/entries/:mediaId",
		{
			schema: {
				params: Type.Object({
					mediaId: Type.String({ minLength: 1, maxLength: 1024 }),
				}),
				querystring: TrackingGenerationSchema,
				response: { 200: TrackingEntrySchema },
			},
		},
		async (request) => {
			const { entries, ...snapshot } = lists.list(request.query.generation);
			return {
				...snapshot,
				entry:
					entries.find((item) => item.mediaId === request.params.mediaId) ??
					null,
			};
		},
	);
}
