import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { startBackend } from "./app/bootstrap/start-backend.js";

/** The returned device token is for the desktop main process. */
export async function startDesktopBackend({
	dataDir,
}: {
	dataDir: string;
}): Promise<{ origin: string; deviceToken: string; close(): Promise<void> }> {
	const deviceToken = randomBytes(32).toString("base64url");
	const backend = await startBackend({
		env: {
			PATH: process.env.PATH,
			PATHEXT: process.env.PATHEXT,
			ANISHELF_FFMPEG_PATH: process.env.ANISHELF_FFMPEG_PATH,
			ANISHELF_FFPROBE_PATH: process.env.ANISHELF_FFPROBE_PATH,
			ANISHELF_LOG_LEVEL: process.env.ANISHELF_LOG_LEVEL,
			ANISHELF_HOST: "127.0.0.1",
			ANISHELF_ALLOWED_HOSTS: "127.0.0.1",
			ANISHELF_DATA_DIR: dataDir,
			ANISHELF_LOG_DESTINATION: "both",
			ANISHELF_LOG_PATH: join(dataDir, "logs", "anishelf.log"),
		},
		listenPort: 0,
		localDeviceToken: deviceToken,
	});
	return { ...backend, deviceToken };
}
