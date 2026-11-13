import { type LoaderFunctionArgs, redirect } from "react-router";
import { directoryQuery, fileQuery } from "../../features/resources/public.js";
import { loadQuery } from "../../shared/api/query-client.js";
import { directoryPath } from "../../shared/navigation.js";

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

/** Resolve the current parent lazily without entering playback or creating a session. */
export async function locateFileLoader(args: LoaderFunctionArgs) {
	const { file } = await fileLoader(args);
	return redirect(
		`${directoryPath(file.parentId)}#${encodeURIComponent(`file-${file.id}`)}`,
	);
}
