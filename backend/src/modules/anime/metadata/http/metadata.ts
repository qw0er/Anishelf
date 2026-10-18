import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import {
	MetadataAiringResponseSchema,
	MetadataArtworkResponseSchema,
	MetadataDetailsResponseSchema,
	MetadataPageQuerySchema,
	MetadataReadQuerySchema,
	MetadataReferenceParamsSchema,
	MetadataReferenceSchema,
	MetadataRelationsResponseSchema,
	MetadataSearchQuerySchema,
	MetadataSearchResponseSchema,
} from "../../../../contracts/schemas/metadata.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { MetadataApi, ProviderReference } from "../public.js";

const reference = (params: {
	provider: string;
	id: string;
}): ProviderReference => ({
	provider: params.provider,
	mediaType: "anime",
	id: params.id,
});
async function withSignal<T>(
	request: FastifyRequest,
	reply: FastifyReply,
	operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	const closed = () => {
		if (!reply.raw.writableEnded) abort();
	};
	request.raw.once("aborted", abort);
	reply.raw.once("close", closed);
	if (request.raw.aborted) abort();
	try {
		return await operation(controller.signal);
	} finally {
		request.raw.off("aborted", abort);
		reply.raw.off("close", closed);
	}
}
export function registerMetadataRoutes(
	app: HttpInstance,
	metadata: MetadataApi,
): void {
	app.get("/api/metadata/providers", async () => metadata.providers());
	app.get(
		"/api/metadata/reference",
		{
			schema: {
				querystring: Type.Object(
					{
						value: Type.String({ minLength: 1, maxLength: 2000 }),
						provider: Type.Optional(Type.String({ minLength: 1 })),
					},
					{ additionalProperties: false },
				),
				response: { 200: MetadataReferenceSchema },
			},
		},
		async (request) =>
			metadata.resolveReference(request.query.value, request.query.provider),
	);
	app.get(
		"/api/metadata/search",
		{
			schema: {
				querystring: MetadataSearchQuerySchema,
				response: { 200: MetadataSearchResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return withSignal(request, reply, (signal) =>
				metadata.search(
					{
						query: request.query.query,
						...(request.query.provider
							? { provider: request.query.provider }
							: {}),
						page: Number(request.query.page ?? 1),
						perPage: Number(request.query.perPage ?? 10),
					},
					{ signal, cachedOnly: request.query.cachedOnly === "true" },
				),
			);
		},
	);
	app.get(
		"/api/metadata/:provider/:id",
		{
			schema: {
				params: MetadataReferenceParamsSchema,
				querystring: MetadataReadQuerySchema,
				response: { 200: MetadataDetailsResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return withSignal(request, reply, (signal) =>
				metadata.get(reference(request.params), {
					signal,
					cachedOnly: request.query.cachedOnly === "true",
				}),
			);
		},
	);
	app.post(
		"/api/metadata/:provider/:id/refresh",
		{
			schema: {
				params: MetadataReferenceParamsSchema,
				response: { 200: MetadataDetailsResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return withSignal(request, reply, (signal) =>
				metadata.get(reference(request.params), { signal, refresh: true }),
			);
		},
	);
	app.get(
		"/api/metadata/:provider/:id/relations",
		{
			schema: {
				params: MetadataReferenceParamsSchema,
				querystring: MetadataPageQuerySchema,
				response: { 200: MetadataRelationsResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return withSignal(request, reply, (signal) =>
				metadata.relations(
					reference(request.params),
					Number(request.query.page ?? 1),
					Number(request.query.perPage ?? 25),
					{ signal, cachedOnly: request.query.cachedOnly === "true" },
				),
			);
		},
	);
	app.get(
		"/api/metadata/:provider/:id/airing",
		{
			schema: {
				params: MetadataReferenceParamsSchema,
				querystring: MetadataPageQuerySchema,
				response: { 200: MetadataAiringResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return withSignal(request, reply, (signal) =>
				metadata.airing(
					reference(request.params),
					Number(request.query.page ?? 1),
					Number(request.query.perPage ?? 25),
					{ signal, cachedOnly: request.query.cachedOnly === "true" },
				),
			);
		},
	);
	app.get(
		"/api/metadata/:provider/:id/artwork/:kind",
		{
			schema: {
				params: Type.Object({
					...MetadataReferenceParamsSchema.properties,
					kind: Type.Union([Type.Literal("cover"), Type.Literal("banner")]),
				}),
				querystring: MetadataReadQuerySchema,
				response: { 200: MetadataArtworkResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return withSignal(request, reply, (signal) =>
				metadata.artwork(reference(request.params), request.params.kind, {
					signal,
					cachedOnly: request.query.cachedOnly === "true",
				}),
			);
		},
	);
	app.get(
		"/api/metadata/artwork/:id",
		{
			schema: {
				params: Type.Object({ id: Type.String({ pattern: "^[a-f0-9]{64}$" }) }),
			},
		},
		async (request, reply) => {
			const asset = await metadata.readArtwork(request.params.id);
			reply
				.header("Cache-Control", "private, max-age=3600")
				.header("X-Content-Type-Options", "nosniff");
			return reply.type(asset.mimeType).send(Buffer.from(asset.bytes));
		},
	);
}
