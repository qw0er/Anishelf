import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { libraryQuery } from "../../features/resources/public.js";
import { settingsQuery } from "../../features/settings/public.js";
import { toast } from "../../shared/components/ui/toast.js";

export function useManualRefresh(libraryError: string | null) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [manualRefreshing, setManualRefreshing] = useState(false);
	const refreshRequested = useRef(false);
	useEffect(() => {
		if (!refreshRequested.current || manualRefreshing) return;
		refreshRequested.current = false;
		if (libraryError)
			toast.add({
				id: "library-refresh",
				type: "error",
				priority: "high",
				title: t(libraryError),
			});
	}, [manualRefreshing, libraryError, t]);
	async function reload() {
		refreshRequested.current = true;
		toast.close("library-refresh");
		setManualRefreshing(true);
		try {
			await Promise.all([
				client.invalidateQueries({ queryKey: libraryQuery().queryKey }),
				client.invalidateQueries({ queryKey: settingsQuery().queryKey }),
			]);
			await client.invalidateQueries({
				predicate: (query) =>
					query.isActive() &&
					!["playback-selection", "library", "settings"].includes(
						String(query.queryKey[0]),
					),
			});
		} finally {
			setManualRefreshing(false);
		}
	}

	return { reload, refreshing: manualRefreshing };
}
