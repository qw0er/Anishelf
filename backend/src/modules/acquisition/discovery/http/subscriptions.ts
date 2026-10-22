import { Type } from "typebox";
import {
	AcquisitionProfileCatalogSchema,
	SubscriptionCommandSchema,
	SubscriptionConfirmSchema,
	SubscriptionPreviewInputSchema,
	SubscriptionPreviewSchema,
	SubscriptionToggleSchema,
	SubscriptionViewSchema,
} from "../../../../contracts/schemas/subscriptions.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { SubscriptionApi } from "../../public.js";

export function registerSubscriptionRoutes(
	app: HttpInstance,
	discovery: SubscriptionApi,
) {
	const path = "/api/acquisition/subscriptions";
	app.get(
		"/api/acquisition/profiles",
		{ schema: { response: { 200: AcquisitionProfileCatalogSchema } } },
		async () => discovery.profiles(),
	);
	app.get(
		path,
		{
			schema: {
				querystring: Type.Object({
					workKey: Type.String({ minLength: 1, maxLength: 1024 }),
					page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,3}$" })),
				}),
				response: { 200: SubscriptionViewSchema },
			},
		},
		async (request) =>
			discovery.get(request.query.workKey, Number(request.query.page ?? 1)),
	);
	app.post(
		`${path}/preview`,
		{
			schema: {
				body: SubscriptionPreviewInputSchema,
				response: { 200: SubscriptionPreviewSchema },
			},
		},
		async (request) =>
			discovery.preview(request.session.sessionId, request.body),
	);
	app.post(
		`${path}/confirm`,
		{
			schema: {
				body: SubscriptionConfirmSchema,
				response: { 200: SubscriptionViewSchema },
			},
		},
		async (request) =>
			discovery.confirm(
				request.session.sessionId,
				request.body.workKey,
				request.body.token,
			),
	);
	app.patch(
		path,
		{
			schema: {
				body: SubscriptionToggleSchema,
				response: { 200: SubscriptionViewSchema },
			},
		},
		async (request) =>
			discovery.setEnabled(
				request.body.workKey,
				request.body.revision,
				request.body.enabled,
			),
	);
	app.post(
		`${path}/refresh`,
		{
			schema: {
				body: SubscriptionCommandSchema,
				response: { 200: SubscriptionViewSchema },
			},
		},
		async (request) =>
			discovery.refresh(request.body.workKey, request.body.revision),
	);
	app.delete(
		path,
		{
			schema: {
				body: SubscriptionCommandSchema,
				response: { 200: Type.Object({ removed: Type.Literal(true) }) },
			},
		},
		async (request) => {
			await discovery.remove(request.body.workKey, request.body.revision);
			return { removed: true as const };
		},
	);
}
