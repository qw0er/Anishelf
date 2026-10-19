import { Anilist } from "@api-wrappers/anilist-wrapper";
import { type AniListClient, AniListError } from "../domain/model.js";

/** Keep credentials and cancellation scoped to one operation, never a shared SDK. */
export async function withAniList<T>(
	client: AniListClient,
	options: Parameters<AniListClient["request"]>[2],
	operation: (sdk: Anilist) => Promise<T>,
): Promise<T> {
	let failure: { error: unknown } | undefined;
	const sdk = new Anilist({
		core: {
			// The scheduler owns retries, deadlines, authorization and request pacing.
			retry: { maxAttempts: 1 },
			transport: {
				async execute(context) {
					const body = context.body as {
						query: string;
						variables?: Record<string, unknown>;
					};
					try {
						const data = await client.request(
							body.query,
							body.variables ?? {},
							options,
						);
						return Response.json({ data });
					} catch (error) {
						failure = { error };
						throw error;
					}
				},
			},
		},
	});
	try {
		return await operation(sdk);
	} catch {
		// api-core may wrap transport exceptions; preserve the scheduler's classification.
		if (failure) throw failure.error;
		throw new AniListError({
			code: "invalid-response",
			message: "AniList wrapper could not decode the response.",
			retryAt: null,
		});
	}
}
