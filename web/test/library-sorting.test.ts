import { expect, test } from "vitest";
import {
	libraryFilters,
	librarySearch,
} from "../src/features/anime/library/api.js";

test("library defaults to unwatched first and preserves explicit sorts through URLs", () => {
	for (const query of ["", "sort=invalid"])
		expect(libraryFilters(new URLSearchParams(query)).sort).toBe("unwatched");
	for (const sort of ["title", "recent", "updated", "unwatched"] as const) {
		const search = librarySearch({ sort, page: 1 });
		expect(libraryFilters(new URLSearchParams(search)).sort).toBe(sort);
		expect(new URLSearchParams(search).has("sort")).toBe(sort !== "unwatched");
	}
});
