import {
	BuildInfoSchema,
	UpdateCheckSchema,
} from "../../../contracts/schemas/index.js";
import { buildInfo } from "../../../platform/build-info.js";
import { DomainError } from "../../../shared/errors.js";
import type { HttpInstance } from "../../../transport/instance.js";
import { UpdateChecker } from "./application.js";

export function registerUpdateRoutes(app: HttpInstance): void {
	const checker = new UpdateChecker(buildInfo, app.log);
	app.get(
		"/api/system/info",
		{ schema: { response: { 200: BuildInfoSchema } } },
		async () => buildInfo,
	);
	app.post(
		"/api/system/updates/check",
		{ schema: { response: { 200: UpdateCheckSchema } } },
		async () => {
			try {
				return await checker.check();
			} catch (cause) {
				throw new DomainError("UPDATE_CHECK_FAILED", "Update check failed.", {
					cause,
				});
			}
		},
	);
}
