import type {
	LibraryResponse,
	SettingsResponse,
} from "../../../shared/api/contracts.js";
export interface LibraryContext {
	playerVersion: number;
	reload(): void;
	settings: SettingsResponse | null;
	library: LibraryResponse | null;
	libraryError: string | null;
	scanning: boolean;
	scanPending: boolean;
	scanSubmitting: boolean;
	refreshing: boolean;
	startScan(): void;
}
