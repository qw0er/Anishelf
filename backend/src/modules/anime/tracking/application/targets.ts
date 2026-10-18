import { workKey } from "../../../../shared/external-reference.js";
import type { TrackingTargetResolver } from "../ports.js";
/** Only exact provider identities establish a target; cross-provider mappings need evidence. */
export class ExactTrackingTargets implements TrackingTargetResolver {
	resolve(
		...[reference, episode, provider]: Parameters<
			TrackingTargetResolver["resolve"]
		>
	): ReturnType<TrackingTargetResolver["resolve"]> {
		if (reference.provider !== provider.key) return { state: "unmapped" };
		if (
			!reference.id ||
			!Number.isSafeInteger(episode) ||
			episode < 1 ||
			episode > provider.capabilities.maximumProgress
		)
			return { state: "unsupported" };
		return { state: "resolved", mediaId: workKey(reference), episode };
	}
}
