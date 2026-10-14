import { libraryQuery } from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { isRequestCancelled } from "../../shared/api/client.js";
import { loadQuery, queryClient } from "../../shared/api/query-client.js";

export function routeScope() {
	return JSON.stringify([
		queryClient.getQueryData(settingsQuery().queryKey)?.resourceRoot,
		queryClient.getQueryData(libraryQuery().queryKey)?.revision,
	]);
}

export async function warmScope(request: Request) {
	await Promise.all([
		loadQuery(settingsQuery(), request.signal),
		loadQuery(libraryQuery(), request.signal),
	]).catch((error) => {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
	});
}
