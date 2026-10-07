import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import {
	CompatibilityCheckRequestSchema,
	EmptyObjectSchema,
	PreparationListResponseSchema,
	PreparationStartResponseSchema,
	PreparationSummaryRequestSchema,
	PreparationSummaryResponseSchema,
	PreparationTaskParamsSchema,
	PreparationTaskSchema,
	PreparedArtifactParamsSchema,
	ResourceIdSchema,
	ResourceParamsSchema,
} from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import { sendMediaResponse } from "../../../transport/media.js";
import {
	preparationStartResponse,
	preparationTaskResponse,
} from "../../../transport/presenters/preparation.js";
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
				preparationStartResponse(
					await preparation.create({
						fileId: request.params.id,
						...request.body,
					}),
				),
		);
		scope.post(
			"/api/preparations/summaries",
			{
				schema: {
					body: PreparationSummaryRequestSchema,
					response: { 200: PreparationSummaryResponseSchema },
				},
			},
			(request) => preparation.summaries(request.body.fileIds),
		);

		scope.get(
			"/api/preparations",
			{
				schema: {
					querystring: Type.Object(
						{
							fileId: Type.Optional(ResourceIdSchema),
							summary: Type.Optional(Type.Literal("true")),
							more: Type.Optional(Type.Literal("true")),
						},
						{ additionalProperties: false },
					),
					response: { 200: PreparationListResponseSchema },
				},
			},
			async (request) => ({
				tasks: (
					await preparation.list(
						request.query.fileId,
						request.query.summary === "true",
						request.query.more === "true",
					)
				).tasks.map(preparationTaskResponse),
			}),
		);
		scope.get(
			"/api/preparations/:id",
			{
				schema: {
					params: PreparationTaskParamsSchema,
					response: { 200: PreparationTaskSchema },
				},
			},
			async (request) =>
				preparationTaskResponse(await preparation.get(request.params.id)),
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
			async (request) =>
				preparationTaskResponse(await preparation.cancel(request.params.id)),
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
			async (request) =>
				preparationTaskResponse(
					await preparation.retry(request.params.id, request.body),
				),
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
