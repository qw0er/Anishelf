import {
	AnimeLibraryQuerySchema,
	AnimeLibrarySchema,
} from "../../../../contracts/schemas/anime-library.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AnimeLibraryApi } from "../public.js";
export function registerAnimeLibraryRoutes(
	app: HttpInstance,
	library: AnimeLibraryApi,
) {
	app.get(
		"/api/anime/library",
		{
			schema: {
				querystring: AnimeLibraryQuerySchema,
				response: { 200: AnimeLibrarySchema },
			},
		},
		async (request) => {
			const { generation, page, perPage, year, ...filters } = request.query;
			const result = await library.list(
				{
					...filters,
					...(page ? { page: Number(page) } : {}),
					...(perPage ? { perPage: Number(perPage) } : {}),
					...(year ? { year: Number(year) } : {}),
				},
				generation,
			);
			return {
				...result,
				items: result.items.map(({ hasCover, remoteCoverUrl, ...card }) => ({
					...card,
					coverUrl:
						card.localWorkId && hasCover
							? `/api/catalog/works/${encodeURIComponent(card.localWorkId)}/artwork/cover`
							: remoteCoverUrl,
				})),
			};
		},
	);
}
