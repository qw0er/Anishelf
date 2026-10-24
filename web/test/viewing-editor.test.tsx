// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ViewingState } from "../src/features/anime/tracking/use-viewing-state.js";
import { ViewingEditor } from "../src/features/anime/tracking/viewing-editor.js";
import type { TrackingOperationResponse } from "../src/shared/api/contracts.js";
import { trackingProvider } from "./tracking-fixture.js";
import "../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";

const snapshot: NonNullable<ViewingState["snapshot"]> = {
	provider: trackingProvider,
	accountId: "anilist:7",
	generation: "generation-one",
	state: "connected",
	fetchedAt: 1000,
	stale: false,
	refreshing: false,
	error: null,
	entry: {
		id: "anilist:10",
		mediaId: "anilist:anime:1",
		progress: 3,
		status: "watching",
		updatedAt: 100,
		titles: ["Fixture"],
		format: "TV",
		year: 2025,
		episodeCount: 12,
		coverUrl: null,
	},
};
const state: ViewingState = {
	visible: true,
	loading: false,
	refreshing: false,
	reconnect: false,
	snapshot,
	error: null,
	retry() {},
};
let operations: TrackingOperationResponse[];
const fetcher = vi.fn<typeof fetch>();
const pending = (): TrackingOperationResponse => ({
	id: "operation-one",
	origin: "manual-detail",
	commandId: "command",
	intentAt: 1,
	target: null,
	decisionReason: null,
	accountId: "anilist:7",
	mediaId: "anilist:anime:1",
	revision: 1,
	baseline: {
		id: "anilist:10",
		progress: 3,
		status: "watching",
		updatedAt: 100,
	},
	desired: { progress: 1 },
	state: "pending",
	remote: { id: "anilist:10", progress: 3, status: "watching", updatedAt: 100 },
	attempts: 0,
	retryAt: null,
	error: null,
	updatedAt: 2000,
});
beforeEach(() => {
	operations = [];
	fetcher.mockReset();
	fetcher.mockImplementation(async (url, options) => {
		if (String(url).includes("/operations?")) return Response.json(operations);
		if (String(url).endsWith("/updates")) {
			operations = [pending()];
			return Response.json(operations[0]);
		}
		if (String(url).endsWith("/resolve")) {
			operations = [{ ...pending(), revision: 2, state: "cancelled" }];
			return Response.json(operations[0]);
		}
		if (String(url).endsWith("/retry")) {
			operations = [{ ...pending(), revision: 2 }];
			return Response.json(operations[0]);
		}
		throw Error(`Unexpected fixture request: ${url} ${options?.method}`);
	});
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
async function open() {
	render(<ViewingEditor state={state} mediaId="anilist:anime:1" />);
	fireEvent.click(screen.getByRole("button", { name: "Edit progress" }));
	await screen.findByRole("spinbutton", { name: "Episodes watched" });
}
test("manual backward correction submits only changed progress and shows pending separately", async () => {
	await open();
	fireEvent.change(
		screen.getByRole("spinbutton", { name: "Episodes watched" }),
		{ target: { value: "1" } },
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Save to the tracking service" }),
	);
	await screen.findByText("the tracking service change queued");
	expect(
		screen.getByText(
			"Confirmed on the tracking service: 3 episodes · Watching",
		),
	).toBeTruthy();
	expect(screen.getByText("Pending change: 1 episode · Watching")).toBeTruthy();
	const call = fetcher.mock.calls.find(([url]) =>
		String(url).endsWith("/updates"),
	);
	expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
		generation: snapshot.generation,
		revision: null,
		desired: { progress: 1 },
	});
	expect(JSON.parse(String(call?.[1]?.body)).desired).not.toHaveProperty(
		"status",
	);
});
test("status-only change omits progress and rejects negative progress in the form", async () => {
	await open();
	fireEvent.change(
		screen.getByRole("spinbutton", { name: "Episodes watched" }),
		{ target: { value: "-1" } },
	);
	expect(
		screen.getByRole<HTMLButtonElement>("button", {
			name: "Save to the tracking service",
		}).disabled,
	).toBe(true);
	fireEvent.change(
		screen.getByRole("spinbutton", { name: "Episodes watched" }),
		{ target: { value: "3" } },
	);
	fireEvent.click(screen.getByRole("radio", { name: "Paused" }));
	fireEvent.click(
		screen.getByRole("button", { name: "Save to the tracking service" }),
	);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([url]) => String(url).endsWith("/updates")),
		).toBe(true),
	);
	const call = fetcher.mock.calls.find(([url]) =>
		String(url).endsWith("/updates"),
	);
	expect(JSON.parse(String(call?.[1]?.body)).desired).toEqual({
		status: "paused",
	});
});
test("conflict exposes explicit choices with the current operation revision", async () => {
	operations = [
		{
			...pending(),
			state: "conflict",
			remote: {
				id: "anilist:10",
				progress: 6,
				status: "watching",
				updatedAt: 200,
			},
			error: "remote-changed",
		},
	];
	await open();
	expect(
		screen.getByText(
			"Confirmed on the tracking service: 6 episodes · Watching",
		),
	).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Save to the tracking service" }),
	).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Keep the tracking service value" }),
	);
	await screen.findByText("Kept the tracking service value");
	const call = fetcher.mock.calls.find(([url]) =>
		String(url).endsWith("/resolve"),
	);
	expect(JSON.parse(String(call?.[1]?.body))).toEqual({
		generation: snapshot.generation,
		revision: 1,
		keepRemote: true,
	});
});
test("failed operation keeps intent and exposes retry", async () => {
	operations = [{ ...pending(), state: "failed", error: "unavailable" }];
	await open();
	expect(
		screen.getByRole<HTMLInputElement>("spinbutton", {
			name: "Episodes watched",
		}).value,
	).toBe("1");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("the tracking service change queued");
	expect(
		fetcher.mock.calls.some(([url]) => String(url).endsWith("/retry")),
	).toBe(true);
});

test("a refreshed remote progress value is not unintentionally included in a status edit", async () => {
	const view = render(
		<ViewingEditor state={state} mediaId="anilist:anime:1" />,
	);
	fireEvent.click(screen.getByRole("button", { name: "Edit progress" }));
	await screen.findByRole("spinbutton", { name: "Episodes watched" });
	fireEvent.click(screen.getByRole("radio", { name: "Paused" }));
	if (!snapshot.entry) throw Error("missing entry");
	view.rerender(
		<ViewingEditor
			state={{
				...state,
				snapshot: {
					...snapshot,
					fetchedAt: 3000,
					entry: { ...snapshot.entry, progress: 6 },
				},
			}}
			mediaId="anilist:anime:1"
		/>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Save to the tracking service" }),
	);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([url]) => String(url).endsWith("/updates")),
		).toBe(true),
	);
	const call = fetcher.mock.calls.find(([url]) =>
		String(url).endsWith("/updates"),
	);
	expect(JSON.parse(String(call?.[1]?.body)).desired).toEqual({
		status: "paused",
	});
});

test("an ambiguous retry keeps its command ID while an edited intent gets a new ID", async () => {
	const original = fetcher.getMockImplementation();
	if (!original) throw Error("Missing fixture");
	let failures = 2;
	fetcher.mockImplementation(async (url, options) => {
		if (String(url).endsWith("/updates") && failures-- > 0)
			throw Error("Lost response");
		return original(url, options);
	});
	await open();
	fireEvent.change(
		screen.getByRole("spinbutton", { name: "Episodes watched" }),
		{ target: { value: "1" } },
	);
	const button = screen.getByRole<HTMLButtonElement>("button", {
		name: "Save to the tracking service",
	});
	const posts = () =>
		fetcher.mock.calls
			.filter(([url]) => String(url).endsWith("/updates"))
			.map(([, init]) => JSON.parse(String(init?.body)));
	fireEvent.click(button);
	await waitFor(() => {
		expect(posts()).toHaveLength(1);
		expect(button.disabled).toBe(false);
	});
	fireEvent.click(button);
	await waitFor(() => {
		expect(posts()).toHaveLength(2);
		expect(button.disabled).toBe(false);
	});
	expect(posts()[0].commandId).toBe(posts()[1].commandId);
	fireEvent.change(
		screen.getByRole("spinbutton", { name: "Episodes watched" }),
		{ target: { value: "2" } },
	);
	fireEvent.click(button);
	await waitFor(() => expect(posts()).toHaveLength(3));
	expect(posts()[2].commandId).not.toBe(posts()[1].commandId);
});

test("the editor uses provider capabilities for supported states and progress limits", async () => {
	render(
		<ViewingEditor
			state={{
				...state,
				snapshot: {
					...snapshot,
					provider: {
						...trackingProvider,
						name: "Fixture Tracker",
						key: "fixture",
						capabilities: {
							progress: "cumulative-episodes",
							maximumProgress: 50,
							statuses: ["watching", "completed"],
						},
					},
				},
			}}
			mediaId="fixture:anime:show-alpha"
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Edit progress" }));
	const progress = await screen.findByRole("spinbutton", {
		name: "Episodes watched",
	});
	expect(progress.getAttribute("max")).toBe("50");
	expect(screen.getByRole("radio", { name: "Watching" })).toBeTruthy();
	expect(screen.getByRole("radio", { name: "Completed" })).toBeTruthy();
	expect(screen.queryByRole("radio", { name: "Paused" })).toBeNull();
});
