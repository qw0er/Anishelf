// @vitest-environment happy-dom
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { authenticatedRoute } from "../src/app/auth/guard.js";
import { LoginPage } from "../src/app/auth/login-page.js";
import { loginReturnPath } from "../src/app/auth/return-path.js";
import { SecuritySettings } from "../src/app/auth/security-settings.js";
import { clearAuthToken, request } from "../src/shared/api/client.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";
import "../src/shared/i18n.js";

const fetcher = vi.fn<typeof fetch>();
const routers: ReturnType<typeof createMemoryRouter>[] = [];
beforeEach(() => {
	clearAuthToken();
	fetcher.mockReset();
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	cleanup();
	for (const router of routers.splice(0)) router.dispose();
	vi.unstubAllGlobals();
});
const json = (body: object, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
test("guards every matched loader before private data is fetched and preserves deep links", async () => {
	fetcher.mockImplementation(async () =>
		json({ authenticated: false, csrfToken: "csrf" }),
	);
	const privateLoader = vi.fn().mockResolvedValue(null);
	const router = createMemoryRouter(
		[
			{ path: "/login", element: <LoginPage /> },
			authenticatedRoute({
				path: "/",
				loader: privateLoader,
				children: [
					{
						path: "files/:id",
						loader: privateLoader,
						element: <p>Private content</p>,
					},
				],
			}),
		],
		{ initialEntries: ["/files/example?directory=root"] },
	);
	routers.push(router);
	render(<RouterProvider router={router} />);
	await screen.findByRole("heading", { name: "Sign in to Anishelf" });
	expect(privateLoader).not.toHaveBeenCalled();
	expect(router.state.location.search).toBe(
		"?returnTo=%2Ffiles%2Fexample%3Fdirectory%3Droot",
	);
});
test("login bootstraps anonymous CSRF and displays wrong-password errors", async () => {
	fetcher.mockImplementation(async (input) =>
		input === "/api/auth/session"
			? json({ authenticated: false, csrfToken: "login-csrf" })
			: json(
					{
						error: {
							code: "AUTH_REQUIRED",
							message: "Incorrect password.",
							requestId: "request",
						},
					},
					401,
				),
	);
	const router = createMemoryRouter(
		[{ path: "/login", element: <LoginPage /> }],
		{ initialEntries: ["/login"] },
	);
	routers.push(router);
	render(<RouterProvider router={router} />);
	fireEvent.change(screen.getByLabelText("Password"), {
		target: { value: "  wrong  " },
	});
	fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
	await screen.findByText("Incorrect password.");
	expect(fetcher).toHaveBeenLastCalledWith(
		"/api/auth/login",
		expect.objectContaining({
			headers: expect.objectContaining({ "x-csrf-token": "login-csrf" }),
			body: JSON.stringify({ password: "wrong" }),
		}),
	);
});
test("password form trims outer spaces before confirming and submitting", async () => {
	fetcher.mockImplementation(async (input) =>
		input === "/api/auth/session"
			? json({ authenticated: true, csrfToken: "change-csrf" })
			: json(
					{
						error: {
							code: "AUTH_REQUIRED",
							message: "Incorrect current password.",
							requestId: "request",
						},
					},
					401,
				),
	);
	render(<SecuritySettings />);
	fireEvent.change(screen.getByLabelText("Current password"), {
		target: { value: " old password " },
	});
	fireEvent.change(
		screen.getByLabelText(
			"New password (8–128 characters, outer spaces trimmed)",
		),
		{
			target: { value: " new password long " },
		},
	);
	fireEvent.change(screen.getByLabelText("Confirm new password"), {
		target: { value: "different" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Change password" }));
	await screen.findByText("Passwords do not match.");
	expect(fetcher).not.toHaveBeenCalled();
	fireEvent.change(screen.getByLabelText("Confirm new password"), {
		target: { value: "new password long" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Change password" }));
	await screen.findByText("Incorrect current password.");
	expect(fetcher).toHaveBeenLastCalledWith(
		"/api/auth/password",
		expect.objectContaining({
			body: JSON.stringify({
				currentPassword: "old password",
				password: "new password long",
			}),
		}),
	);
});
test("password form rejects fewer than eight characters", async () => {
	fetcher.mockImplementation(async () =>
		json({ authenticated: true, csrfToken: "change-csrf" }),
	);
	render(<SecuritySettings />);
	fireEvent.change(screen.getByLabelText("Current password"), {
		target: { value: "current-password" },
	});
	fireEvent.change(
		screen.getByLabelText(
			"New password (8–128 characters, outer spaces trimmed)",
		),
		{ target: { value: "  short  " } },
	);
	fireEvent.change(screen.getByLabelText("Confirm new password"), {
		target: { value: "short" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Change password" }));
	await screen.findByText("Password must contain at least 8 characters.");
	expect(fetcher).not.toHaveBeenCalled();
});
test("business 401 signals session loss while wrong login passwords do not", async () => {
	const expired = vi.fn();
	window.addEventListener("anishelf:auth-required", expired);
	try {
		fetcher.mockImplementation(async (input) =>
			input === "/api/auth/session"
				? json({ authenticated: false, csrfToken: "csrf" })
				: json(
						{
							error: {
								code: "AUTH_REQUIRED",
								message: "Sign in.",
								requestId: "request",
							},
						},
						401,
					),
		);
		await expect(request("/api/settings", "GET")).rejects.toMatchObject({
			status: 401,
		});
		expect(expired).toHaveBeenCalledOnce();
		await expect(
			request("/api/auth/login", "POST", {}, { password: "wrong" }),
		).rejects.toMatchObject({ status: 401 });
		await waitFor(() => expect(expired).toHaveBeenCalledOnce());
	} finally {
		window.removeEventListener("anishelf:auth-required", expired);
	}
});
test.each([
	"https://evil.test/path",
	"//evil.test/path",
	"javascript:alert(1)",
	"http://[",
	"/login",
	"/login/",
])("rejects unsafe login return destination %s", (value) => {
	expect(loginReturnPath(value, "https://example.com")).toBe("/");
});
test("preserves a local login return path with query and hash", () => {
	expect(
		loginReturnPath(
			"/files/example?directory=root#player",
			"https://example.com",
		),
	).toBe("/files/example?directory=root#player");
});
