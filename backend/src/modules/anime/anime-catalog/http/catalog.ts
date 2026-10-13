import {
	CatalogConfirmationRequestSchema,
	CatalogConfirmationSchema,
	CatalogDecisionRequestSchema,
	CatalogEpisodeEditSchema,
	CatalogEpisodeParamsSchema,
	CatalogEpisodeSchema,
	CatalogIdParamsSchema,
	CatalogListQuerySchema,
	CatalogListSchema,
	CatalogPreviewRequestSchema,
	CatalogPreviewSchema,
	CatalogRefreshSchema,
	CatalogReviewListSchema,
	CatalogReviewQuerySchema,
	CatalogReviewSchema,
	CatalogWorkDetailSchema,
	CatalogWorkEditSchema,
	CatalogWorkSchema,
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
		"/api/catalog/works",
		{
			schema: {
				querystring: CatalogListQuerySchema,
				response: { 200: CatalogListSchema },
			},
		},
		async (request) => {
			const { page, perPage, year, ...query } = request.query;
			return catalog.list({
				...query,
				...(page ? { page: Number(page) } : {}),
				...(perPage ? { perPage: Number(perPage) } : {}),
				...(year ? { year: Number(year) } : {}),
			});
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
		async (request) => catalog.detail(request.params.id),
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
			const { page, perPage, decision } = request.query;
			return catalog.reviews({
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
				body: CatalogDecisionRequestSchema,
				response: { 200: CatalogReviewSchema },
			},
		},
		async (request) =>
			catalog.reject(
				request.params.id,
				request.body.revision,
				request.body.reason,
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
		"/api/catalog/works/:id",
		{
			schema: {
				params: CatalogIdParamsSchema,
				body: CatalogWorkEditSchema,
				response: { 200: CatalogWorkSchema },
			},
		},
		async (request) =>
			catalog.editWork(
				request.params.id,
				request.body.revision,
				request.body.title,
				request.body.aliases,
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
			catalog.refresh(request.params.id, request.body.revision),
	);
}
