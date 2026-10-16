import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { request } from "../../../../shared/api/client.js";
import type {
	CompletionDecision,
	CompletionOutcome,
} from "../../../../shared/api/contracts.js";
import { boundedSignal } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "../../../../shared/components/ui/popover.js";
import { Spinner } from "../../../../shared/components/ui/spinner.js";

type Status = NonNullable<CompletionDecision["initialStatus"]>;
const statuses: Status[] = [
	"CURRENT",
	"PLANNING",
	"COMPLETED",
	"PAUSED",
	"DROPPED",
	"REPEATING",
];

/**
 * One labelled control carries saved, queued, blocked and failed completion state.
 * Marking watched and every decision stay reachable from it; the player shows no separate panel.
 */
export function CompletionControl({ token }: { token: string | undefined }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState<Status>("CURRENT");
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
		mutationFn: (input: CompletionDecision) =>
			request<CompletionOutcome>(
				`/api/playback/sessions/${token}/completion`,
				"POST",
				{ signal: AbortSignal.timeout(30000) },
				input,
			),
		onSuccess: (data) => {
			client.setQueryData(key, data);
			void client.invalidateQueries({ queryKey: ["tracking", "operations"] });
			if (data?.state !== "decision-required") setOpen(false);
		},
		// A failed command is the user's own action: surface it in the open control.
		onError: () => setOpen(true),
	});
	const outcome = query.data;
	const blocked = outcome?.state === "decision-required";
	useEffect(() => {
		if (blocked) setOpen(true);
	}, [blocked]);
	if (!token) return null;
	const failed = Boolean(query.error ?? decision.error);
	const waiting = decision.isPending || outcome?.state === "pending";
	const label = failed
		? t("playbackCompletion.retryButton")
		: waiting
			? t("playbackCompletion.marking")
			: outcome?.state === "queued"
				? t("playbackCompletion.queuedButton")
				: outcome?.state === "unavailable"
					? t("playbackCompletion.retryButton")
					: blocked
						? t("playbackCompletion.review")
						: t("playbackCompletion.mark");
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
	// Durable state is re-read instead of resubmitted; the worker owns admission retries.
	function activate() {
		if (open) return;
		if (failed) {
			decision.reset();
			void query.refetch();
			return;
		}
		if (outcome?.state === "unavailable") {
			void query.refetch();
			return;
		}
		if (!outcome || outcome.state === "skipped")
			decision.mutate({ advance: true });
	}
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={<Button type="button" variant="outline" />}
				onClick={activate}
			>
				{waiting ? (
					<Spinner aria-hidden="true" />
				) : failed || outcome?.state === "unavailable" ? (
					<RefreshCw size={16} aria-hidden="true" />
				) : (
					<Check size={16} aria-hidden="true" />
				)}
				{label}
			</PopoverTrigger>
			<PopoverContent>
				<PopoverTitle>{t("playbackCompletion.label")}</PopoverTitle>
				{message && (
					<p role="status" className="wrap-anywhere text-muted-foreground">
						{message}
					</p>
				)}
				{blocked && (
					<div className="flex flex-wrap items-center gap-2">
						{outcome?.reason === "initial-status-required" && (
							<label className="flex flex-wrap items-center gap-2">
								{t("playbackCompletion.status")}
								<select
									className="min-w-0 rounded-md border bg-background p-2"
									aria-label={t("playbackCompletion.status")}
									value={status}
									onChange={(event) => setStatus(event.target.value as Status)}
								>
									{statuses.map((value) => (
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
							onClick={() =>
								decision.mutate({ advance: true, initialStatus: status })
							}
						>
							{t("playbackCompletion.confirm")}
						</Button>
						<Button
							variant="ghost"
							disabled={decision.isPending}
							onClick={() => decision.mutate({ advance: false })}
						>
							{t("playbackCompletion.keep")}
						</Button>
					</div>
				)}
				{failed && (
					<div role="alert" className="grid gap-2">
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
			</PopoverContent>
		</Popover>
	);
}
