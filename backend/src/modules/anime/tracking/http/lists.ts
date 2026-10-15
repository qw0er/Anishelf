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
	app.get(
		"/api/tracking/list",
		{
			schema: {
				querystring: TrackingGenerationSchema,
				response: { 200: TrackingListSchema },
			},
		},
		async (request) => lists.list(request.query.generation),
	);
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
					mediaId: Type.String({ pattern: "^[1-9][0-9]{0,9}$" }),
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
					entries.find(
						(item) => item.mediaId === Number(request.params.mediaId),
					) ?? null,
			};
		},
	);
}
