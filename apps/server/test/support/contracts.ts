import type { DirectoryDto, FileDto } from "@anishelf/contracts/http";
import type { ScanState } from "../../src/modules/resources/library/domain/scan-state.js";
import type { LoggingConfig } from "../../src/platform/logging/config.js";

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

import type { ApiErrorResponse } from "@anishelf/contracts/http";
import {
	SavePlaybackProgressRequestSchema,
	SavePlaybackProgressResponseSchema,
} from "@anishelf/contracts/schemas";
import type { ErrorCode } from "../../src/shared/errors.js";
import type { HttpInstance } from "../../src/transport/instance.js";

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

import type * as Http from "@anishelf/contracts/http";
import type * as Selection from "../../src/modules/playback/playback-selection/public.js";

// Bidirectional checks make drift between business vocabulary and wire schemas a build failure.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type SelectionContractsMatch = Assert<
	Same<
		[
			Selection.PlaybackOptionsRequest,
			Selection.PlaybackOptionsResponse,
			Selection.PlaybackSelectionRequest,
		],
		[
			Http.PlaybackOptionsRequest,
			Http.PlaybackOptionsResponse,
			Http.PlaybackSelectionRequest,
		]
	>
>;
