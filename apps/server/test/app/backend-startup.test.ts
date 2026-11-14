import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import { expect, test, vi } from "vitest";
import { startDesktopBackend } from "../../src/desktop.js";

test("starts the desktop API on a dynamic loopback port and releases it on close", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-desktop-backend-"));
	vi.stubEnv("ANISHELF_HOST", "0.0.0.0");
	vi.stubEnv("ANISHELF_PORT", "1");
	vi.stubEnv("ANISHELF_FRONTEND_DIR", join(dataDir, "missing-frontend"));
	const stdout = vi.spyOn(process.stdout, "write");
	try {
		const backend = await startDesktopBackend({ dataDir });
		try {
			const address = new URL(backend.origin);
			expect(address.hostname).toBe("127.0.0.1");
			expect(Number(address.port)).toBeGreaterThan(1);
			const health = await fetch(new URL("/api/health", address));
			expect(await health.json()).toEqual({ status: "ok" });
			const protectedRoute = await fetch(new URL("/api/settings", address));
			expect(protectedRoute.status).toBe(401);
			await protectedRoute.body?.cancel();
			const headers = {
				Authorization: `Bearer ${backend.deviceToken}`,
				Origin: desktopOrigin,
			};
			const current = await fetch(
				new URL("/api/auth/device-sessions/current", address),
				{ headers },
			);
			expect(current.status).toBe(200);
			expect(current.headers.get("access-control-allow-origin")).toBe(
				desktopOrigin,
			);
			expect(await current.json()).toMatchObject({ name: "Anishelf Desktop" });
			const settings = await fetch(new URL("/api/settings", address), {
				headers,
			});
			expect(settings.status).toBe(200);
			await settings.body?.cancel();
			const forwarded = await fetch(new URL("/api/settings", address), {
				headers: { ...headers, "x-forwarded-proto": "https" },
			});
			expect(forwarded.status).toBe(403);
			await forwarded.body?.cancel();
			const login = await fetch(new URL("/api/auth/device-sessions", address), {
				method: "POST",
				headers,
			});
			expect(login.status).toBe(404);
			await login.body?.cancel();
			const root = await fetch(address);
			expect(root.status).toBe(404);
			await root.body?.cancel();
			await access(join(dataDir, "anishelf.sqlite"));
			await access(join(dataDir, "logs", "anishelf.log"));
			expect(
				stdout.mock.calls.some(([chunk]) =>
					String(chunk).includes("Initial password:"),
				),
			).toBe(false);
		} finally {
			await Promise.all([backend.close(), backend.close()]);
		}
		await expect(
			fetch(new URL("/api/health", backend.origin), {
				signal: AbortSignal.timeout(2_000),
			}),
		).rejects.toMatchObject({ cause: { code: "ECONNREFUSED" } });
		const log = await readFile(join(dataDir, "logs", "anishelf.log"), "utf8");
		expect(log.includes(backend.deviceToken)).toBe(false);
		const restarted = await startDesktopBackend({ dataDir });
		try {
			expect(restarted.deviceToken === backend.deviceToken).toBe(false);
			const rejected = await fetch(new URL("/api/settings", restarted.origin), {
				headers: { Authorization: `Bearer ${backend.deviceToken}` },
			});
			expect(rejected.status).toBe(401);
			await rejected.body?.cancel();
		} finally {
			await restarted.close();
		}
	} finally {
		stdout.mockRestore();
		vi.unstubAllEnvs();
		await rm(dataDir, { recursive: true, force: true });
	}
});
