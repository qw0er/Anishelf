import { expect, test, vi } from "vitest";
import {
	hashPassword,
	replaceCredential,
} from "../../../../src/modules/system/authentication/infrastructure/credentials.js";

import {
	application,
	apps,
	browser,
	headers,
	setupTestLifecycle,
} from "./support/authentication-fixture.js";

setupTestLifecycle();

test("anonymous API and media requests are blocked, including HEAD and Range", async () => {
	const { app } = await application();
	for (const url of [
		"/api/settings",
		"/api/subtitles/file",
		"/api/fonts/file",
		"/api/artwork/file",
		"/api/preparation/file",
		"/api/media/file",
	]) {
		expect((await app.inject({ url, headers })).statusCode).toBe(401);
		expect(
			(
				await app.inject({
					url,
					method: "HEAD",
					headers: { ...headers, range: "bytes=0-3" },
				})
			).statusCode,
		).toBe(401);
	}
	expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
		200,
	);
	expect(
		(await app.inject({ url: "/api/auth/session", headers })).json()
			.authenticated,
	).toBe(false);
});

test("login rotates cookie, enforces CSRF and Origin, logout revokes session", async () => {
	const { app, password } = await application();
	const { cookie, csrf, login } = await browser(app, password ?? "");
	expect(login.headers["set-cookie"]).toContain("HttpOnly");
	expect(login.headers["set-cookie"]).toContain("SameSite=Lax");
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(200);
	expect(
		(
			await app.inject({
				url: "/api/test",
				method: "POST",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await app.inject({
				url: "/api/test",
				method: "POST",
				headers: {
					...headers,
					cookie,
					"x-csrf-token": csrf,
					origin: "https://evil.test",
				},
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await app.inject({
				url: "/api/test",
				method: "POST",
				headers: { ...headers, cookie, "x-csrf-token": csrf },
			})
		).statusCode,
	).toBe(200);
	expect(
		(
			await app.inject({
				url: "/api/auth/logout",
				method: "POST",
				headers: { ...headers, cookie, "x-csrf-token": csrf },
			})
		).statusCode,
	).toBe(204);
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(401);
});

test("sessions and scoped links survive restart; replacing auth.json revokes both", async () => {
	const first = await application();
	const { cookie, csrf } = await browser(first.app, first.password ?? "");
	const link = await first.app.inject({
		url: "/api/media/file/access-link",
		method: "POST",
		headers: { ...headers, cookie, "x-csrf-token": csrf },
	});
	expect(link.statusCode, link.body).toBe(200);
	const url = link.json().url as string;
	expect(
		(
			await first.app.inject({
				url,
				headers: { ...headers, range: "bytes=0-3" },
			})
		).statusCode,
	).toBe(206);
	expect(
		(await first.app.inject({ url, method: "HEAD", headers })).statusCode,
	).toBe(200);
	expect(
		(await first.app.inject({ url: url.replace("/file?", "/other?"), headers }))
			.statusCode,
	).toBe(401);
	const token =
		new URL(url, "http://localhost").searchParams.get("access_token") ?? "";
	expect(
		(
			await first.app.inject({
				url: `/api/settings?access_token=${token}`,
				headers,
			})
		).statusCode,
	).toBe(401);
	first.version("version-two");
	expect((await first.app.inject({ url, headers })).statusCode).toBe(401);
	await first.app.close();
	apps.splice(apps.indexOf(first.app), 1);
	const second = await application(first.dataDir);
	expect(second.password).toBeUndefined();
	expect(
		(
			await second.app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(200);
	expect((await second.app.inject({ url, headers })).statusCode).toBe(200);
	await second.app.close();
	apps.splice(apps.indexOf(second.app), 1);
	await replaceCredential(
		first.dataDir,
		await hashPassword("replacement-password"),
	);
	const third = await application(first.dataDir);
	expect(
		(
			await third.app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(401);
	expect((await third.app.inject({ url, headers })).statusCode).toBe(401);
	await browser(third.app, "replacement-password");
});

test("session and media authorization expire at fixed deadlines", async () => {
	const { app, password } = await application();
	const { cookie, csrf } = await browser(app, password ?? "");
	const issuedAt = Date.now();
	const link = (
		await app.inject({
			url: "/api/media/file/access-link",
			method: "POST",
			headers: { ...headers, cookie, "x-csrf-token": csrf },
		})
	).json().url;
	const clock = vi
		.spyOn(Date, "now")
		.mockReturnValue(issuedAt + 86400000 + 1000);
	expect((await app.inject({ url: link, headers })).statusCode).toBe(401);
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(200);
	clock.mockReturnValue(issuedAt + 31 * 86400000);
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(401);
});
