import type { Logger } from "pino";
import { Type } from "typebox";
import {
	AnimeDetailSchema,
	AnimeStatusSchema,
} from "../contracts/schemas/anime-detail.js";
import type { AcquisitionApi } from "../modules/acquisition/public.js";
import type { AnimeApi } from "../modules/anime/public.js";
import { DomainError } from "../shared/errors.js";
import { workKey, workReference } from "../shared/external-reference.js";
import type { HttpInstance } from "../transport/instance.js";

/** The application is the only read owner that combines Anime and Acquisition. */
export function registerAnimeDetailRoutes(
	app: HttpInstance,
	anime: Pick<AnimeApi, "queries"> & {
		tracking: Pick<AnimeApi["tracking"], "status" | "list">;
	},
	acquisition: {
		subscriptions: Pick<AcquisitionApi["subscriptions"], "get">;
		downloads?: Pick<NonNullable<AcquisitionApi["downloads"]>, "summary">;
	},
	logger: Logger,
): void {
	const read = async (input: { localWorkId: string } | { key: string }) => {
		const detail = await anime.queries.detail(input);
		const key = workKey(detail.reference);
		const { viewing, ...description } = detail;
		const local = detail.local;
		const result = {
			...description,
			local: local
				? {
						...local,
						work: {
							...local.work,
							coverUrl: local.work.hasCover
								? `/api/catalog/works/${encodeURIComponent(local.work.id)}/artwork/cover`
								: null,
						},
						bannerUrl: local.hasBanner
							? `/api/catalog/works/${encodeURIComponent(local.work.id)}/artwork/banner`
							: null,
					}
				: null,
		};
		// Revalidate account generation after every asynchronous detail read.
		if (anime.tracking.status().generation !== viewing.generation)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"Account changed while reading anime detail.",
			);
		logger.trace(
			{ event: "application.anime_detail_read", key, local: Boolean(local) },
			"Unified anime detail read.",
		);
		return result;
	};
	app.get(
		"/api/anime/status/:key",
		{
			schema: {
				params: Type.Object({
					key: Type.String({ minLength: 1, maxLength: 1024 }),
				}),
				response: { 200: AnimeStatusSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			let key: string;
			try {
				key = workKey(workReference(request.params.key));
			} catch {
				throw new DomainError(
					"INVALID_REQUEST",
					"Invalid anime work identity.",
				);
			}
			const { entries, ...snapshot } = anime.tracking.list();
			const { subscription } = acquisition.subscriptions.get(key, 1, false);
			const activity = acquisition.downloads?.summary(key);
			const downloads = activity
				? {
						total: activity.total,
						active: activity.active,
						attention: activity.attention,
						...(activity.planningError
							? { planningError: activity.planningError }
							: {}),
					}
				: null;
			logger.trace(
				{ event: "application.anime_status_read", key },
				"Anime status read.",
			);
			return {
				viewing: {
					...snapshot,
					entry: entries.find((entry) => entry.mediaId === key) ?? null,
				},
				subscription: { subscription },
				downloads,
			};
		},
	);

	app.get(
		"/api/anime/details/local/:id",
		{
			schema: {
				params: Type.Object({
					id: Type.String({ minLength: 1, maxLength: 200 }),
				}),
				response: { 200: AnimeDetailSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return read({ localWorkId: request.params.id });
		},
	);
	app.get(
		"/api/anime/details/works/:key",
		{
			schema: {
				params: Type.Object({
					key: Type.String({ minLength: 1, maxLength: 1024 }),
				}),
				response: { 200: AnimeDetailSchema },
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return read({ key: request.params.key });
		},
	);
}
