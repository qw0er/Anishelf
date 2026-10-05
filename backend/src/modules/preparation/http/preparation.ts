import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import {
	CompatibilityCheckRequestSchema,
	EmptyObjectSchema,
	PreparationListResponseSchema,
	PreparationStartResponseSchema,
	PreparationTaskParamsSchema,
	PreparationTaskSchema,
	PreparedArtifactParamsSchema,
	ResourceIdSchema,
	ResourceParamsSchema,
} from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import { sendMediaResponse } from "../../../transport/media.js";
import type { PreparationApplication } from "../application/preparation.js";

export function registerPreparationRoutes(
	app: HttpInstance,
	preparation: PreparationApplication,
): void {
	app.register(async (instance) => {
		const scope = instance.withTypeProvider<TypeBoxTypeProvider>();
		scope.addHook("onRequest", async (_request, reply) => {
			reply.header("Cache-Control", "no-store");
		});
		scope.post(
			"/api/files/:id/preparations",
			{
				schema: {
					params: ResourceParamsSchema,
					ResourceIdSchema,
					body: CompatibilityCheckRequestSchema,
					response: { 200: PreparationStartResponseSchema },
				},
			},
			async (request) =>
				preparation.create({ fileId: request.params.id, ...request.body }),
		);
		scope.get(
			"/api/preparations",
			{
				schema: {
					querystring: Type.Object(
						{ fileId: Type.Optional(ResourceIdSchema) },
						{ additionalProperties: false },
					),
					response: { 200: PreparationListResponseSchema },
				},
			},
			async (request) => preparation.list(request.query.fileId),
		);
		scope.get(
			"/api/preparations/:id",
			{
				schema: {
					params: PreparationTaskParamsSchema,
					response: { 200: PreparationTaskSchema },
				},
			},
			async (request) => preparation.get(request.params.id),
		);
		scope.post(
			"/api/preparations/:id/cancel",
			{
				schema: {
					params: PreparationTaskParamsSchema,
					body: EmptyObjectSchema,
					response: { 200: PreparationTaskSchema },
				},
			},
			async (request) => preparation.cancel(request.params.id),
		);
		scope.post(
			"/api/preparations/:id/retry",
			{
				schema: {
					params: PreparationTaskParamsSchema,
					body: CompatibilityCheckRequestSchema,
					response: { 200: PreparationTaskSchema },
				},
			},
			async (request) => preparation.retry(request.params.id, request.body),
		);
		scope.delete(
			"/api/prepared-media/:id",
			{ schema: { params: PreparedArtifactParamsSchema } },
			async (request, reply) => {
				await preparation.deleteArtifact(request.params.id);
				return reply.code(204).send();
			},
		);
		scope.route({
			method: ["GET", "HEAD"],
			url: "/api/prepared-media/:id",
			schema: { params: PreparedArtifactParamsSchema },
			handler: async (request, reply) =>
				sendMediaResponse(
					request,
					reply,
					await preparation.openArtifact(request.params.id),
					request.params.id,
				),
		});
	});
}
