// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { QbittorrentApiSettings } from "../src/features/acquisition/api-settings.js";
import * as api from "../src/shared/api/client.js";
import type { QbittorrentConnectionSettings } from "../src/shared/api/contracts.js";
import { queryClient } from "../src/shared/api/query-client.js";
import { toast } from "../src/shared/components/ui/toast.js";
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
	vi.restoreAllMocks();
});
function mockConnection(initial?: Partial<QbittorrentConnectionSettings>) {
	let settings: QbittorrentConnectionSettings = {
		generation: "one",
		state: "unconfigured",
		url: null,
		username: "",
		passwordConfigured: false,
		...initial,
	};
	const notification = vi.spyOn(toast, "add");
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, payload) => {
			if (path.endsWith("/credentials"))
				return { username: "admin", password: "bundled-secret" };
			if (path.endsWith("/bundled")) {
				settings = {
					...settings,
					generation: "bundled",
					state: "configured",
					bundled: true,
					url: "http://qbittorrent:8080/",
					username: "admin",
					passwordConfigured: true,
				};
			}
			if (path.endsWith("/check"))
				return {
					generation: settings.generation,
					available: true,
					checkedAt: 1,
					version: "v5.0.5",
					code: null,
				};
			if (method === "PUT") {
				const input = payload as { url: string; username: string };
				settings = {
					generation: "two",
					state: "configured",
					url: input.url,
					username: input.username,
					passwordConfigured: true,
				};
			}
			if (method === "DELETE")
				settings = {
					generation: "three",
					state: "unconfigured",
					url: null,
					username: "",
					passwordConfigured: false,
				};
			return settings;
		});
	return { request, notification };
}
test("manual credentials remain drafts until Save and password clears without entering query caches", async () => {
	const { request } = mockConnection();
	render(<QbittorrentApiSettings />);
	const url = await screen.findByLabelText("API URL");
	fireEvent.change(url, { target: { value: "http://qbittorrent:8080/" } });
	fireEvent.change(screen.getByLabelText("Username"), {
		target: { value: "admin" },
	});
	const password = screen.getByLabelText("Password") as HTMLInputElement;
	expect(password.type).toBe("password");
	fireEvent.change(password, { target: { value: "user-entered-secret" } });
	expect(request.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(
		0,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save API connection" }));
	fireEvent.click(await screen.findByLabelText("Edit connection"));
	await screen.findByPlaceholderText("Saved · leave blank to keep");
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/qbittorrent",
		"PUT",
		{},
		{
			generation: "one",
			url: "http://qbittorrent:8080/",
			username: "admin",
			password: "user-entered-secret",
		},
	);
	expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
		"",
	);
	expect(
		JSON.stringify(queryClient.getQueryData(["acquisition", "qbittorrent"])),
	).not.toContain("user-entered-secret");
	expect(
		queryClient
			.getMutationCache()
			.getAll()
			.every((mutation) => mutation.state.variables === undefined),
	).toBe(true);
});
test("saved passwords are not populated and changing accounts requires a fresh password", async () => {
	const { request } = mockConnection({
		state: "configured",
		url: "http://qbittorrent:8080/",
		username: "admin",
		passwordConfigured: true,
	});
	render(<QbittorrentApiSettings />);
	fireEvent.click(await screen.findByLabelText("Edit connection"));
	const password = (await screen.findByLabelText(
		"Password",
	)) as HTMLInputElement;
	expect(password.value).toBe("");
	expect(password.required).toBe(false);
	expect(
		screen.getByRole<HTMLButtonElement>("button", {
			name: "Save API connection",
		}).disabled,
	).toBe(true);
	expect(request.mock.calls.every((call) => call[1] === "GET")).toBe(true);
	fireEvent.change(screen.getByLabelText("Username"), {
		target: { value: "other" },
	});
	expect((screen.getByLabelText("Password") as HTMLInputElement).required).toBe(
		true,
	);
	expect(
		(
			screen.getByRole("button", {
				name: "Test connection",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});
test("connection actions share one row inside the editor", async () => {
	mockConnection({
		state: "configured",
		url: "http://qbittorrent:8080/",
		username: "admin",
		passwordConfigured: true,
	});
	render(<QbittorrentApiSettings />);
	fireEvent.click(await screen.findByLabelText("Edit connection"));
	const save = await screen.findByRole("button", {
		name: "Save API connection",
	});
	const row = save.parentElement;
	for (const name of [
		"Cancel",
		"Test connection",
		"More service actions",
	] as const)
		expect(screen.getByRole("button", { name }).parentElement).toBe(row);
	expect(row?.lastElementChild).toBe(
		screen.getByRole("button", { name: "More service actions" }),
	);
});
test("bundled credentials can be reselected from More", async () => {
	const { request, notification } = mockConnection({
		state: "configured",
		url: "http://external:8080/",
		username: "admin",
		passwordConfigured: true,
		bundledAvailable: true,
	});
	render(<QbittorrentApiSettings />);
	fireEvent.click(await screen.findByLabelText("Edit connection"));
	fireEvent.click(screen.getByRole("button", { name: "More service actions" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Use bundled qBittorrent" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			"/api/acquisition/qbittorrent/bundled",
			"POST",
			{},
			{ generation: "one" },
		),
	);
	await screen.findByText("Bundled");
	expect(notification).toHaveBeenCalledWith(
		expect.objectContaining({
			title: "Bundled qBittorrent connection selected.",
		}),
	);
});
test("tests the saved connection and removes credentials explicitly", async () => {
	const { request, notification } = mockConnection({
		state: "configured",
		url: "http://qbittorrent:8080/",
		username: "admin",
		passwordConfigured: true,
	});
	render(<QbittorrentApiSettings />);
	fireEvent.click(await screen.findByLabelText("Edit connection"));
	await screen.findByLabelText("Password");
	fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
	await waitFor(() =>
		expect(notification).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Connected to qBittorrent v5.0.5." }),
		),
	);
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/qbittorrent/check",
		"POST",
		{},
		{ generation: "one" },
	);
	fireEvent.click(screen.getByRole("button", { name: "More service actions" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Remove API connection" }),
	);
	await waitFor(() => expect(screen.queryByText(/Password saved/)).toBeNull());
	expect(
		screen.queryByText("Enter your qBittorrent account password."),
	).toBeNull();
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/qbittorrent",
		"DELETE",
		{},
		{ generation: "one" },
	);
});

test("a deployment URL is prefilled without a saved account or automatic connection", async () => {
	const { request } = mockConnection({ url: "http://qbittorrent:8080/" });
	render(<QbittorrentApiSettings />);
	const address = await screen.findByLabelText("API URL");
	expect((address as HTMLInputElement).value).toBe("http://qbittorrent:8080/");
	expect(
		screen
			.getByRole("button", { name: "Test connection" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(
		screen.queryByRole("button", { name: "Remove API connection" }),
	).toBeNull();
	expect(request.mock.calls.every((call) => call[1] === "GET")).toBe(true);
});

test("bundled WebUI credentials are fetched on demand, hidden, and excluded from caches", async () => {
	const { request } = mockConnection({
		bundled: true,
		state: "configured",
		username: "admin",
		passwordConfigured: true,
		url: "http://qbittorrent:8080/",
	});
	render(<QbittorrentApiSettings />);
	const show = await screen.findByRole("button", {
		name: "Show password",
	});
	expect(screen.getByLabelText("API URL").closest("details")?.open).toBe(false);
	expect(
		request.mock.calls.some((call) => call[0].endsWith("/credentials")),
	).toBe(false);
	fireEvent.click(show);
	expect(
		((await screen.findByLabelText("Saved WebUI password")) as HTMLInputElement)
			.value,
	).toBe("bundled-secret");
	expect(
		JSON.stringify(
			queryClient
				.getQueryCache()
				.getAll()
				.map((query) => query.state.data),
		),
	).not.toContain("bundled-secret");
	expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(
		"bundled-secret",
	);
	fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
	expect(screen.queryByLabelText("Saved WebUI password")).toBeNull();
	fireEvent.click(screen.getByLabelText("Edit connection"));
	expect(screen.getByLabelText("API URL")).toBeTruthy();
});
