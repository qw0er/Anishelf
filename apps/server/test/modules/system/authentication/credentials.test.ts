import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { openDatabase } from "../../../../src/app/bootstrap/database.js";
import {
	hashPassword,
	loadCredentials,
	replaceCredential,
	verifyPassword,
} from "../../../../src/modules/system/authentication/infrastructure/credentials.js";

import {
	application,
	browser,
	directory,
	headers,
	setupTestLifecycle,
} from "./support/authentication-fixture.js";

setupTestLifecycle();

test("credentials initialize once, privately and without storing the password", async () => {
	const path = await directory();
	const results = await Promise.all([
		loadCredentials(path),
		loadCredentials(path),
	]);
	expect(results.filter((result) => result.initialPassword)).toHaveLength(1);
	const winner = results.find((result) => result.initialPassword);
	expect(
		await verifyPassword(winner?.initialPassword ?? "", results[0].credential),
	).toBe(true);
	expect(results[0].credential).toEqual(results[1].credential);
	expect((await stat(join(path, "auth.json"))).mode & 0o777).toBe(0o600);
	expect((await stat(path)).mode & 0o777).toBe(0o700);
	expect(await readFile(join(path, "auth.json"), "utf8")).not.toContain(
		winner?.initialPassword,
	);
	expect((await loadCredentials(path)).initialPassword).toBeUndefined();
	await writeFile(join(path, "auth.json"), "broken");
	await expect(loadCredentials(path)).rejects.toThrow();
	expect(await readFile(join(path, "auth.json"), "utf8")).toBe("broken");
});

test("passwords trim outer whitespace and require eight characters", async () => {
	const credential = await hashPassword("  correct-horse  ");
	expect(await verifyPassword("correct-horse", credential)).toBe(true);
	expect(await verifyPassword("  correct-horse  ", credential)).toBe(true);
	const internal = await hashPassword("pass word");
	expect(await verifyPassword("pass word", internal)).toBe(true);
	expect(await verifyPassword("password", internal)).toBe(false);
	await expect(hashPassword("       ")).rejects.toThrow("8–128");
	await expect(hashPassword("1234567")).rejects.toThrow("8–128");
	await expect(hashPassword("12345678")).resolves.toMatchObject({
		algorithm: "scrypt",
	});
});

test("password change invalidates sessions, rejects incorrect current password and trims outer spaces", async () => {
	const { app, password } = await application();
	const first = await browser(app, password ?? "");
	const second = await browser(app, password ?? "");
	const link = (
		await app.inject({
			url: "/api/media/file/access-link",
			method: "POST",
			headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
		})
	).json().url;
	const change = (currentPassword: string, next = "new-password-long") =>
		app.inject({
			url: "/api/auth/password",
			method: "PUT",
			headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
			payload: { currentPassword, password: next },
		});
	expect((await change("wrong-password")).statusCode).toBe(401);
	expect((await change(password ?? "", "1234567")).statusCode).toBe(400);
	expect((await change(password ?? "", "        ")).statusCode).toBe(400);
	expect(
		(await change(`  ${password ?? ""}  `, "  new-password-long  ")).statusCode,
	).toBe(204);
	for (const cookie of [first.cookie, second.cookie])
		expect(
			(
				await app.inject({
					url: "/api/settings",
					headers: { ...headers, cookie },
				})
			).statusCode,
		).toBe(401);
	expect((await app.inject({ url: link, headers })).statusCode).toBe(401);
	await browser(app, "  new-password-long  ");
});

test("corrupt authentication persistence blocks startup without initializing a password", async () => {
	const path = await directory();
	await writeFile(join(path, "anishelf.sqlite"), "broken database");
	expect(() => openDatabase(path, pino({ enabled: false }))).toThrow();
	await expect(readFile(join(path, "auth.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test("unsupported credentials and invalid signing keys fail closed", async () => {
	const path = await directory();
	const loaded = await loadCredentials(path);
	await writeFile(
		join(path, "auth.json"),
		JSON.stringify({ ...loaded.credential, version: 2 }),
	);
	await expect(loadCredentials(path)).rejects.toThrow("Invalid auth.json");
	await replaceCredential(path, loaded.credential);
	await writeFile(join(path, "auth-session.key"), "invalid key");
	await expect(loadCredentials(path)).rejects.toThrow(
		"Invalid auth-session.key",
	);
});
