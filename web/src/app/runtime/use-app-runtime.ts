import { useLoaderData } from "react-router";
import type { libraryLoader } from "../routes/root-data.js";
import type { AppRuntime } from "./context.js";
import { useAppData } from "./use-app-data.js";
import { useManualRefresh } from "./use-manual-refresh.js";
import { useScans } from "./use-scans.js";
export function useAppRuntimeState(): AppRuntime {
	const initial = useLoaderData<typeof libraryLoader>();
	const data = useAppData(initial);
	const scan = useScans(data.library);
	const refresh = useManualRefresh(data.libraryError);
	return { ...data, ...scan, ...refresh };
}
