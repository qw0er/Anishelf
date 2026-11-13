import type { ErrorCode } from "@anishelf/contracts/errors";

export type { ErrorCode } from "@anishelf/contracts/errors";

/** Internal details/cause must never be serialized directly into API responses. */
export class DomainError extends Error {
	readonly code: ErrorCode;

	constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DomainError";
		this.code = code;
	}
}
