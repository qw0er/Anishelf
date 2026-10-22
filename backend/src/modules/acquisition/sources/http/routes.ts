import {
	SourceGenerationSchema,
	SourceIndexersSchema,
	SourceProbeInputSchema,
	SourceProbeSchema,
	SourceSearchInputSchema,
	SourceSearchSchema,
	SourceSettingsSchema,
	SourceUpdateSchema,
} from "../../../../contracts/schemas/sources.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { SourceConnectionApi } from "../public.js";

export function registerSourceRoutes(
	app: HttpInstance,
	sources: SourceConnectionApi,
) {
	const path = "/api/acquisition/sources/jackett";
	app.get(
		path,
		{ schema: { response: { 200: SourceSettingsSchema } } },
		async (_request, reply) => {
			reply.header("Cache-Control", "no-store");
			return sources.settings();
		},
	);
	app.put(
		path,
		{
			bodyLimit: 16 * 1024,
			schema: {
				body: SourceUpdateSchema,
				response: { 200: SourceSettingsSchema },
			},
		},
		async (request) => sources.save(request.body),
	);
	app.delete(
		path,
		{
			schema: {
				body: SourceGenerationSchema,
				response: { 200: SourceSettingsSchema },
			},
		},
		async (request) => sources.clear(request.body.generation),
	);
	app.post(
		`${path}/indexers`,
		{
			schema: {
				body: SourceGenerationSchema,
				response: { 200: SourceIndexersSchema },
			},
		},
		async (request) => sources.indexers(request.body.generation),
	);
	app.post(
		`${path}/probe`,
		{
			schema: {
				body: SourceProbeInputSchema,
				response: { 200: SourceProbeSchema },
			},
		},
		async (request) =>
			sources.probe(request.body.generation, request.body.indexerId),
	);
	app.post(
		`${path}/search`,
		{
			schema: {
				body: SourceSearchInputSchema,
				response: { 200: SourceSearchSchema },
			},
		},
		async (request) => sources.search(request.body),
	);
}
