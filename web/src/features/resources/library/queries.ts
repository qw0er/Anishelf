import { libraryInteractionPolicy } from "./policy.js";

const libraryKeys = {
	library: ["library"] as const,
	directory: (id: string, scope: string) => ["directory", scope, id] as const,
};

import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import * as api from "./api.js";

export const libraryQuery = () =>
	queryOptions({
		queryKey: libraryKeys.library,
		queryFn: ({ signal }) => api.getLibrary({ signal: boundedSignal(signal) }),
		refetchInterval: (query) =>
			query.state.data?.scan?.status === "running"
				? libraryInteractionPolicy.scanPollIntervalMs
				: false,
	});
export const directoryQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: libraryKeys.directory(id, scope),
		queryFn: ({ signal }) =>
			api.getDirectory(id, { signal: boundedSignal(signal) }),
	});
