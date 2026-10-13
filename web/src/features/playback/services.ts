import { historyQuery as internal_historyQuery } from "./history/queries.js";
export const historyQuery = (
	...args: Parameters<typeof internal_historyQuery>
) => internal_historyQuery(...args);
