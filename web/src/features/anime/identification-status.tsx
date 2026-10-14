import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueryScope } from "../../shared/api/queries.js";
import { identificationQuery } from "./metadata/public.js";

export function IdentificationStatus() {
	const { t } = useTranslation();
	const scope = useQueryScope();
	const client = useQueryClient();
	const status = useQuery(identificationQuery(scope));
	const previous = useRef(false);
	useEffect(() => {
		const running = status.data?.running ?? false;
		if (previous.current && !running)
			void client.invalidateQueries({ queryKey: ["catalog"] });
		previous.current = running;
	}, [status.data?.running, client]);
	return status.data?.running ? (
		<p role="status" className="text-sm text-muted-foreground">
			{t("review.identifying")}
		</p>
	) : status.data?.failed ? (
		<p role="alert">{t("review.identificationFailed")}</p>
	) : null;
}
