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
