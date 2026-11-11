// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test } from "vitest";
import { SourceSummary } from "../../../src/features/anime/review/components/source-summary.js";
import { reviewFixture } from "../../fixtures/anime.js";
import "../../../src/shared/i18n.js";

afterEach(cleanup);
test("download provenance and filename differences are informative, not an ingestion error", () => {
	const item = reviewFixture(true);
	item.decisionOrigin = "acquisition";
	item.acquisition = {
		intentId: "download",
		candidateId: "release",
		title: "Accepted release title",
		hash: "hash",
		transfer: "seeding",
		target: {
			workKey: "anilist:anime:1",
			reference: { id: "work" },
			episode: 3,
			snapshotId: "snapshot",
		},
		warnings: ["filename_target_unconfirmed"],
	};
	render(
		<MemoryRouter>
			<SourceSummary item={item} />
		</MemoryRouter>,
	);
	expect(
		screen.getByText(
			"Associated with the accepted download target: episode 3.",
		),
	).toBeTruthy();
	expect(screen.getByText("Accepted release title")).toBeTruthy();
	expect(
		screen.getByText(
			"Filename evidence differs or is incomplete; the verified download target takes precedence.",
		),
	).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
});
