import { animeFixture, reviewFixture } from "../../fixtures/anime.js";
import { fireEvent, screen } from "../../support/query-test-utils.js";

import { fetcher, json } from "./state.js";
export function mockReview(confirmed = false) {
	const item = reviewFixture(confirmed);
	const detail = animeFixture();
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/catalog/reviews?"))
			return json({ items: [item], page: 1, perPage: 20, hasNextPage: false });
		if (path === `/api/catalog/reviews/${item.id}`) return json(item);
		if (path.startsWith("/api/metadata/search?"))
			return json({
				...detail.metadata,
				data: {
					items: [detail.metadata.data],
					page: 1,
					perPage: 10,
					hasNextPage: false,
				},
			});
		if (path === "/api/metadata/metadata-work-1") return json(detail.metadata);
		if (path === "/api/catalog/previews") {
			const body = JSON.parse(String(init?.body));
			const row = body.rows[0];
			return json({
				id: "preview-1",
				expiresAt: Date.now() + 60000,
				reference: body.reference,
				workId: confirmed ? "work-1" : null,
				workRevision: confirmed ? 1 : null,
				metadata: detail.metadata,
				rows: [
					{
						reviewId: item.id,
						revision: item.revision,
						relativePath: item.relativePath,
						rawNumbers: item.evidence.rawEpisodes,
						before: item.associations.map(
							({ workId, episodeId, kind, number }) => ({
								workId,
								episodeId,
								kind,
								number,
							}),
						),
						targets: row.targets.map(
							(target: { kind: string; number: string }) => ({
								...target,
								number:
									target.kind === "regular"
										? String(Number(target.number) + row.offset)
										: target.number,
							}),
						),
						offset: row.offset,
						reason: row.reason,
					},
				],
			});
		}
		if (path === "/api/catalog/confirmations") {
			item.decision = "confirmed";
			item.revision += 1;
			return json({ workId: "work-1", revision: 2, reviewIds: [item.id] });
		}
		if (path === `/api/catalog/reviews/${item.id}/remove`) {
			item.associations = [];
			item.decision = "rejected";
			item.revision += 1;
			return json(item);
		}
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	return item;
}

export async function selectReviewWork() {
	const input = await screen.findByLabelText("Provider ID or work URL");
	fireEvent.change(input, {
		target: { value: "https://anilist.co/anime/154587/Frieren" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Look up" }));
	await screen.findByLabelText("Episode numbers");
}
