import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import {
	loadCredentials,
	verifyPassword,
} from "../../../../src/modules/system/authentication/infrastructure/credentials.js";

const execute = promisify(execFile);
test("CLI reset recovers corrupt credentials without starting HTTP or media tools", async () => {
	const path = await mkdtemp(join(tmpdir(), "anishelf-auth-cli-"));
	try {
		await writeFile(join(path, "auth.json"), "broken");
		const { stdout, stderr } = await execute(
			process.execPath,
			[
				"--import",
				"tsx",
				fileURLToPath(new URL("../../../../src/cli.ts", import.meta.url)),
				"auth",
				"reset-password",
			],
			{
				env: {
					...process.env,
					ANISHELF_DATA_DIR: path,
					ANISHELF_FFMPEG_PATH: "/nonexistent/ffmpeg",
					ANISHELF_FFPROBE_PATH: "/nonexistent/ffprobe",
				},
			},
		);
		expect(stderr).toBe("");
		const password = /New password: ([A-Za-z0-9_-]+)/.exec(stdout)?.[1] ?? "";
		expect(password).toHaveLength(32);
		expect(stdout).toContain("Restart Anishelf");
		const { credential, initialPassword } = await loadCredentials(path);
		expect(initialPassword).toBeUndefined();
		expect(await verifyPassword(password, credential)).toBe(true);
		expect(await readFile(join(path, "auth.json"), "utf8")).not.toContain(
			password,
		);
		await expect(readFile(join(path, "anishelf.sqlite"))).rejects.toMatchObject(
			{ code: "ENOENT" },
		);
	} finally {
		await rm(path, { recursive: true, force: true });
	}
});
