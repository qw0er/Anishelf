import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { getTranscodeProfiles } from "../../api/client.js";
import type {
	PreparationTaskResponse,
	TranscodeProfileCatalog,
} from "../../api/contracts.js";
import { interactionPolicy } from "../../config/interaction-policy.js";
import { usePreparations } from "./use-preparations.js";

type PreparationContextValue = ReturnType<typeof usePreparations> & {
	catalog: TranscodeProfileCatalog | null;
	catalogError: unknown;
	updateCatalog(value: TranscodeProfileCatalog): void;
	refreshCatalog(): void;
	remember(task: PreparationTaskResponse): void;
};
const Context = createContext<PreparationContextValue | null>(null);
export function PreparationProvider({
	children,
	libraryRevision,
}: {
	children: ReactNode;
	libraryRevision?: number | undefined;
}) {
	const list = usePreparations();
	const [catalog, setCatalog] = useState<TranscodeProfileCatalog | null>(null);
	const [catalogError, setCatalogError] = useState<unknown>(null);
	const [revision, setRevision] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit catalog refresh trigger
	useEffect(() => {
		const controller = new AbortController();
		void getTranscodeProfiles({
			signal: AbortSignal.any([
				controller.signal,
				AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
			]),
		})
			.then((value) => {
				if (!controller.signal.aborted) {
					setCatalog(value);
					setCatalogError(null);
				}
			})
			.catch((error) => {
				if (!controller.signal.aborted) setCatalogError(error);
			});
		return () => controller.abort();
	}, [revision]);
	const { refresh } = list;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a completed library scan revalidates cached outputs
	useEffect(() => {
		refresh();
	}, [libraryRevision, refresh]);
	return (
		<Context
			value={{
				...list,
				catalog,
				catalogError,
				updateCatalog: setCatalog,
				refreshCatalog: useCallback(() => setRevision((v) => v + 1), []),
				remember: list.remember,
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
