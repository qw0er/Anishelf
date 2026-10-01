import type { LoggingConfig } from "../src/config/model.js";
import type { DirectoryDto, FileDto } from "../src/http/contracts.js";
import type { ScanState } from "../src/library/scan-state.js";

// Compile-time assertions protect boundary and state invariants.
type Assert<T extends true> = T;
export type NoDirectoryPath = Assert<
	"relativePath" extends keyof DirectoryDto ? false : true
>;
export type NoFilePath = Assert<
	"relativePath" extends keyof FileDto ? false : true
>;
export type FileLogRequiresPath = Assert<
	Extract<LoggingConfig, { destination: "file" }> extends { path: string }
		? true
		: false
>;
export type FailedScanRequiresError = Assert<
	Extract<ScanState, { status: "failed" }> extends { error: unknown }
		? true
		: false
>;

import type { ErrorCode } from "../src/errors.js";
import type { ApiErrorResponse } from "../src/http/contracts.js";
import type { HttpInstance } from "../src/http/instance.js";
import {
	SavePlaybackProgressRequestSchema,
	SavePlaybackProgressResponseSchema,
} from "../src/http/schemas/index.js";

export type ErrorCodesMatch = Assert<
	ApiErrorResponse["error"]["code"] extends ErrorCode
		? ErrorCode extends ApiErrorResponse["error"]["code"]
			? true
			: false
		: false
>;

/** Compile-only route: catches accidental loss of the Type Provider. Never registered. */
export function assertHttpSchemaInference(app: HttpInstance): void {
	app.post(
		"/typecheck/progress",
		{
			schema: {
				body: SavePlaybackProgressRequestSchema,
				response: { 200: SavePlaybackProgressResponseSchema },
			},
		},
		async (request, reply) => {
			const positionMs: number = request.body.positionMs;
			const progress = {
				positionMs,
				durationMs: request.body.durationMs,
				lastViewedAtMs: null,
				revision: 1,
				generation: request.body.generation,
				lastSequence: request.body.sequence,
			};
			if (positionMs < 0) {
				// @ts-expect-error The schema infers positionMs as a number.
				const invalidPosition: string = request.body.positionMs;
				void invalidPosition;
				// @ts-expect-error Internal source IDs are not part of the request schema.
				void request.body.sourceId;
				// @ts-expect-error The response schema excludes stale as a successful status.
				reply.code(200).send({ status: "stale", progress });
			}
			return reply.code(200).send({ status: "saved", progress });
		},
	);
}
