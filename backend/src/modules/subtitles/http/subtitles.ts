import { Type } from "typebox";
import { ResourceIdSchema } from "../../../contracts/schemas/common.js";
import {
	PrepareSubtitleRequestSchema,
	ResourceParamsSchema,
	SubtitleAssetParamsSchema,
	SubtitleContentParamsSchema,
	SubtitleContentQuerySchema,
	SubtitleDiscoveryResponseSchema,
	SubtitlePreparationResponseSchema,
} from "../../../contracts/schemas/index.js";
import { SubtitleFontsResponseSchema } from "../../../contracts/schemas/subtitles.js";
import type { HttpInstance } from "../../../transport/instance.js";
import {
	subtitleDiscoveryResponse,
	subtitleFontsResponse,
	subtitlePreparationResponse,
} from "../../../transport/presenters/subtitles.js";
import type { SubtitleApplication } from "../application/subtitles.js";
export function registerSubtitleRoutes(
	app: HttpInstance,
	subtitles: SubtitleApplication,
): void {
	app.get(
		"/api/subtitle-font-sets/:id/status",
		{
			schema: {
				params: SubtitleAssetParamsSchema,
				response: { 200: SubtitleFontsResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return subtitleFontsResponse(
				await subtitles.getSubtitleFontStatus(request.params.id),
			);
		},
	);
	app.get(
		"/api/subtitle-font-sets/:id/fonts/:fontId",
		{
			schema: {
				params: Type.Object(
					{ id: ResourceIdSchema, fontId: ResourceIdSchema },
					{ additionalProperties: false },
				),
			},
		},
		async (request, reply) => {
			const result = await subtitles.getSubtitleFontContent(
				request.params.id,
				request.params.fontId,
			);
			reply.header("Cache-Control", "no-store");
			reply.header("X-Content-Type-Options", "nosniff");
			reply.type(result.format === "ttf" ? "font/ttf" : "font/otf");
			return reply.send(result.bytes);
		},
	);
	app.get(
		"/api/files/:id/subtitles",
		{
			schema: {
				params: ResourceParamsSchema,
				response: { 200: SubtitleDiscoveryResponseSchema },
			},
		},
		async (request, reply) => {
			const result = await subtitles.discoverSubtitles(request.params.id);
			reply.header("Cache-Control", "no-store");
			return subtitleDiscoveryResponse(result);
		},
	);
	app.get(
		"/api/files/:id/subtitles/:trackId/content",
		{
			schema: {
				params: SubtitleContentParamsSchema,
				querystring: SubtitleContentQuerySchema,
				response: { 200: Type.String() },
			},
		},
		async (request, reply) => {
			const result = await subtitles.getSubtitleContent(
				request.params.id,
				request.params.trackId,
				request.query.sourceVersion,
				request.query.subtitleVersion,
			);
			reply.header("Cache-Control", "no-store");
			reply.header("X-Content-Type-Options", "nosniff");
			reply.type("text/plain; charset=utf-8");
			return result.text;
		},
	);
	app.post(
		"/api/files/:id/subtitles/:trackId/prepare",
		{
			schema: {
				params: SubtitleContentParamsSchema,
				body: PrepareSubtitleRequestSchema,
				response: {
					200: SubtitlePreparationResponseSchema,
					202: SubtitlePreparationResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const result = await subtitles.prepareSubtitle(
				request.params.id,
				request.params.trackId,
				request.body.sourceVersion,
				request.body.subtitleVersion,
			);
			reply.header("Cache-Control", "no-store");
			reply.code(result.status === "pending" ? 202 : 200);
			return subtitlePreparationResponse(result);
		},
	);
	app.get(
		"/api/subtitle-assets/:id/status",
		{
			schema: {
				params: SubtitleAssetParamsSchema,
				response: { 200: SubtitlePreparationResponseSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return subtitlePreparationResponse(
				await subtitles.getSubtitleAssetStatus(request.params.id),
			);
		},
	);
	app.get(
		"/api/subtitle-assets/:id",
		{
			schema: {
				params: SubtitleAssetParamsSchema,
				response: { 200: Type.String() },
			},
		},
		async (request, reply) => {
			const result = await subtitles.getSubtitleAssetContent(request.params.id);
			reply.header("Cache-Control", "no-store");
			reply.header("X-Content-Type-Options", "nosniff");
			reply.type("text/plain; charset=utf-8");
			return result.text;
		},
	);
}
