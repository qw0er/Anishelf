import type { LoaderFunctionArgs } from "react-router";
import {
	accountQuery,
	catalogFilters,
	catalogQuery,
	trackingIdentity,
	workQuery,
} from "../../features/anime/public.js";
import { libraryQuery } from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { loadQuery, queryClient } from "../../shared/api/query-client.js";

import { routeScope, warmScope } from "./loader-scope.js";
export async function catalogLoader({ request }: LoaderFunctionArgs) {
	await warmScope(request);
	const identity = await queryClient
		.fetchQuery(accountQuery())
		.then(trackingIdentity)
		.catch(() => undefined);
	const filters = catalogFilters(new URL(request.url).searchParams);
	const settings = queryClient.getQueryData(settingsQuery().queryKey);
	const library = queryClient.getQueryData(libraryQuery().queryKey);
	if ((!settings?.resourceRoot || !library?.ready) && filters.scope !== "all")
		return null;
	return loadQuery(
		catalogQuery(filters, routeScope(), identity),
		request.signal,
	);
}
export async function animeLoader({ request, params }: LoaderFunctionArgs) {
	await warmScope(request);
	return loadQuery(workQuery(params.id ?? "", routeScope()), request.signal);
}
