import type { LoaderFunctionArgs } from "react-router";
import { historyQuery } from "../../features/playback/public.js";
import { loadQuery } from "../../shared/api/query-client.js";

import { routeScope, warmScope } from "./loader-scope.js";
export async function historyLoader({ request }: LoaderFunctionArgs) {
	await warmScope(request);
	return loadQuery(historyQuery(routeScope()), request.signal);
}
