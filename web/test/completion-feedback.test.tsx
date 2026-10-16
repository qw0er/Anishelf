// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { CompletionFeedback } from "../src/features/playback/player/components/completion-feedback.js";
import { queryClient } from "../src/shared/api/query-client.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";
import "../src/shared/i18n.js";

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.unstubAllGlobals();
});

test("skipped completion offers an explicit decision and never mutates until clicked", async () => {
	const fetcher = vi.fn(
		async (_input: unknown, init?: RequestInit) =>
			new Response(
				JSON.stringify(
					init?.method === "POST"
						? {
								state: "queued",
								reason: "submission-queued",
								mediaId: 9,
								episode: 7,
							}
						: {
								state: "decision-required",
								reason: "skipped-episodes",
								mediaId: 9,
								episode: 7,
							},
				),
				{ headers: { "content-type": "application/json" } },
			),
	);
	vi.stubGlobal("fetch", fetcher);
	render(
		<MemoryRouter>
			<CompletionFeedback token="token" />
		</MemoryRouter>,
	);
	expect(await screen.findByText(/including skipped episodes/)).toBeTruthy();
	expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
		false,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Confirm progress update" }),
	);
	await screen.findByText(/Episode completion queued/);
	const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
	expect(JSON.parse(String(post?.[1]?.body))).toEqual({
		advance: true,
		initialStatus: "CURRENT",
	});
	expect(
		screen
			.getByRole("link", { name: "View AniList progress" })
			.getAttribute("href"),
	).toBe("/anime/tracked/9");
});

test("new entries require an explicit initial status", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					state: "decision-required",
					reason: "initial-status-required",
					mediaId: 9,
					episode: 1,
				}),
				{ headers: { "content-type": "application/json" } },
			),
	);
	vi.stubGlobal("fetch", fetcher);
	render(
		<MemoryRouter>
			<CompletionFeedback token="token" />
		</MemoryRouter>,
	);
	const select = await screen.findByRole("combobox", {
		name: "Initial AniList status",
	});
	fireEvent.change(select, { target: { value: "PLANNING" } });
	fireEvent.click(
		screen.getByRole("button", { name: "Confirm progress update" }),
	);
	await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(1));
	expect(
		JSON.parse(
			String(
				(fetcher.mock.calls[1] as unknown as [unknown, RequestInit])[1].body,
			),
		),
	).toEqual({ advance: true, initialStatus: "PLANNING" });
});

test("failed completion reads show an actionable retry without changing playback", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					state: "decision-required",
					reason: "skipped-episodes",
					mediaId: 9,
					episode: 7,
				}),
				{ headers: { "content-type": "application/json" } },
			),
	);
	fetcher.mockRejectedValueOnce(new Error("offline"));
	vi.stubGlobal("fetch", fetcher);
	render(
		<MemoryRouter>
			<CompletionFeedback token="token" />
		</MemoryRouter>,
	);
	expect(await screen.findByRole("alert")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText(/including skipped episodes/)).toBeTruthy();
});
