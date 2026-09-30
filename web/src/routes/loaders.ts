import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	redirect,
} from "react-router";
import {
	getDirectory,
	getFile,
	getLibrary,
	getSettings,
	isRequestCancelled,
	saveSettings,
	startScan,
} from "../api/client.js";
import { getErrorTranslationKey } from "../lib/error-translation.js";

export async function libraryLoader({ request }: LoaderFunctionArgs) {
	try {
		const [library, settings] = await Promise.all([
			getLibrary({ signal: request.signal }),
			getSettings({ signal: request.signal }),
		]);
		return {
			library,
			settings,
			error: null,
		};
	} catch (error) {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
		return {
			library: null,
			settings: null,
			error: getErrorTranslationKey(error) ?? "errors.libraryStatus",
		};
	}
}

export async function settingsAction({ request }: ActionFunctionArgs) {
	const form = await request.formData();
	const resourceRoot = form.get("resourceRoot");
	if (typeof resourceRoot !== "string" || resourceRoot.trim() === "")
		return { error: "errors.resourcePathRequired" };
	try {
		await saveSettings({ resourceRoot }, { signal: request.signal });
		return redirect("/");
	} catch (error) {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
		return {
			error: getErrorTranslationKey(error) ?? "errors.saveSettings",
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
			error: getErrorTranslationKey(error) ?? "errors.startScan",
		};
	}
}
