import type {
	LibraryResponse,
	SettingsResponse,
} from "../../../shared/api/contracts.js";
export interface LibraryScanState {
	reload(): void;
	settings: Pick<SettingsResponse, "resourceRoots"> | null;
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
	settings: Pick<SettingsResponse, "resourceRoots"> | null | undefined,
	library: Pick<LibraryResponse, "revision" | "ready"> | null | undefined,
) {
	const identity = JSON.stringify(settings?.resourceRoots ?? []);
	return {
		identity,
		scope: JSON.stringify([settings?.resourceRoots, library?.revision]),
		configured: Boolean(settings?.resourceRoots.length),
		ready: Boolean(settings?.resourceRoots.length && library?.ready),
	};
}
