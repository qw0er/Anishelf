import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test as base } from "@playwright/test";

const run = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));
const serverDist = join(repository, "apps/server/dist");

// An episode number alone gives automatic identification no title to look up.
export const sampleName = "01.mkv";

export const test = base.extend<{
	backend: { origin: string; password: string };
}>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a dependency pattern for fixtures.
	backend: async ({}, use) => {
		const directory = await mkdtemp(join(tmpdir(), "anishelf-e2e-"));
		const mediaDirectory = join(directory, "media");
		const ffmpeg = process.env.ANISHELF_FFMPEG_PATH || "ffmpeg";
		const env = {
			PATH: process.env.PATH,
			PATHEXT: process.env.PATHEXT,
			ANISHELF_DATA_DIR: join(directory, "data"),
			ANISHELF_HOST: "127.0.0.1",
			ANISHELF_FRONTEND_DIR: join(repository, "apps/web/dist"),
			ANISHELF_INITIAL_RESOURCE_ROOTS: mediaDirectory,
			ANISHELF_FFMPEG_PATH: process.env.ANISHELF_FFMPEG_PATH,
			ANISHELF_FFPROBE_PATH: process.env.ANISHELF_FFPROBE_PATH,
		};
		try {
			await mkdir(mediaDirectory);
			await run(
				ffmpeg,
				[
					"-nostdin",
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"testsrc2=size=128x72:rate=12",
					"-t",
					"24",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-g",
					"12",
					join(mediaDirectory, sampleName),
				],
				{ timeout: 15_000 },
			);
			const { stdout } = await run(
				process.execPath,
				[join(serverDist, "cli.js"), "auth", "reset-password"],
				{ env, timeout: 15_000 },
			);
			const password = /^New password: (\S+)$/m.exec(stdout)?.[1];
			if (!password) throw new Error("Test password setup failed.");

			const entry = pathToFileURL(
				join(serverDist, "app/bootstrap/start-backend.js"),
			);
			const {
				startBackend,
			}: typeof import("../apps/server/src/app/bootstrap/start-backend.js") =
				await import(entry.href);
			const backend = await startBackend({ env, listenPort: 0 });
			try {
				await use({ origin: backend.origin, password });
			} finally {
				await backend.close();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	baseURL: async ({ backend }, use) => {
		await use(backend.origin);
	},
});
