import {
	AnimeLibraryQuerySchema,
	AnimeLibrarySchema,
} from "../../../../contracts/schemas/anime-library.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { LibraryCard } from "../domain/model.js";
import type { AnimeLibraryApi } from "../public.js";
export function registerAnimeLibraryRoutes(
	app: HttpInstance,
	library: AnimeLibraryApi,
	artwork?: {
		cachedArtworkId(
			reference: LibraryCard["reference"],
			kind: "cover",
		): Promise<string | null>;
	},
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
				items: await Promise.all(
					result.items.map(
						async ({ hasCover, coverVersion, remoteCoverUrl, ...card }) => ({
							...card,
							coverUrl: await coverUrl(
								card,
								{ hasCover, coverVersion, remoteCoverUrl },
								artwork,
							),
						}),
					),
				),
			};
		},
	);
}

/** Local posters stay on the catalog proxy; tracked posters use cached bytes when warm. */
async function coverUrl(
	card: Pick<LibraryCard, "localWorkId" | "reference">,
	local: {
		hasCover: boolean;
		coverVersion: string | null;
		remoteCoverUrl: string | null;
	},
	artwork:
		| {
				cachedArtworkId(
					reference: LibraryCard["reference"],
					kind: "cover",
				): Promise<string | null>;
		  }
		| undefined,
): Promise<string | null> {
	if (card.localWorkId && local.hasCover) {
		const version = local.coverVersion ? `?v=${local.coverVersion}` : "";
		return `/api/catalog/works/${encodeURIComponent(card.localWorkId)}/artwork/cover${version}`;
	}
	if (!local.remoteCoverUrl) return null;
	const cached = await artwork
		?.cachedArtworkId(card.reference, "cover")
		.catch(() => null);
	return cached ? `/api/metadata/artwork/${cached}` : local.remoteCoverUrl;
}
