// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { WorkMetadataHeader } from "../../../src/features/anime/catalog/components/work-metadata-header.js";
import "../../../src/shared/i18n.js";
import { animeFixture } from "../../fixtures/anime.js";
import { cleanup, render, screen } from "../../support/query-test-utils.js";

afterEach(cleanup);

test("keeps playback and viewing available without alternative titles or banner", () => {
	const data = animeFixture();
	data.work.coverUrl = null;
	render(
		<WorkMetadataHeader
			data={data}
			action={<button type="button">Play next</button>}
			viewing={<button type="button">Edit progress</button>}
		/>,
	);
	const play = screen.getByRole("button", { name: "Play next" });
	const progress = screen.getByRole("button", { name: "Edit progress" });
	expect(
		play.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: /show.*titles/i })).toBeNull();
});

test("hides all alternative names while retaining the chosen title and source", () => {
	const data = animeFixture();
	data.metadata.data.titles.push({
		value: "Hidden cross-source alias",
		kind: "alias",
		language: null,
	});
	render(<WorkMetadataHeader data={data} />);
	expect(
		screen.getByRole("heading", { name: data.work.displayTitle }),
	).toBeTruthy();
	expect(screen.queryByText("Hidden cross-source alias")).toBeNull();
	expect(screen.queryByRole("button", { name: /titles/i })).toBeNull();
});
