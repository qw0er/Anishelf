import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../src/errors.js";

test("domain errors preserve the code and original cause for diagnostics", () => {
  const cause = new Error("filesystem failure");
  const error = new DomainError("RESOURCE_UNREADABLE", "This file is unreadable.", { cause });
  assert.ok(error instanceof Error);
  assert.equal(error.name, "DomainError");
  assert.equal(error.code, "RESOURCE_UNREADABLE");
  assert.equal(error.message, "This file is unreadable.");
  assert.equal(error.cause, cause);
});
