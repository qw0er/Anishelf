import type { HttpInstance } from "../../transport/instance.js";
import { registerTranscodeProfileRoutes } from "./configuration/http/transcode-profiles.js";
import type { SystemApi } from "./public.js";
export function registerSystemHttp(app: HttpInstance, api: SystemApi): void {
	registerTranscodeProfileRoutes(app, api);
}
