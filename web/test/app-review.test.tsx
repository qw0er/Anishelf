// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { queryClient } from "../src/shared/api/query-client.js";
import { toast } from "../src/shared/components/ui/toast.js";
import { animeFixture, reviewFixture } from "./fixtures/anime.js";
import { act, fireEvent, screen, waitFor, within } from "./query-test-utils.js";
import {
	fetcher,
	json,
	mockAnime,
	mockReview,
	renderApp,
	requiredFetch,
	selectReviewWork,
} from "./support/app-fixture.js";

test("Review displays explicit local numbering and previews that number instead of both raw tokens", async () => {
	const item = mockReview();
	item.evidence.rawEpisodes = ["29", "01"];
	item.evidence.selectedEpisodes = ["01"];
	item.evidence.numbering = "single";
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	expect(
		(screen.getByLabelText("Episode numbers") as HTMLInputElement).value,
	).toBe("1");
	expect(screen.getByText("Selected filename numbers")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	await screen.findByRole("heading", { name: "Association preview" });
	const call = fetcher.mock.calls.find(
		([input]) => String(input) === "/api/catalog/previews",
	);
	expect(JSON.parse(String(call?.[1]?.body)).rows[0].targets).toEqual([
		{ kind: "regular", number: "1" },
	]);
});

test("failed recognition can be manually looked up, corrected with an offset preview and admitted", async () => {
	const item = mockReview();
	mockAnime(animeFixture());
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "3" },
	});
	fireEvent.change(screen.getByLabelText("Regular numbering offset"), {
		target: { value: "-1" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	await screen.findByText("Episode 2", { exact: true });
	fireEvent.click(screen.getByRole("button", { name: "Confirm association" }));
	await screen.findByRole("button", { name: "Open anime" });
	const body = fetcher.mock.calls.find(
		([path]) => path === "/api/catalog/confirmations",
	)?.[1]?.body;
	expect(JSON.parse(String(body))).toMatchObject({
		previewId: "preview-1",
		replace: false,
	});
	expect(
		within(screen.getByRole("main")).queryByText("Association saved."),
	).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Open anime" }));
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
});

test("correcting an automatically associated file requires explicit replacement", async () => {
	const item = mockReview(true);
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "2" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	const confirm = await screen.findByRole("button", {
		name: "Confirm association",
	});
	expect(confirm.hasAttribute("disabled")).toBe(true);
	fireEvent.click(screen.getByRole("checkbox", { name: /Explicitly replace/ }));
	fireEvent.click(confirm);
	await screen.findByRole("button", { name: "Open anime" });
	const body = fetcher.mock.calls.find(
		([path]) => path === "/api/catalog/confirmations",
	)?.[1]?.body;
	expect(JSON.parse(String(body)).replace).toBe(true);
});

test("review status filters and editor return preserve the current list page", async () => {
	mockReview(true);
	const { router } = renderApp("/review?decision=confirmed&page=3");
	const filters = await screen.findByRole("navigation", {
		name: "Show decisions",
	});
	expect(
		within(filters)
			.getByRole("link", { name: "Associated" })
			.getAttribute("aria-current"),
	).toBe("page");
	fireEvent.click(
		await screen.findByRole("link", { name: "Correct associations" }),
	);
	const back = await screen.findByRole("link", { name: "Back to review" });
	expect(back.getAttribute("href")).toBe("/review?decision=confirmed&page=3");
	fireEvent.click(back);
	await screen.findByRole("link", { name: "Correct associations" });
	fireEvent.click(
		within(
			screen.getByRole("navigation", { name: "Show decisions" }),
		).getByRole("link", { name: "Needs review" }),
	);
	await waitFor(() =>
		expect(router.state.location.search).toBe("?decision=pending"),
	);
});

test("review removal stays separate from correction and retains explicit consent", async () => {
	const item = mockReview(true);
	renderApp(`/review?item=${item.id}&decision=confirmed`);
	await screen.findByRole("heading", { name: "Choose the anime" });
	const section = screen
		.getByText("Remove associations", {
			selector: "[data-slot=collapsible-trigger]",
		})
		.closest("[data-slot=collapsible]");
	expect(section?.hasAttribute("data-open")).toBe(false);
	fireEvent.click(
		screen.getByText("Remove associations", {
			selector: "[data-slot=collapsible-trigger]",
		}),
	);
	fireEvent.change(screen.getByLabelText("Rejection or removal reason"), {
		target: { value: "Wrong anime" },
	});
	fireEvent.click(
		screen.getByText("Remove associations", {
			selector: "button[type=submit]",
		}),
	);
	await screen.findByRole("alert");
	expect(
		fetcher.mock.calls.some(([path]) => String(path).endsWith("/remove")),
	).toBe(false);
	fireEvent.click(screen.getByRole("checkbox", { name: /Explicitly remove/ }));
	fireEvent.click(
		screen.getByText("Remove associations", {
			selector: "button[type=submit]",
		}),
	);
	await waitFor(() => expect(item.decision).toBe("rejected"));
});

test("editing mapped numbers invalidates the previous association preview", async () => {
	const item = mockReview(true);
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	await screen.findByRole("heading", { name: "Association preview" });
	fireEvent.click(screen.getByRole("checkbox", { name: /Explicitly replace/ }));
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "2" },
	});
	expect(
		screen.queryByRole("button", { name: "Confirm association" }),
	).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	expect(
		(
			await screen.findByRole("button", { name: "Confirm association" })
		).hasAttribute("disabled"),
	).toBe(true);
});

test("a failed confirmation retains the form and reuses its preview operation key on retry", async () => {
	const item = mockReview();
	const fallback = fetcher.getMockImplementation();
	let attempts = 0;
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/catalog/confirmations" && attempts++ === 0)
			return json(
				{
					error: {
						code: "CATALOG_UNAVAILABLE",
						message: "Try again",
						requestId: "retry",
					},
				},
				503,
			);
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "3" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Confirm association" }),
	);
	await screen.findByText(/Anime catalog is unavailable/, {
		selector: "[data-slot=toast-title]",
	});
	expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
	expect(
		(screen.getByLabelText("Episode numbers") as HTMLInputElement).value,
	).toBe("3");
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Confirm association" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Confirm association" }));
	await screen.findByRole("button", { name: "Open anime" });
	const requests = fetcher.mock.calls
		.filter(([url]) => url === "/api/catalog/confirmations")
		.map(([, init]) => JSON.parse(String(init?.body)));
	expect(requests).toHaveLength(2);
	expect(requests[1]).toEqual(requests[0]);
});

test("Files shows associations and opens the selected review while direct playback stays accessible", async () => {
	const item = reviewFixture(true);
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/catalog/file-reviews") return json([item]);
		if (String(input) === `/api/catalog/reviews/${item.id}`) return json(item);
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp("/directories/season-1");
	await screen.findByRole("button", { name: /^Associated/ });
	fireEvent.click(screen.getByRole("button", { name: "File actions" }));
	const association = await screen.findByRole("menuitem", {
		name: "Frieren · Episode 1",
	});
	expect(association.getAttribute("href")).toBe("/anime/work-1#episode-ep-1");
	expect(screen.getByRole("link", { name: "Episode 01.mp4" })).toBeTruthy();
	const review = screen.getByRole("menuitem", { name: "Correct associations" });
	expect(review.getAttribute("href")).toBe(`/review?item=${item.id}`);
	fireEvent.click(review);
	await screen.findByText(item.evidence.originalName);
	expect(screen.getByTestId("location").textContent).toContain(
		`item=${item.id}`,
	);
});

test("file identification failure offers retry without preventing playback", async () => {
	const fallback = fetcher.getMockImplementation();
	let failed = true;
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/catalog/file-reviews")
			return failed
				? json(
						{ error: { code: "CATALOG_UNAVAILABLE", message: "Offline" } },
						503,
					)
				: json([]);
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp("/directories/season-1");
	await screen.findByText(/Could not load file identification/);
	expect(screen.getByRole("link", { name: "Episode 01.mp4" })).toBeTruthy();
	failed = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByRole("button", { name: "Awaiting identification" });
});

test("Files updates current associations when automatic recognition completes", async () => {
	const item = reviewFixture(true);
	const fallback = fetcher.getMockImplementation();
	let running = true;
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/anime/identification")
			return json({ running, failed: false });
		if (String(input) === "/api/catalog/file-reviews")
			return json(running ? [] : [item]);
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp("/directories/season-1");
	await screen.findByRole("button", { name: "Awaiting identification" });
	running = false;
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: ["identification"] });
	});
	await screen.findByRole("button", { name: /^Associated/ });
	expect(
		fetcher.mock.calls.filter(
			([path]) => String(path) === "/api/catalog/file-reviews",
		).length,
	).toBeGreaterThan(1);
});

test("Review can reject a pending resource without a reason", async () => {
	const item = mockReview();
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === `/api/catalog/reviews/${item.id}/reject`) {
			expect(JSON.parse(String(init?.body)).reason).toBe("");
			item.decision = "rejected";
			item.reason = null;
			item.revision += 1;
			return json(item);
		}
		return requiredFetch(fallback)(input, init);
	});
	renderApp(`/review?item=${item.id}`);
	fireEvent.click(
		await screen.findByText("Reject resource", {
			selector: "[data-slot=collapsible-trigger]",
		}),
	);
	expect(
		screen.getByLabelText("Reason (optional)").hasAttribute("required"),
	).toBe(false);
	fireEvent.click(
		screen.getByText("Reject resource", { selector: "button[type=submit]" }),
	);
	await waitFor(() => expect(item.decision).toBe("rejected"));
});

test.each([400, 409, 422])(
	"Review HTTP %s correction errors stay inline with the form",
	async (status) => {
		const item = mockReview();
		const fallback = fetcher.getMockImplementation();
		const notify = vi.spyOn(toast, "add");
		fetcher.mockImplementation(async (input, init) => {
			if (String(input) === "/api/catalog/confirmations")
				return json(
					{
						error: {
							code: status === 409 ? "CATALOG_CONFLICT" : "INVALID_REQUEST",
							message: "Correct the request",
							requestId: "correction",
						},
					},
					status,
				);
			return requiredFetch(fallback)(input, init);
		});
		renderApp(`/review?item=${item.id}`);
		await selectReviewWork();
		fireEvent.click(
			screen.getByRole("button", { name: "Preview association" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Confirm association" }),
		);
		await within(screen.getByRole("main")).findByRole("alert");
		expect(screen.getByLabelText("Episode numbers")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Association preview" }),
		).toBeTruthy();
		expect(
			notify.mock.calls.some(
				([notice]) => notice.id === `review-operation:${item.id}`,
			),
		).toBe(false);
		notify.mockRestore();
	},
);

test("a failed Review rejection uses a Toast, retains the reason and can be retried", async () => {
	const item = mockReview();
	const fallback = fetcher.getMockImplementation();
	let failing = true;
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === `/api/catalog/reviews/${item.id}/reject`) {
			if (failing)
				return json(
					{
						error: {
							code: "CATALOG_UNAVAILABLE",
							message: "Unavailable",
							requestId: "reject",
						},
					},
					503,
				);
			item.decision = "rejected";
			return json(item);
		}
		return requiredFetch(fallback)(input, init);
	});
	renderApp(`/review?item=${item.id}`);
	fireEvent.click(
		await screen.findByText("Reject resource", {
			selector: "[data-slot=collapsible-trigger]",
		}),
	);
	fireEvent.change(screen.getByLabelText("Reason (optional)"), {
		target: { value: "Keep outside library" },
	});
	fireEvent.click(
		screen.getByText("Reject resource", { selector: "button[type=submit]" }),
	);
	await screen.findByText(/Anime catalog is unavailable/, {
		selector: "[data-slot=toast-title]",
	});
	expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
	expect(
		(screen.getByLabelText("Reason (optional)") as HTMLInputElement).value,
	).toBe("Keep outside library");
	failing = false;
	await waitFor(() =>
		expect(
			screen
				.getByText("Reject resource", { selector: "button[type=submit]" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(
		screen.getByText("Reject resource", { selector: "button[type=submit]" }),
	);
	await screen.findByText("Resource rejected.", {
		selector: "[data-slot=toast-title]",
	});
});
