import type { createApiClient } from "@anishelf/client-core";
import { getClientRuntime } from "./connection.js";

export {
	ApiClientError,
	isRequestCancelled,
	type RequestOptions,
} from "@anishelf/client-core";

type ApiClient = ReturnType<typeof createApiClient>;
export const request: ApiClient["request"] = (...args) =>
	getClientRuntime().connection.api.request(...args);
export const loadAuthSession = () =>
	getClientRuntime().connection.api.loadAuthSession();
