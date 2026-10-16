import { DomainError } from "../../../../shared/errors.js";
import { type AniListClient, AniListError } from "../../anilist/public.js";
import type { TrackingAccount } from "../domain/model.js";

export class AniListAccountProvider {
	constructor(private readonly client: AniListClient) {}
	async viewer(token: string, signal: AbortSignal): Promise<TrackingAccount> {
		try {
			const raw = (await this.client.request(
				"query ConnectedAniListAccount { Viewer { id name } }",
				{},
				{ token, signal, priority: true },
			)) as { Viewer?: { id?: unknown; name?: unknown } };
			if (
				!Number.isSafeInteger(raw?.Viewer?.id) ||
				Number(raw.Viewer?.id) <= 0 ||
				typeof raw.Viewer?.name !== "string" ||
				!raw.Viewer.name ||
				raw.Viewer.name.length > 256
			)
				throw new DomainError(
					"TRACKING_UNAVAILABLE",
					"AniList returned an invalid account.",
				);
			return { id: raw.Viewer.id as number, name: raw.Viewer.name };
		} catch (error) {
			if (error instanceof DomainError) throw error;
			if (
				error instanceof AniListError &&
				error.failure.code === "unauthorized"
			)
				throw new DomainError(
					"TRACKING_AUTHORIZATION_REQUIRED",
					"Reconnect your AniList account.",
				);
			if (
				error instanceof AniListError &&
				error.failure.code === "rate-limited"
			)
				throw new DomainError(
					"TRACKING_RATE_LIMITED",
					"AniList rate limit reached.",
				);
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"AniList account check failed. Retry later.",
			);
		}
	}
}
