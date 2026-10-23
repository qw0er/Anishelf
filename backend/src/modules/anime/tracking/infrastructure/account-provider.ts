import { DomainError } from "../../../../shared/errors.js";
import { externalId } from "../../../../shared/external-reference.js";
import { type AniListAccountApi, AniListError } from "../../anilist/public.js";
import type { TrackingAccount } from "../domain/model.js";
import type { TrackingAccountProvider } from "../ports.js";

export class AniListAccountProvider implements TrackingAccountProvider {
	constructor(private readonly client: AniListAccountApi) {}
	async viewer(token: string, signal: AbortSignal): Promise<TrackingAccount> {
		try {
			if (!token || /\s/.test(token))
				throw new DomainError("INVALID_REQUEST", "Invalid access token.");
			const account = await this.client.viewer(token, signal);
			return {
				id: externalId("anilist", String(account.id)),
				name: account.name,
			};
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
