import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../shared/api/queries.js";
import * as api from "./api.js";

const resourceKeys = {
	file: (id: string, scope: string) => ["file", scope, id] as const,
};
export const fileQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: resourceKeys.file(id, scope),
		queryFn: ({ signal }) => api.getFile(id, { signal: boundedSignal(signal) }),
	});
