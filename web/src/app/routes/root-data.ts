import type { LoaderFunctionArgs } from "react-router";
import { libraryQuery } from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { isRequestCancelled } from "../../shared/api/client.js";
import { loadQuery } from "../../shared/api/query-client.js";
import { getErrorTranslationKey } from "../../shared/lib/error-translation.js";

export async function libraryLoader({ request }: LoaderFunctionArgs) {
	try {
		const [library, settings] = await Promise.all([
			loadQuery(libraryQuery(), request.signal),
			loadQuery(settingsQuery(), request.signal),
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
