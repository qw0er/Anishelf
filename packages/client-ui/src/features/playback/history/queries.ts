const historyKeys = {
	history: (scope: string) => ["history", scope] as const,
};

import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import { readRetryOptions } from "../../../shared/api/read-retry.js";
import * as api from "./api.js";

export const historyQuery = (scope: string) =>
	queryOptions({
		...readRetryOptions("history"),
		queryKey: historyKeys.history(scope),
		queryFn: ({ signal }) => api.getHistory({ signal: boundedSignal(signal) }),
	});
