import type { TrackingAccountResponse } from "../src/shared/api/contracts.js";
export const trackingProvider: TrackingAccountResponse["provider"] = {
	key: "anilist",
	name: "AniList",
	authorization: {
		kind: "credential",
		label: "Access token",
		url: "https://anilist.co/api/v2/oauth/authorize?client_id=53902&response_type=token",
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
