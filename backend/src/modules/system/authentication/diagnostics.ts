/** Keep operational error categories without logging messages, SQL parameters or causes. */
export function authenticationFailure(error: unknown): {
	errorType: string;
	errorCode: string;
} {
	const errorType =
		error instanceof SyntaxError
			? "SyntaxError"
			: error instanceof TypeError
				? "TypeError"
				: error instanceof RangeError
					? "RangeError"
					: error instanceof Error
						? "Error"
						: "Unknown";
	let cause: unknown = error;
	for (
		let depth = 0;
		depth < 3 && typeof cause === "object" && cause !== null;
		depth++
	) {
		if (
			"code" in cause &&
			typeof cause.code === "string" &&
			/^(?:E[A-Z0-9_]{1,40}|SQLITE_[A-Z_]{1,40})$/.test(cause.code)
		)
			return { errorType, errorCode: cause.code };
		cause = "cause" in cause ? cause.cause : undefined;
	}
	return { errorType, errorCode: "UNKNOWN" };
}
