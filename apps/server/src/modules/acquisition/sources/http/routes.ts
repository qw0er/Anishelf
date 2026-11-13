import {
	SourceBundledInputSchema,
	SourceGenerationSchema,
	SourceProbeInputSchema,
	SourceProbeSchema,
	SourceProvidersSchema,
	SourceSettingsSchema,
	SourceTestInputSchema,
	SourceTestSchema,
	SourceUpdateSchema,
} from "../../../../contracts/schemas/sources.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { SourcesApi } from "../public.js";

/** Source setup is distinct from protocol-neutral collection/content consumers. */
export function registerSourceRoutes(app: HttpInstance, sources: SourcesApi) {
	const path = "/api/acquisition/sources";
	app.post(
		`${path}/test`,
		{
			bodyLimit: 16 * 1024,
			schema: {
				body: SourceTestInputSchema,
				response: { 200: SourceTestSchema },
			},
		},
		(request) =>
			sources.test(
				"sourceId" in request.body ? request.body.sourceId : request.body,
			),
	);
	const connector = `${path}/connector`;
	app.get(
		connector,
		{ schema: { response: { 200: SourceSettingsSchema } } },
		async (_request, reply) => {
			reply.header("Cache-Control", "no-store");
			return sources.connector.settings();
		},
	);
	app.post(
		`${path}/connector/bundled`,
		{
			schema: {
				body: SourceBundledInputSchema,
				response: { 200: SourceSettingsSchema },
			},
		},
		(request) =>
			sources.connector.useBundled(
				request.body.generation,
				request.body.initializeSite,
			),
	);
	app.put(
		connector,
		{
			bodyLimit: 16 * 1024,
			schema: {
				body: SourceUpdateSchema,
				response: { 200: SourceSettingsSchema },
			},
		},
		(request) => sources.connector.save(request.body),
	);
	app.delete(
		connector,
		{
			schema: {
				body: SourceGenerationSchema,
				response: { 200: SourceSettingsSchema },
			},
		},
		(request) => sources.connector.clear(request.body.generation),
	);
	app.post(
		`${connector}/providers`,
		{
			schema: {
				body: SourceGenerationSchema,
				response: { 200: SourceProvidersSchema },
			},
		},
		(request) => sources.connector.providers(request.body.generation),
	);
	app.post(
		`${connector}/probe`,
		{
			schema: {
				body: SourceProbeInputSchema,
				response: { 200: SourceProbeSchema },
			},
		},
		(request) =>
			sources.connector.probe(request.body.generation, request.body.providerId),
	);
}
