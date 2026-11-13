import type { AcquisitionTarget } from "../../../anime/public.js";
import type { Subscription } from "./model.js";

/** Only verified local episodes cover the saved subscription range. */
export function coveredEpisodeCount(
	subscription: Pick<Subscription, "startEpisode">,
	target: AcquisitionTarget,
): number | null {
	const total = target.work.episodeCount;
	if (
		total === null ||
		!Number.isSafeInteger(total) ||
		total < subscription.startEpisode ||
		total > 10000
	)
		return null;
	const available = new Set(target.availableEpisodes);
	for (let episode = subscription.startEpisode; episode <= total; episode++)
		if (!available.has(episode)) return null;
	return total;
}
