import type { AcquisitionTarget } from "../../../anime/public.js";
import type { Subscription } from "./model.js";

export const airingPolicy = {
	releaseDelayMs: 15 * 60_000,
	metadataIntervalMs: 6 * 60 * 60_000,
	retryMs: 5 * 60_000,
} as const;
export interface AiringSchedule {
	reason:
		| "waiting_for_premiere"
		| "waiting_for_episode"
		| "release_delay"
		| "backlog"
		| "fallback"
		| "due";
	episode: number | null;
	airingAt: number | null;
	nextCheckAt: number | null;
	metadataCheckAt: number;
	metadataFetchedAt: number | null;
	metadataFresh: boolean;
	assessedAt: number;
	lastAttemptAt: number | null;
	wakeAt: number | null;
}
export function waitingForAiring(schedule: AiringSchedule) {
	return [
		"waiting_for_premiere",
		"waiting_for_episode",
		"release_delay",
	].includes(schedule.reason);
}
/** Airing is a search hint, never release eligibility or download authorization. All times are epoch milliseconds. */
export function scheduleAiring(
	sub: Pick<Subscription, "startEpisode" | "schedule">,
	target: AcquisitionTarget | null,
	now: number,
	normalDue: number,
): AiringSchedule {
	const previous = sub.schedule;
	const info = target?.airing;
	let episode = sub.startEpisode;
	const available = new Set(target?.availableEpisodes ?? []);
	while (episode <= 10000 && available.has(episode)) episode++;
	const result: AiringSchedule = {
		reason: "fallback",
		episode: episode <= 10000 ? episode : null,
		airingAt: null,
		nextCheckAt: normalDue,
		metadataCheckAt: now + airingPolicy.metadataIntervalMs,
		metadataFetchedAt: info?.fetchedAt ?? null,
		metadataFresh: false,
		assessedAt: now,
		lastAttemptAt: previous?.lastAttemptAt ?? null,
		wakeAt: previous?.wakeAt ?? null,
	};
	const validFetchedAt =
		info &&
		Number.isSafeInteger(info.fetchedAt) &&
		info.fetchedAt >= 0 &&
		info.fetchedAt <= now;
	const fresh = Boolean(
		validFetchedAt &&
			!info?.stale &&
			!info?.refreshError &&
			now - info.fetchedAt < airingPolicy.metadataIntervalMs,
	);
	result.metadataFresh = fresh;
	if (validFetchedAt)
		result.metadataCheckAt = Math.max(
			now + 30_000,
			info.fetchedAt + airingPolicy.metadataIntervalMs,
		);
	const next = info?.nextEpisode;
	const validNext =
		next &&
		Number.isSafeInteger(next.episode) &&
		next.episode >= 1 &&
		next.episode <= 10000 &&
		Number.isSafeInteger(next.airingAt) &&
		next.airingAt > 0 &&
		(target?.work.episodeCount == null ||
			next.episode <= target.work.episodeCount);
	const consistent =
		info?.status === "RELEASING" ||
		(info?.status === "NOT_YET_RELEASED" &&
			(!next || (validNext && next.episode === 1 && next.airingAt > now)));
	if (fresh && consistent && (!next || validNext)) {
		if (validNext && next) {
			if (
				(next.episode < episode && next.airingAt > now) ||
				(next.episode === episode && next.airingAt > now)
			) {
				result.reason =
					info?.status === "NOT_YET_RELEASED"
						? "waiting_for_premiere"
						: "waiting_for_episode";
				// Never extrapolate the airing time for a later accepted starting episode.
				result.airingAt = next.episode === episode ? next.airingAt : null;
				result.nextCheckAt =
					result.airingAt == null
						? null
						: result.airingAt + airingPolicy.releaseDelayMs;
				result.metadataCheckAt = Math.min(
					result.metadataCheckAt,
					Math.max(now + 30_000, next.airingAt),
				);
			} else if (
				next.episode === episode &&
				now < next.airingAt + airingPolicy.releaseDelayMs
			) {
				result.reason = "release_delay";
				result.airingAt = next.airingAt;
				result.nextCheckAt = next.airingAt + airingPolicy.releaseDelayMs;
			} else {
				result.reason =
					next.episode > episode
						? "backlog"
						: next.episode === episode
							? "due"
							: "fallback";
			}
		} else if (info?.status === "NOT_YET_RELEASED") {
			result.reason = "waiting_for_premiere";
			result.nextCheckAt = null;
		}
	} else if (fresh && info?.status === "FINISHED" && !next)
		result.reason = "backlog";
	// Retain the known release allowance when a fresh provider response rolls to the next episode.
	if (
		fresh &&
		info?.status === "RELEASING" &&
		previous?.episode === episode &&
		previous.airingAt != null &&
		previous.airingAt <= now &&
		now < previous.airingAt + airingPolicy.releaseDelayMs &&
		validNext &&
		next &&
		next.episode > episode
	) {
		result.reason = "release_delay";
		result.airingAt = previous.airingAt;
		result.nextCheckAt = previous.airingAt + airingPolicy.releaseDelayMs;
	}
	// Cache expiry at an airing boundary initiates a provider refresh. Keep the known
	// deadline during that bounded refresh, but a failed refresh immediately falls back.
	if (
		!fresh &&
		validFetchedAt &&
		info.refreshing &&
		!info.refreshError &&
		previous &&
		waitingForAiring(previous) &&
		previous.metadataFetchedAt === info.fetchedAt &&
		(now < info.fetchedAt + airingPolicy.metadataIntervalMs + 30_000 ||
			(previous.airingAt !== null &&
				previous.airingAt <= now &&
				now < previous.airingAt + airingPolicy.releaseDelayMs))
	) {
		result.reason =
			previous.airingAt !== null && previous.airingAt <= now
				? "release_delay"
				: previous.reason;
		result.airingAt = previous.airingAt;
		result.nextCheckAt = previous.nextCheckAt;
		result.metadataCheckAt = now + 30_000;
	}

	if (!waitingForAiring(result)) {
		if (previous && waitingForAiring(previous)) result.wakeAt = now;
		if (
			result.wakeAt != null &&
			(result.lastAttemptAt == null || result.lastAttemptAt < result.wakeAt)
		)
			result.nextCheckAt = Math.min(normalDue, result.wakeAt);
	} else result.wakeAt = null;
	return result;
}
