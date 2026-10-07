import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	redirect,
} from "react-router";
import { isRequestCancelled, saveSettings, startScan } from "../api/client.js";
import {
	directoryQuery,
	fileQuery,
	historyQuery,
	libraryQuery,
	settingsQuery,
} from "../api/queries.js";
import {
	executeMutation,
	loadQuery,
	queryClient,
} from "../api/query-client.js";
import { toast } from "../components/ui/toast.js";
import { libraryPolicy, preparationPolicy } from "../config/media-policy.js";
import i18n from "../i18n.js";
import { getErrorTranslationKey } from "../lib/error-translation.js";

export async function libraryLoader({ request }: LoaderFunctionArgs) {
	try {
		const [library, settings] = await Promise.all([
			loadQuery({ ...libraryQuery(), staleTime: 0 }, request.signal),
			loadQuery({ ...settingsQuery(), staleTime: 0 }, request.signal),
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
	toast.close("settings-save");
	const form = await request.formData();
	const resourceRoot = form.get("resourceRoot");
	if (typeof resourceRoot !== "string" || resourceRoot.trim() === "")
		return { error: "errors.resourcePathRequired" };

	const cache = form.get("transcodeCacheBudgetGiB");
	const transcodeCacheBudgetGiB = cache === null ? undefined : Number(cache);
	if (
		cache !== null &&
		(typeof cache !== "string" ||
			cache.trim() === "" ||
			!Number.isSafeInteger(transcodeCacheBudgetGiB) ||
			Number(transcodeCacheBudgetGiB) < 1 ||
			Number(transcodeCacheBudgetGiB) > preparationPolicy.maximumCacheBudgetGiB)
	)
		return { error: "settingsPage.invalidCacheBudget" };
	const interval = form.get("scanIntervalMinutes");
	const scanIntervalMinutes = interval === null ? undefined : Number(interval);
	if (
		interval !== null &&
		(typeof interval !== "string" ||
			interval.trim() === "" ||
			!Number.isSafeInteger(scanIntervalMinutes) ||
			Number(scanIntervalMinutes) < 0 ||
			Number(scanIntervalMinutes) > libraryPolicy.maximumScanIntervalMinutes)
	)
		return {
			error: "settingsPage.invalidInterval",
			maximumMinutes: libraryPolicy.maximumScanIntervalMinutes,
		};
	try {
		await executeMutation(() =>
			saveSettings(
				{
					resourceRoot,
					...(transcodeCacheBudgetGiB === undefined
						? {}
						: { transcodeCacheBudgetGiB }),
					...(scanIntervalMinutes === undefined ? {} : { scanIntervalMinutes }),
				},
				{ signal: request.signal },
			),
		);
		await queryClient.invalidateQueries({ refetchType: "none" });
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

export async function scanAction({ request }: ActionFunctionArgs) {
	toast.close("scan-start");
	try {
		return {
			scan: (await executeMutation(() => startScan({ signal: request.signal })))
				.scan,
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

export async function historyLoader({ request }: LoaderFunctionArgs) {
	await warmScope(request);
	return loadQuery(historyQuery(routeScope()), request.signal);
}

function routeScope() {
	return JSON.stringify([
		queryClient.getQueryData(settingsQuery().queryKey)?.resourceRoot,
		queryClient.getQueryData(libraryQuery().queryKey)?.revision,
	]);
}

async function warmScope(request: Request) {
	await Promise.all([
		loadQuery(settingsQuery(), request.signal),
		loadQuery(libraryQuery(), request.signal),
	]).catch((error) => {
		if (request.signal.aborted || isRequestCancelled(error)) throw error;
	});
}
