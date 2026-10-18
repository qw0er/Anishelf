import {
	externalId,
	externalIdParts,
	workKey,
	workReference,
} from "../../../../shared/external-reference.js";
import { aniListAuthorization } from "../../anilist/policy.js";
import type {
	AniListListEntry,
	AniListRemoteState,
} from "../../anilist/public.js";
import type { ViewingStatus } from "../domain/list.js";
import { TrackingProviderError } from "../domain/list.js";
import type { TrackingProviderDescriptor } from "../domain/model.js";
export const aniListTracking: TrackingProviderDescriptor = {
	key: "anilist",
	name: "AniList",
	authorization: {
		kind: "credential",
		label: "Access token",
		url: aniListAuthorization.authorizationUrl,
	},
	capabilities: {
		progress: "cumulative-episodes",
		maximumProgress: 2147483647,
		statuses: [
			"watching",
			"planned",
			"completed",
			"paused",
			"dropped",
			"rewatching",
		],
	},
};
const statuses = {
	CURRENT: "watching",
	PLANNING: "planned",
	COMPLETED: "completed",
	PAUSED: "paused",
	DROPPED: "dropped",
	REPEATING: "rewatching",
} as const;
function fromAniListStatus(status: AniListListEntry["status"]): ViewingStatus {
	return statuses[status];
}
export function toAniListStatus(
	status: ViewingStatus,
): AniListListEntry["status"] {
	const entry = Object.entries(statuses).find(([, value]) => value === status);
	if (!entry) throw new TrackingProviderError("invalid-request", null);
	return entry[0] as AniListListEntry["status"];
}
export function aniListWork(id: number): string {
	return workKey({ provider: "anilist", mediaType: "anime", id: String(id) });
}
export function aniListId(key: string, work = false): number {
	try {
		const ref = work ? workReference(key) : externalIdParts(key);
		const id = Number(ref.id);
		if (
			ref.provider !== "anilist" ||
			!/^[1-9][0-9]*$/.test(ref.id) ||
			!Number.isSafeInteger(id) ||
			id > 2147483647
		)
			throw new Error("Invalid ID.");
		return id;
	} catch {
		throw new TrackingProviderError("invalid-request", null);
	}
}
export function fromAniListRemote(remote: AniListRemoteState) {
	return {
		...remote,
		id: externalId("anilist", String(remote.id)),
		status: fromAniListStatus(remote.status),
		updatedAt: remote.updatedAt * 1000,
	};
}
