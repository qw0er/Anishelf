import { type ActionFunctionArgs, redirect } from "react-router";
import { preparationPolicy } from "../../features/media/public.js";
import { saveSettings } from "../../features/settings/public.js";
import { isRequestCancelled } from "../../shared/api/client.js";
import { executeMutation, queryClient } from "../../shared/api/query-client.js";
import { toast } from "../../shared/components/ui/toast.js";
import i18n from "../../shared/i18n.js";
import { getErrorTranslationKey } from "../../shared/lib/error-translation.js";

export async function settingsAction({ request }: ActionFunctionArgs) {
	toast.close("settings-save");
	const form = await request.formData();
	const paths = form.get("resourceRoots");
	if (typeof paths !== "string")
		return { error: "errors.resourcePathRequired" };
	const resourceRoots = paths
		.split(/\r?\n/)
		.map((path) => path.trim())
		.filter(Boolean);
	if (
		resourceRoots.length > 64 ||
		new Set(resourceRoots).size !== resourceRoots.length
	)
		return { error: "errors.resourcePathsInvalid" };

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
	try {
		await executeMutation(() =>
			saveSettings(
				{
					resourceRoots,
					...(transcodeCacheBudgetGiB === undefined
						? {}
						: { transcodeCacheBudgetGiB }),
				},
				{ signal: request.signal },
			),
		);
		await queryClient.invalidateQueries({
			queryKey: ["settings"],
			refetchType: "none",
		});
		await queryClient.cancelQueries({
			predicate: (query) =>
				[
					"library",
					"directory",
					"file",
					"anime-detail",
					"anime-status",
					"anime-library",
					"catalog",
					"preparations",
					"playback-selection",
					"history",
				].includes(String(query.queryKey[0])),
		});
		await queryClient.invalidateQueries({
			refetchType: "none",
			predicate: (query) =>
				[
					"library",
					"directory",
					"file",
					"anime-detail",
					"anime-status",
					"anime-library",
					"catalog",
					"preparations",
					"playback-selection",
					"history",
				].includes(String(query.queryKey[0])),
		});
		toast.add({
			type: "success",
			title: i18n.t("settingsPage.saved"),
			id: "settings-save",
		});
		return redirect("/directories/root");
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
