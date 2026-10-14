import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { libraryQuery, startScan } from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { isRequestCancelled } from "../../shared/api/client.js";
import { executeMutation, loadQuery } from "../../shared/api/query-client.js";
import { toast } from "../../shared/components/ui/toast.js";
import i18n from "../../shared/i18n.js";
import { getErrorTranslationKey } from "../../shared/lib/error-translation.js";

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
