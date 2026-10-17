import {
	libraryQuery,
	resourceContext,
} from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { isRequestCancelled } from "../../shared/api/client.js";
import { loadQuery, queryClient } from "../../shared/api/query-client.js";

export function routeScope() {
	return resourceContext(
		queryClient.getQueryData(settingsQuery().queryKey),
		queryClient.getQueryData(libraryQuery().queryKey),
	).scope;
}

export async function warmScope(request: Request) {
	await Promise.all([
		loadQuery(settingsQuery(), request.signal),
		loadQuery(libraryQuery(), request.signal),
	]).catch((error) => {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
	});
}
