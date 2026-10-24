import { useOutletContext } from "react-router";
import type { LibraryScanState } from "../../features/resources/public.js";
import type { SettingsResponse } from "../../shared/api/contracts.js";
export interface AppRuntime extends Omit<LibraryScanState, "settings"> {
	settings: SettingsResponse | null;
}
export const useAppRuntime = () => useOutletContext<AppRuntime>();
