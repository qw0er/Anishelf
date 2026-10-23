import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRevalidator } from "react-router";
import {
	clearCapabilityCache,
	clearCompatibilityCache,
} from "../../features/media/public.js";
import { toast } from "../../shared/components/ui/toast.js";

export function useManualRefresh(libraryError: string | null) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const { revalidate, state: revalidationState } = useRevalidator();
	const [playerVersion, setPlayerVersion] = useState(0);
	const [manualRefreshing, setManualRefreshing] = useState(false);
	const refreshRequested = useRef(false);
	useEffect(() => {
		if (
			!refreshRequested.current ||
			manualRefreshing ||
			revalidationState !== "idle"
		)
			return;
		refreshRequested.current = false;
		if (libraryError)
			toast.add({
				id: "library-refresh",
				type: "error",
				priority: "high",
				title: t(libraryError),
			});
	}, [manualRefreshing, revalidationState, libraryError, t]);
	async function reload() {
		refreshRequested.current = true;
		toast.close("library-refresh");
		setManualRefreshing(true);
		setPlayerVersion((value) => value + 1);
		try {
			clearCapabilityCache();
			await clearCompatibilityCache();
			await client.invalidateQueries({
				predicate: (query) =>
					!["playback-selection", "library", "settings"].includes(
						String(query.queryKey[0]),
					),
			});
			await revalidate();
		} finally {
			setManualRefreshing(false);
		}
	}

	return { playerVersion, reload, refreshing: manualRefreshing };
}
