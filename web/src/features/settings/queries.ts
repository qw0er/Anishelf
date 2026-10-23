export const settingsKeys = {
	settings: ["settings"] as const,
	profiles: ["profiles"] as const,
};

import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../shared/api/queries.js";
import * as api from "./api.js";

export const settingsQuery = () =>
	queryOptions({
		queryKey: settingsKeys.settings,
		queryFn: ({ signal }) => api.getSettings({ signal: boundedSignal(signal) }),
	});
export const profilesQuery = () =>
	queryOptions({
		queryKey: settingsKeys.profiles,
		queryFn: ({ signal }) =>
			api.getTranscodeProfiles({ signal: boundedSignal(signal) }),
	});
