import { expect, test } from "vitest";
import { loginRedirectPath } from "../src/session.js";

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
