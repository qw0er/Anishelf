import { type LoaderFunctionArgs, redirect } from "react-router";
import { fileQuery } from "../../features/resources/public.js";
import { loadQuery } from "../../shared/api/query-client.js";
import { directoryPath } from "../../shared/navigation.js";

import { routeScope, warmScope } from "./loader-scope.js";
/** Resolve the current parent without entering playback or creating a session. */
export async function locateFileLoader({
	params,
	request,
}: LoaderFunctionArgs) {
	await warmScope(request);
	const { file } = await loadQuery(
		fileQuery(params.id ?? "", routeScope()),
		request.signal,
	);
	return redirect(
		`${directoryPath(file.parentId)}#${encodeURIComponent(`file-${file.id}`)}`,
	);
}
