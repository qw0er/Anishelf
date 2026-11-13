import {
	EmbeddedSubtitleParamsSchema,
	EmbeddedSubtitleQuerySchema,
	EmbeddedSubtitleResponseSchema,
	ResourceParamsSchema,
	SubtitleContentParamsSchema,
	SubtitleContentQuerySchema,
	SubtitleDiscoveryResponseSchema,
} from "@anishelf/contracts/schemas";
import { Type } from "typebox";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { EmbeddedSubtitles } from "../application/embedded.js";
import type { SubtitleApplication } from "../application/subtitles.js";
import { subtitleDiscoveryResponse } from "./presenters.js";
export function registerSubtitleRoutes(
	app: HttpInstance,
	subtitles: SubtitleApplication,
): void {
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
}

export function registerEmbeddedSubtitleRoutes(
	app: HttpInstance,
	embedded: EmbeddedSubtitles,
): void {
	app.get(
		"/api/files/:id/subtitles/embedded/:index",
		{
			schema: {
				params: EmbeddedSubtitleParamsSchema,
				querystring: EmbeddedSubtitleQuerySchema,
				response: { 200: EmbeddedSubtitleResponseSchema },
			},
		},
		async (request, reply) => {
			const { id, index } = request.params;
			const abort = new AbortController();
			const close = () => abort.abort();
			reply.raw.once("close", close);
			try {
				reply.header("Cache-Control", "no-store");
				return await embedded.track(
					{ fileId: id, ...request.query },
					Number(index),
					abort.signal,
				);
			} finally {
				reply.raw.off("close", close);
			}
		},
	);
	app.get(
		"/api/files/:id/subtitles/fonts/:index",
		{
			schema: {
				params: EmbeddedSubtitleParamsSchema,
				querystring: EmbeddedSubtitleQuerySchema,
			},
		},
		async (request, reply) => {
			const { id, index } = request.params;
			const abort = new AbortController();
			const close = () => abort.abort();
			reply.raw.once("close", close);
			try {
				const bytes = await embedded.font(
					{ fileId: id, ...request.query },
					Number(index),
					abort.signal,
				);
				reply.header("Cache-Control", "no-store");
				reply.header("X-Content-Type-Options", "nosniff");
				reply.type("application/octet-stream");
				return bytes;
			} finally {
				reply.raw.off("close", close);
			}
		},
	);
}
