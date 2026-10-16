// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { CompletionControl } from "../src/features/playback/player/components/completion-control.js";
import { queryClient } from "../src/shared/api/query-client.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";
import "../src/shared/i18n.js";

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
	});
}
afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.unstubAllGlobals();
});

test("the single control marks an episode watched and still requires the player's decision", async () => {
	const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
		if (init?.method !== "POST") return json(null);
		const body = JSON.parse(String(init.body));
		return json(
			body.initialStatus
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
		);
	});
	vi.stubGlobal("fetch", fetcher);
	render(
		<MemoryRouter>
			<CompletionControl token="token" />
		</MemoryRouter>,
	);
	const mark = await screen.findByRole("button", {
		name: "Mark as watched",
	});
	expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
		false,
	);
	fireEvent.click(mark);
	expect(await screen.findByText(/including skipped episodes/)).toBeTruthy();
	const first = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
	expect(JSON.parse(String(first?.[1]?.body))).toEqual({ advance: true });
	fireEvent.click(
		screen.getByRole("button", { name: "Confirm progress update" }),
	);
	await screen.findByRole("button", { name: "AniList update queued" });
	const posts = fetcher.mock.calls.filter(
		([, init]) => init?.method === "POST",
	);
	expect(JSON.parse(String(posts.at(-1)?.[1]?.body))).toEqual({
		advance: true,
		initialStatus: "CURRENT",
	});
	fireEvent.click(
		screen.getByRole("button", { name: "AniList update queued" }),
	);
	expect(
		screen
			.getByRole("link", { name: "View AniList progress" })
			.getAttribute("href"),
	).toBe("/anime/tracked/9");
});

test("new entries require an explicit initial status", async () => {
	const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) =>
		json({
			state: "decision-required",
			reason: "initial-status-required",
			mediaId: 9,
			episode: 1,
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	render(
		<MemoryRouter>
			<CompletionControl token="token" />
		</MemoryRouter>,
	);
	expect(
		await screen.findByRole("button", { name: "Review AniList update" }),
	).toBeTruthy();
	const select = await screen.findByRole("combobox", {
		name: "Initial AniList status",
	});
	fireEvent.change(select, { target: { value: "PLANNING" } });
	fireEvent.click(
		screen.getByRole("button", { name: "Confirm progress update" }),
	);
	await waitFor(() =>
		expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
			true,
		),
	);
	const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
	expect(JSON.parse(String(post?.[1]?.body))).toEqual({
		advance: true,
		initialStatus: "PLANNING",
	});
});

test("failed completion reads keep an actionable retry without changing playback", async () => {
	const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
		if (init?.method === "POST")
			return json({ state: "queued", reason: "submission-queued" });
		throw new Error("offline");
	});
	vi.stubGlobal("fetch", fetcher);
	render(
		<MemoryRouter>
			<CompletionControl token="token" />
		</MemoryRouter>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Retry AniList update" }),
	);
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("unmapped sources render no tracking control or polling", async () => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	const view = render(
		<MemoryRouter>
			<CompletionControl token={undefined} />
		</MemoryRouter>,
	);
	expect(view.container.textContent).toBe("");
	expect(fetcher).not.toHaveBeenCalled();
});
