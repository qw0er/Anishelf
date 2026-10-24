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
	LocalWorkDetailSchema,
} from "../../../../contracts/schemas/anime-catalog.js";
import { sendCachedAsset } from "../../../../transport/cache.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AnimeCatalogApi } from "../public.js";

const artworkRoute = "/api/catalog/works/:id/artwork/:kind";

export function registerCatalogRoutes(
	app: HttpInstance,
	catalog: AnimeCatalogApi,
): void {
	app.addHook("onSend", async (request, reply) => {
		const route = request.routeOptions.url;
		// Artwork is content-addressed binary data and carries its own cache policy.
		if (route?.startsWith("/api/catalog") && route !== artworkRoute)
			reply.header("Cache-Control", "no-store");
	});
	app.get(
		artworkRoute,
		{
			schema: {
				params: Type.Object(
					{
						id: CatalogIdParamsSchema.properties.id,
						kind: Type.Union([Type.Literal("cover"), Type.Literal("banner")]),
					},
					{ additionalProperties: false },
				),
				querystring: Type.Object(
					{
						v: Type.Optional(
							Type.String({ pattern: "^[a-f0-9]{8,64}$", maxLength: 64 }),
						),
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
			// A URL that still pins the current artwork can be cached far longer.
			const pinned =
				request.query.v !== undefined && request.query.v === asset.version;
			return sendCachedAsset(request, reply, asset, {
				maxAgeSeconds: pinned ? 24 * 60 * 60 : 60 * 60,
			});
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
				response: { 200: LocalWorkDetailSchema },
			},
		},
		async (request) =>
			presentLocalWorkDetail(
				await catalog.getLocalWorkDetail(request.params.id),
			),
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
				response: { 200: LocalWorkDetailSchema },
			},
		},
		async (request) =>
			presentLocalWorkDetail(
				await catalog.refresh(request.params.id, request.body.revision),
			),
	);
}

function artworkUrl(
	id: string,
	kind: "cover" | "banner",
	version: string | null,
): string {
	const path = `/api/catalog/works/${encodeURIComponent(id)}/artwork/${kind}`;
	return version ? `${path}?v=${version}` : path;
}
function presentCard(
	work: Awaited<ReturnType<AnimeCatalogApi["list"]>>["items"][number],
) {
	const { hasCover, coverVersion, ...card } = work;
	return {
		...card,
		coverUrl: hasCover ? artworkUrl(work.id, "cover", coverVersion) : null,
	};
}
function presentLocalWorkDetail(
	value: Awaited<ReturnType<AnimeCatalogApi["getLocalWorkDetail"]>>,
) {
	const { hasBanner, bannerVersion, work, ...detail } = value;
	return {
		...detail,
		work: presentCard(work),
		bannerUrl: hasBanner ? artworkUrl(work.id, "banner", bannerVersion) : null,
	};
}
