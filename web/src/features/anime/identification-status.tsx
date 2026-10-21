import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueryScope } from "../../shared/api/queries.js";
import { toast } from "../../shared/components/ui/toast.js";
import { interactionPolicy } from "../../shared/config/interaction-policy.js";
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
	const previous = useRef<{
		running: boolean;
		failed: boolean;
		revision?: number;
		incremental?: boolean;
	} | null>(null);
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
				timeout: interactionPolicy.persistentToastTimeoutMs,
				title: t("review.identifying"),
			});
		} else if (current.failed || last?.running) {
			const options = {
				type: current.failed ? "error" : "success",
				timeout: current.failed
					? interactionPolicy.errorToastTimeoutMs
					: interactionPolicy.toastTimeoutMs,
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
