import {
	DirectoryResponseSchema,
	DirectorySearchQuerySchema,
	DirectorySearchResponseSchema,
	EmptyObjectSchema,
	LibraryResponseSchema,
	ResourceParamsSchema,
	ScanResponseSchema,
} from "../../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { LibraryApplication } from "../application/library.js";
import {
	directoryResponse,
	libraryResponse,
	resourceDto,
	scanStateDto,
} from "./presenters.js";

export function registerLibraryRoutes(
	app: HttpInstance,
	library: LibraryApplication,
): void {
	app.get(
		"/api/library",
		{ schema: { response: { 200: LibraryResponseSchema } } },
		async () => libraryResponse(await library.getStatus()),
	);
	app.post(
		"/api/library/scan",
		{
			schema: {
				body: EmptyObjectSchema,
				response: { 202: ScanResponseSchema },
			},
			preValidation: async (request) => {
				if (request.body === undefined) request.body = {};
			},
		},
		async (_request, reply) =>
			reply.code(202).send({ scan: scanStateDto(await library.startScan()) }),
	);
	app.get(
		"/api/directories/:id/search",
		{
			schema: {
				params: ResourceParamsSchema,
				querystring: DirectorySearchQuerySchema,
				response: { 200: DirectorySearchResponseSchema },
			},
		},
		async (request) => {
			const items = library
				.searchDirectory(request.params.id, request.query.q)
				.map(({ resource, parentPath }) => ({
					resource: resourceDto(resource),
					parentPath,
				}));
			request.log.debug(
				{ event: "library.search_completed", count: items.length },
				"Directory search completed.",
			);
			return { items };
		},
	);
	app.get(
		"/api/directories/:id",
		{
			schema: {
				params: ResourceParamsSchema,
				response: { 200: DirectoryResponseSchema },
			},
		},
		async (request) =>
			directoryResponse(library.getDirectory(request.params.id)),
	);
}
