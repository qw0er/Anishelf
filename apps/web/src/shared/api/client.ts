import { webConnection } from "./connection.js";

export {
	ApiClientError,
	isRequestCancelled,
	type RequestOptions,
} from "@anishelf/client-core";

export const { request, loadAuthSession, clearAuthToken } = webConnection.api;
