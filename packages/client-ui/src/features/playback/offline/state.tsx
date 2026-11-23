import {
	type OfflineCacheEntry,
	type OfflineCacheHost,
	offlineCachePath,
} from "@anishelf/contracts/offline-cache";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "../../../shared/components/ui/toast.js";

export type CacheOperation = "cancel" | "retry" | "remove";

type OfflineCacheState = {
	host: OfflineCacheHost;
	server: string;
	entries: readonly OfflineCacheEntry[];
	status: "loading" | "ready" | "error";
	refreshing: boolean;
	operations: ReadonlyMap<string, CacheOperation>;
	perform(operation: CacheOperation, id: string): Promise<boolean>;
	refresh(): void;
};

const OfflineCacheContext = createContext<OfflineCacheState | null>(null);
const empty: readonly OfflineCacheEntry[] = [];

export function useOfflineCache() {
	return useContext(OfflineCacheContext);
}

export function pendingCache(status: OfflineCacheEntry["status"]) {
	return (
		status === "queued" ||
		status === "preparing" ||
		status === "downloading" ||
		status === "finalizing"
	);
}

export function canRetryCache(entry: OfflineCacheEntry, server: string) {
	return (
		(entry.status === "failed" || entry.status === "unavailable") &&
		entry.server === server &&
		!entry.playing
	);
}

export function OfflineCacheProvider({
	children,
	cache,
	navigate,
}: {
	children: ReactNode;
	cache: { host: OfflineCacheHost; server: string };
	navigate(path: string): void;
}) {
	const { t } = useTranslation();
	const [entries, setEntries] = useState<readonly OfflineCacheEntry[]>(empty);
	const [status, setStatus] = useState<OfflineCacheState["status"]>("loading");
	const [readVersion, setReadVersion] = useState(0);
	const [refreshing, setRefreshing] = useState(true);
	const [operations, setOperations] = useState<
		ReadonlyMap<string, CacheOperation>
	>(() => new Map());
	const activeOperations = useRef(new Map<string, CacheOperation>());
	const loaded = useRef(false);
	const statuses = useRef(new Map<string, OfflineCacheEntry["status"]>());
	const { host, server } = cache;
	const listToast = "offline-cache-list";
	const refresh = useCallback(() => {
		setRefreshing(true);
		setReadVersion((value) => value + 1);
	}, []);

	const perform = useCallback(
		async (operation: CacheOperation, id: string) => {
			const active = activeOperations.current;
			if (active.has(id)) return false;
			active.set(id, operation);
			setOperations(new Map(active));
			const actionToast = `offline-cache-action:${id}`;
			toast.close(actionToast);
			try {
				await host[operation](id);
				return true;
			} catch {
				console.warn("offline_cache.action_failed", { id, operation });
				toast.add({
					id: actionToast,
					type: "error",
					title: t("offlineCache.actionFailed"),
				});
				return false;
			} finally {
				active.delete(id);
				setOperations(new Map(active));
			}
		},
		[host, t],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: readVersion requests a new inventory snapshot
	useEffect(() => {
		let disposed = false;
		let reading = true;
		const changed = new Map<string, OfflineCacheEntry | null>();
		const states = statuses.current;
		const unsubscribe = host.subscribe((entry, id) => {
			if (reading) changed.set(id, entry);
			const previous = states.get(id);
			if (entry) states.set(id, entry.status);
			else states.delete(id);
			setEntries((current) => {
				if (!entry) return current.filter((item) => item.id !== id);
				if (!current.some((item) => item.id === id)) return [...current, entry];
				return current.map((item) => (item.id === id ? entry : item));
			});
			const toastId = `offline-cache:${id}`;
			if (!entry) {
				toast.close(toastId);
				return;
			}
			if (entry.status === previous) return;
			if (entry.status === "queued") toast.close(toastId);
			if (previous && pendingCache(previous) && entry.status === "ready")
				toast.add({
					id: toastId,
					type: "success",
					title: t("offlineCache.completed"),
					description: entry.name,
					actionProps: {
						children: t("offlineCache.open"),
						onClick: () => navigate(offlineCachePath),
					},
				});
			if (previous && pendingCache(previous) && entry.status === "failed")
				toast.add({
					id: toastId,
					type: "error",
					title: t("offlineCache.failed"),
					description: `${entry.name} · ${t(`offlineCache.failure.${entry.failure ?? "download"}`)}`,
					actionProps: canRetryCache(entry, server)
						? {
								children: t("actions.retry"),
								onClick: () => void perform("retry", id),
							}
						: {
								children: t("offlineCache.open"),
								onClick: () => navigate(offlineCachePath),
							},
				});
		});
		void host.list().then(
			(snapshot) => {
				if (disposed) return;
				const merged = new Map(snapshot.map((entry) => [entry.id, entry]));
				for (const [id, entry] of changed) {
					if (entry) merged.set(id, entry);
					else merged.delete(id);
				}
				reading = false;
				changed.clear();
				states.clear();
				for (const entry of merged.values()) states.set(entry.id, entry.status);
				setEntries([...merged.values()]);
				loaded.current = true;
				setStatus("ready");
				setRefreshing(false);
				toast.close(listToast);
			},
			() => {
				if (disposed) return;
				reading = false;
				changed.clear();
				setRefreshing(false);
				if (!loaded.current) {
					setStatus("error");
					return;
				}
				toast.close(listToast);
				toast.add({
					id: listToast,
					type: "error",
					title: t("offlineCache.listFailed"),
					actionProps: { children: t("actions.retry"), onClick: refresh },
				});
			},
		);
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [host, navigate, perform, readVersion, refresh, server, t]);

	return (
		<OfflineCacheContext.Provider
			value={{
				host,
				server,
				entries,
				status,
				refreshing,
				operations,
				perform,
				refresh,
			}}
		>
			{children}
		</OfflineCacheContext.Provider>
	);
}
