import { Type } from "typebox";
import {
	CatalogConfirmationRequestSchema,
	CatalogConfirmationSchema,
	CatalogDecisionRequestSchema,
	CatalogEpisodeEditSchema,
	CatalogEpisodeParamsSchema,
	CatalogEpisodeSchema,
	CatalogFileReviewsRequestSchema,
	CatalogFileReviewsSchema,
	CatalogIdParamsSchema,
	CatalogListQuerySchema,
	CatalogListSchema,
	CatalogPreviewRequestSchema,
	CatalogPreviewSchema,
	CatalogRefreshSchema,
	CatalogRejectionRequestSchema,
	CatalogReviewListSchema,
	CatalogReviewQuerySchema,
	CatalogReviewSchema,
	CatalogSourceSchema,
	CatalogWorkDetailSchema,
} from "../../../../contracts/schemas/anime-catalog.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AnimeCatalogApi } from "../public.js";

export function registerCatalogRoutes(
	app: HttpInstance,
	catalog: AnimeCatalogApi,
): void {
	app.addHook("onSend", async (request, reply) => {
		if (request.routeOptions.url?.startsWith("/api/catalog"))
			reply.header("Cache-Control", "no-store");
	});
	app.get(
		"/api/catalog/works/:id/artwork/:kind",
		{
			schema: {
				params: Type.Object(
					{
						id: CatalogIdParamsSchema.properties.id,
						kind: Type.Union([Type.Literal("cover"), Type.Literal("banner")]),
					},
					{ additionalProperties: false },
				),
			},
		},
		async (request, reply) => {
			const asset = await catalog.artwork(
				request.params.id,
				request.params.kind,
			);
			reply.header("X-Content-Type-Options", "nosniff");
			return reply.type(asset.mimeType).send(Buffer.from(asset.bytes));
		},
	);
	app.post(
		"/api/catalog/file-reviews",
		{
			schema: {
				body: CatalogFileReviewsRequestSchema,
				response: { 200: CatalogFileReviewsSchema },
			},
		},
		async (request) => catalog.fileReviews(request.body.fileIds),
	);
	app.get(
		"/api/catalog/works",
		{
			schema: {
				querystring: CatalogListQuerySchema,
				response: { 200: CatalogListSchema },
			},
		},
		async (request) => {
			const { page, perPage, year, ...query } = request.query;
			const result = await catalog.list({
				...query,
				...(page ? { page: Number(page) } : {}),
				...(perPage ? { perPage: Number(perPage) } : {}),
				...(year ? { year: Number(year) } : {}),
			});
			return { ...result, items: result.items.map(presentCard) };
		},
	);
	app.get(
		"/api/catalog/works/:id",
		{
			schema: {
				params: CatalogIdParamsSchema,
				response: { 200: CatalogWorkDetailSchema },
			},
		},
		async (request) => presentDetail(await catalog.detail(request.params.id)),
	);
	app.get(
		"/api/catalog/sources/:id",
		{
			schema: {
				params: CatalogIdParamsSchema,
				response: { 200: CatalogSourceSchema },
			},
		},
		async (request) => catalog.source(request.params.id),
	);
	app.get(
		"/api/catalog/reviews/:id",
		{
			schema: {
				params: CatalogIdParamsSchema,
				response: { 200: CatalogReviewSchema },
			},
		},
		async (request) => catalog.review(request.params.id),
	);
	app.get(
		"/api/catalog/reviews",
		{
			schema: {
				querystring: CatalogReviewQuerySchema,
				response: { 200: CatalogReviewListSchema },
			},
		},
		async (request) => {
			const { page, perPage, decision, workId } = request.query;
			return catalog.reviews({
				...(workId ? { workId } : {}),
				...(decision ? { decision } : {}),
				...(page ? { page: Number(page) } : {}),
				...(perPage ? { perPage: Number(perPage) } : {}),
			});
		},
	);
	app.post(
		"/api/catalog/previews",
		{
			schema: {
				body: CatalogPreviewRequestSchema,
				response: { 200: CatalogPreviewSchema },
			},
		},
		async (request) => catalog.preview(request.body),
	);
	app.post(
		"/api/catalog/confirmations",
		{
			schema: {
				body: CatalogConfirmationRequestSchema,
				response: { 200: CatalogConfirmationSchema },
			},
		},
		async (request) => catalog.confirm(request.body),
	);
	app.post(
		"/api/catalog/reviews/:id/reject",
		{
			schema: {
				params: CatalogIdParamsSchema,
				body: CatalogRejectionRequestSchema,
				response: { 200: CatalogReviewSchema },
			},
		},
		async (request) =>
			catalog.reject(
				request.params.id,
				request.body.revision,
				request.body.reason ?? "",
			),
	);
	app.post(
		"/api/catalog/reviews/:id/remove",
		{
			schema: {
				params: CatalogIdParamsSchema,
				body: CatalogDecisionRequestSchema,
				response: { 200: CatalogReviewSchema },
			},
		},
		async (request) =>
			catalog.remove(
				request.params.id,
				request.body.revision,
				request.body.reason,
			),
	);
	app.patch(
		"/api/catalog/works/:id/episodes/:episodeId",
		{
			schema: {
				params: CatalogEpisodeParamsSchema,
				body: CatalogEpisodeEditSchema,
				response: { 200: CatalogEpisodeSchema },
			},
		},
		async (request) =>
			catalog.editEpisode(
				request.params.id,
				request.params.episodeId,
				request.body.revision,
				request.body.number,
				request.body.label,
			),
	);
	app.post(
		"/api/catalog/works/:id/refresh",
		{
			schema: {
				params: CatalogIdParamsSchema,
				body: CatalogRefreshSchema,
				response: { 200: CatalogWorkDetailSchema },
			},
		},
		async (request) =>
			presentDetail(
				await catalog.refresh(request.params.id, request.body.revision),
			),
	);
}

function artworkUrl(id: string, kind: "cover" | "banner"): string {
	return `/api/catalog/works/${encodeURIComponent(id)}/artwork/${kind}`;
}
function presentCard(
	work: Awaited<ReturnType<AnimeCatalogApi["list"]>>["items"][number],
) {
	const { hasCover, ...card } = work;
	return { ...card, coverUrl: hasCover ? artworkUrl(work.id, "cover") : null };
}
function presentDetail(value: Awaited<ReturnType<AnimeCatalogApi["detail"]>>) {
	const { hasBanner, work, ...detail } = value;
	return {
		...detail,
		work: presentCard(work),
		bannerUrl: hasBanner ? artworkUrl(work.id, "banner") : null,
	};
}
