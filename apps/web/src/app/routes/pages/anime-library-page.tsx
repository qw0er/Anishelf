import { AnimeLibrary } from "../../../features/anime/ui.js";
import { resourceContext } from "../../../features/resources/public.js";
import { useAppRuntime } from "../../runtime/context.js";
export function AnimeLibraryPage() {
	const { settings, library } = useAppRuntime();
	const resources = resourceContext(settings, library);
	return (
		<AnimeLibrary configured={resources.configured} ready={resources.ready} />
	);
}
