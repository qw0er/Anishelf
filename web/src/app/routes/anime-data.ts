import type { LoaderFunctionArgs } from "react-router";
import { localWorkDetailQuery } from "../../features/anime/public.js";
import { loadQuery } from "../../shared/api/query-client.js";

import { routeScope, warmScope } from "./loader-scope.js";
export async function animeLoader({ request, params }: LoaderFunctionArgs) {
	await warmScope(request);
	return loadQuery(
		localWorkDetailQuery(params.id ?? "", routeScope()),
		request.signal,
	);
}
