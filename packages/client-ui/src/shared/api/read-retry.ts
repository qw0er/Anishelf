import { ApiClientError } from "./client.js";

const maximumRetries = 2;

export function readRetryOptions(operation: string) {
	return {
		retry(failureCount: number, error: Error) {
			if (failureCount >= maximumRetries || !(error instanceof ApiClientError))
				return false;
			const transient =
				error.kind === "network" ||
				(error.kind === "http" &&
					[408, 500, 502, 503, 504].includes(error.status ?? 0));
			if (transient)
				console.debug("UI read retry scheduled", {
					operation,
					attempt: failureCount + 1,
					kind: error.kind,
					status: error.status,
					code: error.code,
					requestId: error.requestId,
				});
			return transient;
		},
		retryDelay: (attempt: number) => 1000 * 2 ** attempt,
	};
}
