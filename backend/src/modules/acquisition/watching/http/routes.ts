import {
	WatchingConfirmSchema,
	WatchingDisableSchema,
	WatchingOverrideSchema,
	WatchingPreviewInputSchema,
	WatchingPreviewSchema,
	WatchingStatusSchema,
} from "../../../../contracts/schemas/watching.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { WatchingApi } from "../public.js";
export function registerWatchingRoutes(app: HttpInstance, api: WatchingApi) {
	const path = "/api/acquisition/watching";
	app.get(
		path,
		{ schema: { response: { 200: WatchingStatusSchema } } },
		async (_request, reply) => {
			reply.header("Cache-Control", "no-store");
			return api.status();
		},
	);
	app.post(
		`${path}/preview`,
		{
			schema: {
				body: WatchingPreviewInputSchema,
				response: { 200: WatchingPreviewSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return api.preview(
				request.session.sessionId,
				request.body.revision,
				request.body.config,
			);
		},
	);
	app.post(
		`${path}/confirm`,
		{
			schema: {
				body: WatchingConfirmSchema,
				response: { 200: WatchingStatusSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return api.confirm(request.session.sessionId, request.body.id);
		},
	);
	app.post(
		`${path}/disable`,
		{
			schema: {
				body: WatchingDisableSchema,
				response: { 200: WatchingStatusSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return api.disable(request.body.revision);
		},
	);
	app.put(
		`${path}/works`,
		{
			schema: {
				body: WatchingOverrideSchema,
				response: { 200: WatchingStatusSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return api.override(request.body);
		},
	);
}
