import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invalidateAnimeQueries } from "../../features/anime/public.js";
import { startScan as startScanRequest } from "../../features/resources/public.js";
import type { LibraryResponse } from "../../shared/api/contracts.js";
import { toast } from "../../shared/components/ui/toast.js";
import {
	getErrorTranslationKey,
	getScanWarningTranslationKey,
} from "../../shared/lib/error-translation.js";
export function useScans(library: LibraryResponse | null) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const scanMutation = useMutation({
		mutationFn: () => startScanRequest(),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["library"] });
		},
		onError: (error) =>
			toast.add({
				id: "scan-start",
				type: "error",
				priority: "high",
				title: t(getErrorTranslationKey(error) ?? "errors.startScan"),
			}),
	});
	const scanning = library?.scan?.status === "running";
	const lastRevision = useRef(library?.revision);
	useEffect(() => {
		if (library && lastRevision.current !== library.revision) {
			lastRevision.current = library.revision;
			void invalidateAnimeQueries(client, "local");
			for (const queryKey of [
				["directory"],
				["history"],

				["identification"],
			])
				void client.invalidateQueries({ queryKey });
		}
	}, [library, client]);
	const lastScan = useRef(library?.scan);
	useEffect(() => {
		const scan = library?.scan;
		if (!scan) return;
		const previous = lastScan.current;
		lastScan.current = scan;
		if (previous?.id === scan.id && previous.status === scan.status) return;
		const id = `scan-result:${scan.id}`;
		if (scan.status === "completed") {
			const warningDetails = scan.warnings.messages
				.map((message) => {
					const key = getScanWarningTranslationKey(message);
					return key ? t(key) : message;
				})
				.join(" · ");
			const description = [
				t("scan.visitedEntries", {
					count: scan.visitedCount,
					matched: scan.matchedCount,
				}),
				warningDetails,
			]
				.filter(Boolean)
				.join(" · ");
			if (scan.warnings.count > 0)
				toast.add({
					type: "warning",
					title: t("scan.completedWithWarnings", {
						count: scan.warnings.count,
					}),
					description,
					id,
				});
			else
				toast.add({
					type: "success",
					title: t("scan.completed"),
					description,
					id,
				});
		} else if (scan.status === "failed") {
			toast.add({
				type: "error",
				priority: "high",
				title: t(`errors.api.${scan.error.code}`),
				id,
			});
		}
	}, [library?.scan, t]);
	const scanSubmitting = scanMutation.isPending;
	const scanPending = scanMutation.isPending;
	function startScan() {
		toast.close("scan-start");
		scanMutation.mutate();
	}
	return { scanning, scanSubmitting, scanPending, startScan };
}
