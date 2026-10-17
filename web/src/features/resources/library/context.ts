import type {
	LibraryResponse,
	SettingsResponse,
} from "../../../shared/api/contracts.js";
export interface LibraryScanState {
	reload(): void;
	settings: Pick<SettingsResponse, "resourceRoot"> | null;
	library: LibraryResponse | null;
	libraryError: string | null;
	scanning: boolean;
	scanPending: boolean;
	scanSubmitting: boolean;
	refreshing: boolean;
	startScan(): void;
}

/** Resource configuration is interpreted here, not by resource consumers. */
export function resourceContext(
	settings: Pick<SettingsResponse, "resourceRoot"> | null | undefined,
	library: Pick<LibraryResponse, "revision" | "ready"> | null | undefined,
) {
	const identity = settings?.resourceRoot ?? "unconfigured";
	return {
		identity,
		scope: JSON.stringify([settings?.resourceRoot, library?.revision]),
		configured: Boolean(settings?.resourceRoot),
		ready: Boolean(settings?.resourceRoot && library?.ready),
	};
}
