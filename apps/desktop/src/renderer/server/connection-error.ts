import type { ServerSignInResult } from "../../ipc/desktop.js";

export function connectionError(
	result: Exclude<ServerSignInResult, { status: "ok" }>,
) {
	if (result.status !== "rejected") return result.status;
	if (result.httpStatus === 401) return "invalidPassword";
	if (result.httpStatus === 429) return "rateLimited";
	return "signInFailed";
}
