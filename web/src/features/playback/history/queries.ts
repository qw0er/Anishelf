const historyKeys = {
	history: (scope: string) => ["history", scope] as const,
};

import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import * as api from "./api.js";

export const historyQuery = (scope: string) =>
	queryOptions({
		queryKey: historyKeys.history(scope),
		queryFn: ({ signal }) => api.getHistory({ signal: boundedSignal(signal) }),
	});
