import { expect, test } from "vitest";
import { DomainError } from "../src/errors.js";

test("domain errors preserve the code and original cause for diagnostics", () => {
	const cause = new Error("filesystem failure");
	const error = new DomainError(
		"RESOURCE_UNREADABLE",
		"This file is unreadable.",
		{ cause },
	);
	expect(error).toBeInstanceOf(Error);
	expect(error.name).toBe("DomainError");
	expect(error.code).toBe("RESOURCE_UNREADABLE");
	expect(error.message).toBe("This file is unreadable.");
	expect(error.cause).toBe(cause);
});
