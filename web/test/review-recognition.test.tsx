// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { SourceSummary } from "../src/features/anime/review/components/source-summary.js";
import { useReviewController } from "../src/features/anime/review/use-review-controller.js";
import { queryClient } from "../src/shared/api/query-client.js";
import "../src/shared/i18n.js";
import { reviewFixture } from "./fixtures/anime.js";
import {
	act,
	cleanup,
	render,
	renderHook,
	screen,
} from "./query-test-utils.js";

vi.mock("../src/features/anime/metadata/public.js", () => ({
	metadataSearchQuery: () => ({
		queryKey: ["test-search"],
		queryFn: async () => null,
	}),
	metadataDetailQuery: (provider: string, id: string) => ({
		queryKey: ["test-detail", provider, id],
		queryFn: async () => null,
	}),
}));
afterEach(() => {
	cleanup();
	queryClient.clear();
});

function identified() {
	const item = reviewFixture();
	item.recognizedWork = {
		reference: { provider: "anilist", mediaType: "anime", id: "123" },
		title: "Ocean",
		mappingStatus: "pending",
	};
	return item;
}
test("recognized work preselects details while preserving the user's later selection", () => {
	const item = identified();
	const { result, rerender } = renderHook(
		({ item }) => useReviewController(item),
		{ initialProps: { item } },
	);
	expect(result.current.reference).toEqual(item.recognizedWork?.reference);
	expect(result.current.preview).toBeNull();
	act(() =>
		result.current.selectWork({
			provider: "anilist",
			mediaType: "anime",
			id: "456",
		}),
	);
	rerender({ item: { ...item, revision: item.revision + 1 } });
	expect(result.current.reference?.id).toBe("456");
});
test("unavailable sources do not preselect, and confirmed associations take precedence", () => {
	const item = identified();
	item.available = false;
	expect(
		renderHook(() => useReviewController(item)).result.current.reference,
	).toBeNull();
	const confirmed = reviewFixture(true);
	confirmed.recognizedWork = item.recognizedWork ?? {
		reference: { provider: "anilist", mediaType: "anime", id: "123" },
		title: "Ocean",
		mappingStatus: "pending",
	};
	expect(
		renderHook(() => useReviewController(confirmed)).result.current.reference,
	).toEqual(confirmed.associations[0]?.reference);
});
test("Review shows recognized work separately from unresolved episode mapping", () => {
	render(
		<MemoryRouter>
			<SourceSummary item={identified()} />
		</MemoryRouter>,
	);
	expect(
		screen.getByText(
			"Work identified: Ocean. Episode mapping needs confirmation.",
		),
	).toBeTruthy();
});
