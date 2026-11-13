import { createContext, useContext } from "react";
export const QueryScope = createContext("");
export const useQueryScope = () => useContext(QueryScope);
/** Shared request bound; features can provide a different timeout. */
export const boundedSignal = (signal: AbortSignal, timeout = 30000) =>
	AbortSignal.any([signal, AbortSignal.timeout(timeout)]);

/** Resource roots identify the cache owner; the revision identifies its publication. */
export function queryScopeIdentity(scope: string): string {
	try {
		const value: unknown = JSON.parse(scope);
		if (
			Array.isArray(value) &&
			value.length === 2 &&
			(value[0] === null || Array.isArray(value[0])) &&
			(value[1] === null || typeof value[1] === "number")
		)
			return JSON.stringify(value[0]);
	} catch {
		// Opaque scopes used by other consumers retain their full identity.
	}
	return scope;
}
