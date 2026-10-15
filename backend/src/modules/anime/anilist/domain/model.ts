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
export interface AniListClient {
	request(
		query: string,
		variables: Record<string, unknown>,
		options: { signal: AbortSignal; token?: string; priority?: boolean },
	): Promise<unknown>;
}
export interface AniListOptions {
	logger?: Logger;
	fetch?: typeof fetch;
	intervalMs?: number;
	timeoutMs?: number;
	attempts?: number;
	random?: () => number;
	maximumPending?: number;
}
