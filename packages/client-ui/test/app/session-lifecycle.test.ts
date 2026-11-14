import { createMemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import {
	ClientSessionLifecycle,
	loginRedirectPath,
} from "../../src/app/session-lifecycle.js";

test("preserves the current route, query and hash in the login redirect", () => {
	expect(
		loginRedirectPath({
			pathname: "/library",
			search: "?sort=name&page=2",
			hash: "#file-123",
		}),
	).toBe(
		`/login?returnTo=${encodeURIComponent("/library?sort=name&page=2#file-123")}`,
	);
	expect(loginRedirectPath({ pathname: "/", search: "", hash: "" })).toBe(
		`/login?returnTo=${encodeURIComponent("/")}`,
	);
});

test("defers startup authorization loss and disposes once before opening login", () => {
	const open = vi.fn();
	const disposeRuntime = vi.fn();
	const router = createMemoryRouter([{ path: "/library" }], {
		initialEntries: ["/library?sort=name#file-123"],
	});
	const disposeRouter = vi.spyOn(router, "dispose");
	const session = new ClientSessionLifecycle({ name: "desktop", open });

	session.onAuthRequired();
	expect(open).not.toHaveBeenCalled();
	expect(session.attach(disposeRuntime, router)).toBe(false);
	session.onAuthRequired();
	session.restart("/");
	expect(open).toHaveBeenCalledExactlyOnceWith(
		loginRedirectPath(router.state.location),
	);
	expect(disposeRuntime).toHaveBeenCalledBefore(open);
	expect(disposeRouter).toHaveBeenCalledBefore(open);
});
