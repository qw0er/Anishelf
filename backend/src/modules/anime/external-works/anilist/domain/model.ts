import type { Anilist } from "@api-wrappers/anilist-wrapper";
import type { Logger } from "pino";
export type AniListFailureCode =
	| "busy"
	| "invalid-request"
	| "not-found"
	| "unavailable"
	| "invalid-response"
	| "rate-limited"
	| "unauthorized";
export class AniListError extends Error {
	constructor(
		readonly failure: {
			code: AniListFailureCode;
			message: string;
			retryAt: number | null;
		},
	) {
		super(failure.message);
		this.name = "AniListError";
	}
}
export interface AniListRequestOptions {
	signal: AbortSignal;
	token?: string;
}
export interface AniListClient {
	execute<T>(
		options: AniListRequestOptions,
		operation: (sdk: Anilist) => Promise<T>,
	): Promise<T>;
}
export interface AniListOptions {
	logger?: Logger;
	fetch?: typeof fetch;
	intervalMs?: number;
	timeoutMs?: number;
	attempts?: number;
}
