import { Type } from "typebox";
import {
	AcquisitionProfileCatalogSchema,
	SubscriptionCommandSchema,
	SubscriptionSaveSchema,
	SubscriptionSearchInputSchema,
	SubscriptionSearchResultSchema,
	SubscriptionToggleSchema,
	SubscriptionViewSchema,
} from "../../../../contracts/schemas/subscriptions.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { SubscriptionApi } from "../../public.js";

export function registerSubscriptionRoutes(
	app: HttpInstance,
	subscriptions: SubscriptionApi,
) {
	const path = "/api/acquisition/subscriptions";
	app.get(
		"/api/acquisition/profiles",
		{ schema: { response: { 200: AcquisitionProfileCatalogSchema } } },
		async () => subscriptions.profiles(),
	);
	app.get(
		path,
		{
			schema: {
				querystring: Type.Object({
					workKey: Type.String({ minLength: 1, maxLength: 1024 }),
					diagnostics: Type.Optional(Type.String({ enum: ["true", "false"] })),
					page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,3}$" })),
				}),
				response: { 200: SubscriptionViewSchema },
			},
		},
		async (request) =>
			subscriptions.get(
				request.query.workKey,
				Number(request.query.page ?? 1),
				request.query.diagnostics !== "false",
			),
	);
	app.post(
		`${path}/search`,
		{
			schema: {
				body: SubscriptionSearchInputSchema,
				response: { 200: SubscriptionSearchResultSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return subscriptions.search(request.body);
		},
	);
	app.put(
		path,
		{
			schema: {
				body: SubscriptionSaveSchema,
				response: { 200: SubscriptionViewSchema },
			},
		},
		(request) => subscriptions.save(request.body),
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
			subscriptions.setEnabled(
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
			subscriptions.refresh(request.body.workKey, request.body.revision),
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
			await subscriptions.remove(request.body.workKey, request.body.revision);
			return { removed: true as const };
		},
	);
}
