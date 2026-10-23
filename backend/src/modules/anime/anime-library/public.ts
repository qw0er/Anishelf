import type { AnimeLibraryQuery, LibraryResult } from "./domain/model.js";
export interface AnimeLibraryApi {
	list(query?: AnimeLibraryQuery, generation?: string): Promise<LibraryResult>;
}
