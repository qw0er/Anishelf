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
	await screen.findByText(/Password saved/);
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
	const password = (await screen.findByLabelText(
		"Password",
	)) as HTMLInputElement;
	expect(password.value).toBe("");
	expect(password.required).toBe(false);
	fireEvent.click(screen.getByRole("button", { name: "Save API connection" }));
	await waitFor(() =>
		expect(request.mock.calls.some((call) => call[1] === "PUT")).toBe(true),
	);
	const saved = request.mock.calls.find((call) => call[1] === "PUT");
	expect(saved?.[3]).not.toHaveProperty("password");
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Test connection",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
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
test("tests the saved connection and removes credentials explicitly", async () => {
	const { request, notification } = mockConnection({
		state: "configured",
		url: "http://qbittorrent:8080/",
		username: "admin",
		passwordConfigured: true,
	});
	render(<QbittorrentApiSettings />);
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
	fireEvent.click(
		screen.getByRole("button", { name: "Remove API connection" }),
	);
	await screen.findByText("Enter your qBittorrent account password.");
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/qbittorrent",
		"DELETE",
		{},
		{ generation: "one" },
	);
});
