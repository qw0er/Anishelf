import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	redirect,
} from "react-router";
import {
	getClientConfig,
	getDirectory,
	getFile,
	getHistory,
	getLibrary,
	getSettings,
	isRequestCancelled,
	saveSettings,
	startScan,
} from "../api/client.js";
import { toast } from "../components/ui/toast.js";
import i18n from "../i18n.js";
import { getErrorTranslationKey } from "../lib/error-translation.js";

export async function libraryLoader({ request }: LoaderFunctionArgs) {
	const clientConfig = await getClientConfig({ signal: request.signal });
	try {
		const [library, settings] = await Promise.all([
			getLibrary({ signal: request.signal }),
			getSettings({ signal: request.signal }),
		]);
		return {
			library,
			settings,
			clientConfig,
			error: null,
		};
	} catch (error) {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
		return {
			clientConfig,
			library: null,
			settings: null,
			error: getErrorTranslationKey(error) ?? "errors.libraryStatus",
		};
	}
}

export async function settingsAction({ request }: ActionFunctionArgs) {
	toast.close("settings-save");
	const form = await request.formData();
	const resourceRoot = form.get("resourceRoot");
	if (typeof resourceRoot !== "string" || resourceRoot.trim() === "")
		return { error: "errors.resourcePathRequired" };
	const clientConfig = await getClientConfig({ signal: request.signal });
	const interval = form.get("scanIntervalMinutes");
	const scanIntervalMinutes = interval === null ? undefined : Number(interval);
	if (
		interval !== null &&
		(typeof interval !== "string" ||
			interval.trim() === "" ||
			!Number.isSafeInteger(scanIntervalMinutes) ||
			Number(scanIntervalMinutes) < 0 ||
			Number(scanIntervalMinutes) >
				clientConfig.library.maximumScanIntervalMinutes)
	)
		return {
			error: "settingsPage.invalidInterval",
			maximumMinutes: clientConfig.library.maximumScanIntervalMinutes,
		};
	try {
		await saveSettings(
			{
				resourceRoot,
				...(scanIntervalMinutes === undefined ? {} : { scanIntervalMinutes }),
			},
			{ signal: request.signal },
		);
		toast.add({
			type: "success",
			title: i18n.t("settingsPage.saved"),
			id: "settings-save",
		});
		return redirect("/");
	} catch (error) {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
		const key = getErrorTranslationKey(error) ?? "errors.saveSettings";
		if (key === "errors.api.CONFIG_INVALID") return { error: key };
		toast.add({
			type: "error",
			priority: "high",
			title: i18n.t(key),
			id: "settings-save",
		});
		return { error: null };
	}
}

export function directoryLoader({ params, request }: LoaderFunctionArgs) {
	return getDirectory(params.id ?? "root", { signal: request.signal });
}

export function fileLoader({ params, request }: LoaderFunctionArgs) {
	return getFile(params.id ?? "", { signal: request.signal });
}

export async function scanAction({ request }: ActionFunctionArgs) {
	toast.close("scan-start");
	try {
		return {
			scan: (await startScan({ signal: request.signal })).scan,
		};
	} catch (error) {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
		toast.add({
			type: "error",
			priority: "high",
			title: i18n.t(getErrorTranslationKey(error) ?? "errors.startScan"),
			id: "scan-start",
		});
		return { scan: null };
	}
}

export function historyLoader({ request }: LoaderFunctionArgs) {
	return getHistory({ signal: request.signal });
}
