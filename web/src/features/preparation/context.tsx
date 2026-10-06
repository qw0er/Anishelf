import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext } from "react";
import type { TranscodeProfileCatalog } from "../../api/contracts.js";
import { keys, profilesQuery } from "../../api/queries.js";

import { usePreparations } from "./use-preparations.js";

type PreparationContextValue = ReturnType<typeof usePreparations> & {
	catalog: TranscodeProfileCatalog | null;
	catalogError: unknown;
	updateCatalog(value: TranscodeProfileCatalog): void;
	refreshCatalog(): void;
};
const Context = createContext<PreparationContextValue | null>(null);
export function PreparationProvider({ children }: { children: ReactNode }) {
	const list = usePreparations();
	const client = useQueryClient();
	const query = useQuery(profilesQuery());
	const catalog = query.data ?? null;
	const catalogError = query.error;
	return (
		<Context
			value={{
				...list,
				catalog,
				catalogError,
				updateCatalog: (value) => {
					client.setQueryData(keys.profiles, value);
				},
				refreshCatalog: useCallback(() => {
					void client.invalidateQueries({ queryKey: keys.profiles });
				}, [client]),
			}}
		>
			{children}
		</Context>
	);
}
export function usePreparationContext() {
	const value = useContext(Context);
	if (!value) throw new Error("PreparationProvider is required");
	return value;
}
