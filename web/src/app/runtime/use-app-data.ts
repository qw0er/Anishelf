import { useQuery } from "@tanstack/react-query";
import { libraryQuery } from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { getErrorTranslationKey } from "../../shared/lib/error-translation.js";
import type { libraryLoader } from "../routes/root-data.js";

export function useAppData(initial: Awaited<ReturnType<typeof libraryLoader>>) {
	const status = useQuery({
		...libraryQuery(),
		...(initial.library ? { initialData: initial.library } : {}),
	});
	const configuration = useQuery({
		...settingsQuery(),
		...(initial.settings ? { initialData: initial.settings } : {}),
	});
	const library = status.data ?? null;
	const settings = configuration.data ?? null;
	const libraryError =
		status.error || configuration.error
			? (getErrorTranslationKey(status.error ?? configuration.error) ??
				"errors.libraryStatus")
			: initial.error && !library
				? initial.error
				: null;
	return { library, settings, libraryError };
}
