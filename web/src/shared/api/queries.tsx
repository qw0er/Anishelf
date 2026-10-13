import { createContext, useContext } from "react";
export const QueryScope = createContext("");
export const useQueryScope = () => useContext(QueryScope);
/** Shared request bound; features can provide a different timeout. */
export const boundedSignal = (signal: AbortSignal, timeout = 30000) =>
	AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
