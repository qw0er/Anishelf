import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import { checkResourceRoot } from "../config/persistent.js";
import type {
	DirectoryResponse,
	LibraryResponse,
	ResourceDto,
	ScanResponse,
} from "../contracts/api.js";
import type { PersistentSettings } from "../contracts/config.js";
import type { LibraryEntry, ScanState } from "../contracts/library.js";
import { DomainError } from "../errors.js";
import type { LibraryIndex } from "../library/index.js";
import type { LibraryScanner } from "../library/scanner.js";

export interface LibraryRoutesOptions {
	index: LibraryIndex;
	scanner: LibraryScanner;
	settings: () => Readonly<PersistentSettings>;
}

const emptyObject = {
	type: "object",
	additionalProperties: false,
	properties: {},
} as const;

function resourceDto(entry: LibraryEntry): ResourceDto {
	const common = {
		id: entry.id,
		parentId: entry.parentId,
		name: entry.name,
	};
	return entry.kind === "directory"
		? { ...common, kind: "directory" }
		: {
				...common,
				kind: "file",
				parentId: entry.parentId,
				sizeBytes: entry.sizeBytes,
				modifiedAt: entry.modifiedAt,
				mimeType: entry.mimeType,
			};
}

export function registerLibraryRoutes(
	app: FastifyInstance<
		RawServerDefault,
		IncomingMessage,
		ServerResponse,
		Logger
	>,
	{ index, scanner, settings }: LibraryRoutesOptions,
): void {
	// Coalesce the asynchronous root preflight as well as the actual traversal.
	let pendingStart: Promise<ScanState> | undefined;
	app.addHook("onClose", async () => scanner.close());
	app.get("/api/library", async (): Promise<LibraryResponse> => {
		const rootIssue = await checkResourceRoot(settings());
		const scan = scanner.state;
		const error = rootIssue ?? (scan?.status === "failed" ? scan.error : null);
		return {
			ready: rootIssue === null,
			revision: index.revision,
			scan,
			error,
			stale: index.scannedAt !== null && error !== null,
		};
	});
	app.post(
		"/api/library/scan",
		{
			schema: { body: emptyObject },
			preValidation: async (request) => {
				if (request.body === undefined) request.body = {};
			},
		},
		async (_request, reply): Promise<ScanResponse> => {
			const active = scanner.state;
			if (active?.status === "running")
				return reply.code(202).send({ scan: active });
			if (!pendingStart) {
				pendingStart = (async () => {
					const issue = await checkResourceRoot(settings());
					if (issue) throw new DomainError(issue.code, issue.message);
					return scanner.start();
				})();
			}
			const pending = pendingStart;
			try {
				return reply.code(202).send({ scan: await pending });
			} finally {
				if (pendingStart === pending) pendingStart = undefined;
			}
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
			const { relativePath: _path, ...directory } = index.getDirectory(
				request.params.id,
			);
			return {
				directory,
				children: index.listChildren(directory.id).map(resourceDto),
			};
		},
	);
}
