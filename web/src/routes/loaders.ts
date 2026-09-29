import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
	ApiClientError,
	getDirectory,
	getFile,
	getLibrary,
	isRequestCancelled,
	startScan,
} from "../api/client.js";

export async function libraryLoader({ request }: LoaderFunctionArgs) {
	try {
		return {
			library: await getLibrary({ signal: request.signal }),
			error: null,
		};
	} catch (error) {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
		return {
			library: null,
			error:
				error instanceof ApiClientError
					? error.message
					: "Could not load library status.",
		};
	}
}

export function directoryLoader({ params, request }: LoaderFunctionArgs) {
	return getDirectory(params.id ?? "root", { signal: request.signal });
}

export function fileLoader({ params, request }: LoaderFunctionArgs) {
	return getFile(params.id ?? "", { signal: request.signal });
}

export async function scanAction({ request }: ActionFunctionArgs) {
	try {
		return {
			scan: (await startScan({ signal: request.signal })).scan,
			error: null,
		};
	} catch (error) {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
		return {
			scan: null,
			error:
				error instanceof ApiClientError
					? error.message
					: "Could not start scanning.",
		};
	}
}
