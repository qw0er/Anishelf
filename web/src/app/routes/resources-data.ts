import type { LoaderFunctionArgs } from "react-router";
import { directoryQuery, fileQuery } from "../../features/resources/public.js";
import { loadQuery } from "../../shared/api/query-client.js";

import { routeScope, warmScope } from "./loader-scope.js";
export async function directoryLoader({ params, request }: LoaderFunctionArgs) {
	await warmScope(request);
	return loadQuery(
		directoryQuery(params.id ?? "root", routeScope()),
		request.signal,
	);
}

export async function fileLoader({ params, request }: LoaderFunctionArgs) {
	await warmScope(request);
	return loadQuery(fileQuery(params.id ?? "", routeScope()), request.signal);
}
