import type { LibraryApplication } from "../application/library.js";
import type { HttpInstance } from "./instance.js";
import {
	directoryResponse,
	libraryResponse,
	scanStateDto,
} from "./presenters.js";
import {
	DirectoryResponseSchema,
	EmptyObjectSchema,
	LibraryResponseSchema,
	ResourceParamsSchema,
	ScanResponseSchema,
} from "./schemas/index.js";

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
