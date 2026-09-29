import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { LibraryApplication } from "../application/library.js";
import type {
	DirectoryResponse,
	LibraryResponse,
	ScanResponse,
} from "../contracts/api.js";

const emptyObject = {
	type: "object",
	additionalProperties: false,
	properties: {},
} as const;

export function registerLibraryRoutes(
	app: FastifyInstance<
		RawServerDefault,
		IncomingMessage,
		ServerResponse,
		Logger
	>,
	library: LibraryApplication,
): void {
	app.get(
		"/api/library",
		async (): Promise<LibraryResponse> => library.getStatus(),
	);
	app.post(
		"/api/library/scan",
		{
			schema: { body: emptyObject },
			preValidation: async (request) => {
				if (request.body === undefined) request.body = {};
			},
		},
		async (_request, reply): Promise<ScanResponse> => {
			return reply.code(202).send({ scan: await library.startScan() });
		},
	);
	app.get<{ Params: { id: string } }>(
		"/api/directories/:id",
		{
			schema: {
				params: {
					type: "object",
					additionalProperties: false,
					required: ["id"],
					properties: {
						id: {
							type: "string",
							minLength: 1,
							maxLength: 64,
							pattern: "^[A-Za-z0-9_-]+$",
						},
					},
				},
			},
		},
		async (request): Promise<DirectoryResponse> => {
			return library.getDirectory(request.params.id);
		},
	);
}
