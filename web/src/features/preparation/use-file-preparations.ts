import { usePreparations } from "./use-preparations.js";
/** Each file list has a single cache owner, including outputs outside the global window. */
export function useFilePreparations(fileId: string, enabled = true) {
	return usePreparations(fileId, enabled);
}
