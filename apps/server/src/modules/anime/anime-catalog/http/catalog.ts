import { Type } from "typebox";
import {
	CatalogConfirmationRequestSchema,
	CatalogConfirmationSchema,
	CatalogDecisionRequestSchema,
	CatalogFileReviewsRequestSchema,
	CatalogFileReviewsSchema,
	CatalogIdParamsSchema,
	CatalogPreviewRequestSchema,
	CatalogPreviewSchema,
	CatalogRefreshSchema,
	CatalogRejectionRequestSchema,
	CatalogReviewListSchema,
	CatalogReviewQuerySchema,
	CatalogReviewSchema,
	CatalogSourceSchema,
	IdentificationStatusSchema,
	LocalWorkDetailSchema,
} from "../../../../contracts/schemas/anime-catalog.js";
import { DomainError } from "../../../../shared/errors.js";
import { sendCachedAsset } from "../../../../transport/cache.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AnimeCatalogApi } from "../public.js";

const artworkRoute = "/api/catalog/works/:id/artwork/:kind";

export function registerCatalogRoutes(
	app: HttpInstance,
	catalog: AnimeCatalogApi,
	identification?: {
		reidentify(fileId: string): Promise<void>;
		reidentifyPending(): void;
		getStatus(): import("../../../../contracts/http.js").IdentificationStatusResponse;
	},
): void {
	app.addHook("onSend", async (request, reply) => {
		const route = request.routeOptions.url;
		// Artwork is content-addressed binary data and carries its own cache policy.
		if (route?.startsWith("/api/catalog") && route !== artworkRoute)
			reply.header("Cache-Control", "no-store");
	});
	if (identification)
		app.post(
			"/api/catalog/reviews/reidentify",
			{
				schema: {
					body: Type.Object({}, { additionalProperties: false }),
					response: { 202: IdentificationStatusSchema },
				},
			},
			async (_request, reply) => {
				identification.reidentifyPending();
				return reply.code(202).send(identification.getStatus());
			},
		);
	if (identification)
		app.post(
			"/api/catalog/reviews/:id/reidentify",
			{
				schema: {
					params: CatalogIdParamsSchema,
					body: CatalogRefreshSchema,
					response: { 200: CatalogReviewSchema },
				},
			},
			async (request) => {
				const item = await catalog.review(request.params.id);
				if (
					item.revision !== request.body.revision ||
					item.decision !== "pending" ||
					!item.available
				)
					throw new DomainError(
						"CATALOG_CONFLICT",
						"Only the current, available pending review can be re-identified.",
					);
				await identification.reidentify(item.fileId);
				return catalog.review(item.id);
			},
		);
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
