import type { Static } from "typebox";
import { Type } from "typebox";

// Validate the consumed projection; unrelated upstream fields remain forward compatible.
export const subjectSchema = Type.Object({
	id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
	type: Type.Literal(2),
	name: Type.String(),
	name_cn: Type.String(),
	summary: Type.String(),
	date: Type.Optional(Type.String()),
	platform: Type.String(),
	eps: Type.Integer({ minimum: 0 }),
	images: Type.Union([
		Type.Object({ large: Type.String(), common: Type.String() }),
		Type.Null(),
	]),
	rating: Type.Object({ score: Type.Number({ minimum: 0, maximum: 10 }) }),
	tags: Type.Array(Type.Object({ name: Type.String() })),
});
export type BangumiSubject = Static<typeof subjectSchema>;
export const searchSchema = Type.Object({
	total: Type.Integer({ minimum: 0 }),
	limit: Type.Integer({ minimum: 1 }),
	offset: Type.Integer({ minimum: 0 }),
	data: Type.Array(subjectSchema, { maxItems: 50 }),
});
export type BangumiFailureCode =
	| "invalid-response"
	| "not-found"
	| "rate-limited"
	| "unavailable"
	| "busy";
export class BangumiError extends Error {
	constructor(
		readonly failure: {
			code: BangumiFailureCode;
			message: string;
			retryAt: number | null;
		},
		options?: ErrorOptions,
	) {
		super(failure.message, options);
		this.name = "BangumiError";
	}
}
export interface BangumiMetadataApi {
	search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<{
		items: BangumiSubject[];
		page: number;
		perPage: number;
		hasNextPage: boolean;
	}>;
	get(id: number, signal: AbortSignal): Promise<BangumiSubject>;
}
