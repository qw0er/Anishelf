import { readFileSync } from "node:fs";
import type { BuildInfo } from "../contracts/http.js";

function loadBuildInfo(): BuildInfo {
	try {
		return JSON.parse(
			readFileSync(new URL("../../build-info.json", import.meta.url), "utf8"),
		) as BuildInfo;
	} catch {
		const { version } = JSON.parse(
			readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
		) as { version: string };
		return { version, commit: null, channel: "development", builtAt: null };
	}
}
export const buildInfo = loadBuildInfo();
