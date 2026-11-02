import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { IdentificationStatusResponse } from "../../shared/api/contracts.js";
import { useQueryScope } from "../../shared/api/queries.js";
import { toast } from "../../shared/components/ui/toast.js";
import { interactionDefaults } from "../../shared/config/interaction-defaults.js";
import { identificationQuery } from "./metadata/public.js";
import { invalidateAnimeQueries } from "./shared/query-keys.js";

/** App-level observer; background recognition never occupies page layout. */
export function IdentificationStatus({
	enabled = true,
}: {
	enabled?: boolean;
}) {
	const { t } = useTranslation();
	const scope = useQueryScope();
	const client = useQueryClient();
	const status = useQuery({ ...identificationQuery(scope), enabled });
	const previous = useRef<IdentificationStatusResponse | null>(null);
	const notificationId = "automatic-identification";
	useEffect(() => () => toast.close(notificationId), []);
	useEffect(() => {
		if (!enabled) {
			toast.close(notificationId);
			previous.current = null;
			return;
		}
		if (!status.data) return;
		const current = status.data;
		const last = previous.current;
		previous.current = current;
		if (last && last.revision !== current.revision) {
			void invalidateAnimeQueries(client, "local");
		}
		const run = current.reviewRun;
		if (
			run &&
			last?.reviewRun?.id === run.id &&
			last.reviewRun.state === "running" &&
			run.state !== "running"
		) {
			void invalidateAnimeQueries(client, "local");
			toast.add({
				id: "pending-review-reidentification",
				type: run.state === "failed" || run.failed > 0 ? "error" : "success",
				title: t(
					run.state === "failed"
						? "review.reidentifyAllFailed"
						: "review.reidentifyAllCompleted",
					{ ...run },
				),
			});
		}
		if (run?.state === "running" || last?.reviewRun?.state === "running") {
			toast.close(notificationId);
			return;
		}
		if (last?.running === current.running && last?.failed === current.failed)
			return;
		if (last?.running && !current.running) {
			void invalidateAnimeQueries(client, "local");
		}
		if (current.incremental && !current.failed) {
			toast.close(notificationId);
			return;
		}
		if (current.running) {
			toast.close(notificationId);
			toast.add({
				id: notificationId,
				type: "loading",
				timeout: interactionDefaults.persistentToastTimeoutMs,
				title: t("review.identifying"),
			});
		} else if (current.failed || last?.running) {
			const options = {
				type: current.failed ? "error" : "success",
				timeout: current.failed
					? interactionDefaults.errorToastTimeoutMs
					: interactionDefaults.toastTimeoutMs,
				title: t(
					current.failed
						? "review.identificationFailed"
						: "review.identificationCompleted",
				),
			};
			if (last?.running) toast.update(notificationId, options);
			else toast.add({ id: notificationId, ...options });
		}
	}, [enabled, status.data, client, t]);
	return null;
}
