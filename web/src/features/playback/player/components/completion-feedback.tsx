import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { request } from "../../../../shared/api/client.js";
import type {
	CompletionDecision,
	CompletionOutcome,
} from "../../../../shared/api/contracts.js";
import { boundedSignal } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";

export function CompletionFeedback({ token }: { token: string | undefined }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [status, setStatus] =
		useState<NonNullable<CompletionDecision["initialStatus"]>>("CURRENT");
	const key = ["playback-completion", token];
	const query = useQuery({
		queryKey: key,
		enabled: Boolean(token),
		queryFn: ({ signal }) =>
			request<CompletionOutcome>(
				`/api/playback/sessions/${token}/completion`,
				"GET",
				{ signal: boundedSignal(signal) },
			),
		refetchInterval: (query) =>
			["queued", "skipped"].includes(query.state.data?.state ?? "")
				? false
				: 2000,
		retry: false,
	});
	const decision = useMutation({
		mutationFn: (advance: boolean) =>
			request<CompletionOutcome>(
				`/api/playback/sessions/${token}/completion`,
				"POST",
				{ signal: AbortSignal.timeout(30000) },
				{ advance, initialStatus: status },
			),
		onSuccess: (data) => {
			client.setQueryData(key, data);
			void client.invalidateQueries({ queryKey: ["tracking", "operations"] });
		},
	});
	const outcome = query.data;
	if (!token || (!outcome && !query.error)) return null;
	const message = outcome
		? outcome.state === "decision-required"
			? t(
					outcome.reason === "initial-status-required"
						? "playbackCompletion.initial"
						: "playbackCompletion.advance",
					{ episode: outcome.episode },
				)
			: outcome.state === "skipped"
				? t(`playbackCompletion.reasons.${outcome.reason}`, {
						defaultValue: t("playbackCompletion.unchanged"),
					})
				: t(`playbackCompletion.${outcome.state}`)
		: null;
	return (
		<section
			aria-label={t("playbackCompletion.label")}
			className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
		>
			{message && (
				<p role="status" className="wrap-anywhere">
					{message}
				</p>
			)}
			{outcome?.state === "decision-required" && (
				<>
					{outcome.reason === "initial-status-required" && (
						<label className="flex flex-wrap items-center gap-2">
							{t("playbackCompletion.status")}
							<select
								className="min-w-0 rounded-md border bg-background p-2"
								aria-label={t("playbackCompletion.status")}
								value={status}
								onChange={(event) =>
									setStatus(event.target.value as typeof status)
								}
							>
								{(
									[
										"CURRENT",
										"PLANNING",
										"COMPLETED",
										"PAUSED",
										"DROPPED",
										"REPEATING",
									] as const
								).map((value) => (
									<option key={value} value={value}>
										{t(`trackingList.statuses.${value}`)}
									</option>
								))}
							</select>
						</label>
					)}
					<Button
						variant="outline"
						disabled={decision.isPending}
						onClick={() => decision.mutate(true)}
					>
						{t("playbackCompletion.confirm")}
					</Button>
					<Button
						variant="ghost"
						disabled={decision.isPending}
						onClick={() => decision.mutate(false)}
					>
						{t("playbackCompletion.keep")}
					</Button>
				</>
			)}
			{(query.error || decision.error) && (
				<div role="alert">
					<p>{t("playbackCompletion.error")}</p>
					<Button
						variant="outline"
						onClick={() => {
							decision.reset();
							void query.refetch();
						}}
					>
						{t("actions.retry")}
					</Button>
				</div>
			)}
			{outcome?.mediaId && (
				<Link to={`/anime/tracked/${outcome.mediaId}`} className="underline">
					{t("playbackCompletion.view")}
				</Link>
			)}
		</section>
	);
}
