import type { LoaderFunctionArgs } from "react-router";
import {
	catalogFilters,
	catalogQuery,
	workQuery,
} from "../../features/anime/public.js";
import { libraryQuery } from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { loadQuery, queryClient } from "../../shared/api/query-client.js";

import { routeScope, warmScope } from "./loader-scope.js";
export async function catalogLoader({ request }: LoaderFunctionArgs) {
	await warmScope(request);
	const settings = queryClient.getQueryData(settingsQuery().queryKey);
	const library = queryClient.getQueryData(libraryQuery().queryKey);
	if (!settings?.resourceRoot || !library?.ready) return null;
	return loadQuery(
		catalogQuery(
			catalogFilters(new URL(request.url).searchParams),
			routeScope(),
		),
		request.signal,
	);
}
export async function animeLoader({ request, params }: LoaderFunctionArgs) {
	await warmScope(request);
	return loadQuery(workQuery(params.id ?? "", routeScope()), request.signal);
}
