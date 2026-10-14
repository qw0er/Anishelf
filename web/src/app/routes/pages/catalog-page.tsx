import { AnimeLibrary } from "../../../features/anime/ui.js";
import { useAppRuntime } from "../../runtime/context.js";
export function CatalogPage() {
	const { settings, library } = useAppRuntime();
	return (
		<AnimeLibrary
			resourceRoot={settings?.resourceRoot ?? null}
			ready={library?.ready ?? false}
		/>
	);
}
