import { useQuery } from "@tanstack/react-query";
import { Check, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingEpisodeCommandRequest,
	TrackingEpisodeResolutionResponse,
	TrackingEpisodeTargetResponse,
	TrackingOperationResponse,
} from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { Button } from "../../../shared/components/ui/button.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../shared/components/ui/collapsible.js";
import { RadioOptions } from "../../../shared/components/ui/radio-options.js";
import {
	appliesToEpisode,
	isResultState,
	operationsQuery,
} from "./operations.js";
import { accountQuery, trackingIdentity } from "./queries.js";
import { useTrackingMutation } from "./use-tracking-mutation.js";
import { useViewingState } from "./use-viewing-state.js";

/** Tracking owns player actions and their results; Playback only supplies a source identity. */
export function PlayerViewingControl({
	fileId,
	sourceVersion,
}: {
	fileId: string;
	sourceVersion: string;
}) {
	const { t } = useTranslation();
	const account = useQuery(accountQuery());
	const identity = account.data
		? trackingIdentity(account.data)
		: { accountId: null, generation: "" };
	const target = useQuery({
		queryKey: [
			"tracking",
			"target",
			identity.accountId,
			identity.generation,
			fileId,
			sourceVersion,
		],
		enabled: Boolean(identity.accountId),
		retry: false,
		queryFn: ({ signal }) =>
			request<TrackingEpisodeResolutionResponse>(
				`/api/tracking/episode-target?${new URLSearchParams({ fileId, sourceVersion })}`,
				"GET",
				{ signal: boundedSignal(signal) },
			),
	});
	if (target.error) return <TargetError retry={() => void target.refetch()} />;
	if (!target.data) return null;
	if (!target.data.target)
		return (
			<Collapsible className="text-sm text-muted-foreground">
				<CollapsibleTrigger className="cursor-pointer py-3">
					{t("player.tracking")}
				</CollapsibleTrigger>
				<CollapsibleContent keepMounted>
					<p>{t(`trackingTarget.${target.data.state}`)}</p>
				</CollapsibleContent>
			</Collapsible>
		);
	return (
		<TargetControl
			key={`${identity.generation}:${target.data.target.mediaId}:${target.data.target.episode}`}
			target={target.data.target}
			identity={identity}
		/>
	);
}
function TargetError({ retry }: { retry(): void }) {
	const { t } = useTranslation();
	return (
		<Button variant="outline" onClick={retry}>
			{t("playbackCompletion.retryButton")}
		</Button>
	);
}
function TargetControl({
	target,
	identity,
}: {
	target: TrackingEpisodeTargetResponse;
	identity: { accountId: string | null; generation: string };
}) {
	const { t } = useTranslation();
	const viewing = useViewingState(String(target.mediaId));
	const operations = useQuery({
		...operationsQuery(identity, true),
		enabled: Boolean(identity.accountId),
	});
	const operation = operations.data?.find(
		(op) => op.mediaId === target.mediaId,
	);
	// Only this episode's open work stays beside the control: a result belongs to the
	// episode it was made for and has already been announced as a notification.
	const current =
		operation && appliesToEpisode(operation, target) ? operation : undefined;
	const [status, setStatus] = useState<
		NonNullable<TrackingEpisodeCommandRequest["initialStatus"]>
	>(viewing.snapshot?.provider.capabilities.statuses[0] ?? "watching");
	type Action = "mark" | "confirm" | "keep" | "retry" | "remote" | "local";
	const mutation = useTrackingMutation(
		identity,
		(action: Action, commandId) => {
			const revision = operation?.revision ?? null;
			if (action === "retry" || action === "remote" || action === "local")
				return request<TrackingOperationResponse>(
					`/api/tracking/operations/${operation?.id}/${action === "retry" ? "retry" : "resolve"}`,
					"POST",
					{},
					{
						generation: identity.generation,
						revision,
						...(action === "retry" ? {} : { keepRemote: action === "remote" }),
					},
				);
			const source =
				action === "confirm" || action === "keep"
					? (operation?.target ?? target)
					: target;
			return request<TrackingOperationResponse>(
				"/api/tracking/episode-commands",
				"POST",
				{},
				{
					commandId,
					generation: identity.generation,
					revision,
					mappingRevision: source.mappingRevision,
					fileId: source.fileId,
					sourceVersion: source.sourceVersion,
					action: action === "keep" ? "keep" : "mark",
					...(action === "confirm"
						? { confirmSkipped: true, initialStatus: status }
						: {}),
				} satisfies TrackingEpisodeCommandRequest,
			);
		},
		{ revision: operation?.revision, status, target },
	);
	const known = (viewing.snapshot?.entry?.progress ?? 0) >= target.episode;
	const busy =
		mutation.isPending ||
		operations.isPending ||
		operation?.state === "pending" ||
		operation?.state === "submitting";
	return (
		<fieldset
			className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
			aria-label={t("playbackCompletion.label")}
		>
			<Button
				variant={known ? "secondary" : "outline"}
				aria-label={t(
					known ? "playbackCompletion.watched" : "playbackCompletion.mark",
				)}
				disabled={busy || Boolean(operations.error)}
				onClick={() => mutation.mutate("mark")}
			>
				{known ? (
					<CheckCheck className="size-4 shrink-0" aria-hidden="true" />
				) : (
					<Check className="size-4 shrink-0" aria-hidden="true" />
				)}
				{t(known ? "player.watched" : "playbackCompletion.mark")}
			</Button>
			{current &&
				!isResultState(current.state) &&
				current.state !== "pending" &&
				current.state !== "submitting" && (
					<span role="status" className="text-sm text-muted-foreground">
						{t(`trackingUpdate.states.${current.state}`)}
					</span>
				)}
			{current?.state === "decision-required" && (
				<>
					<span>
						{t(
							current.decisionReason === "initial-status-required"
								? "playbackCompletion.initial"
								: "playbackCompletion.advance",
							{ episode: current.desired.progress },
						)}
					</span>
					{current.decisionReason === "initial-status-required" && (
						<RadioOptions<typeof status>
							legend={t("playbackCompletion.status")}
							value={status}
							onChange={setStatus}
							options={(
								viewing.snapshot?.provider.capabilities.statuses ?? []
							).map((value) => ({
								value,
								label: t(`trackingList.statuses.${value}`),
							}))}
						/>
					)}
					<Button
						variant="outline"
						disabled={mutation.isPending}
						onClick={() => mutation.mutate("confirm")}
					>
						{t("playbackCompletion.confirm")}
					</Button>
					<Button
						variant="ghost"
						disabled={mutation.isPending}
						onClick={() => mutation.mutate("keep")}
					>
						{t("playbackCompletion.keep")}
					</Button>
				</>
			)}
			{current?.state === "failed" && (
				<Button
					variant="outline"
					disabled={mutation.isPending}
					onClick={() => mutation.mutate("retry")}
				>
					{t("actions.retry")}
				</Button>
			)}
			{current?.state === "conflict" && (
				<>
					<Button
						variant="outline"
						disabled={mutation.isPending}
						onClick={() => mutation.mutate("remote")}
					>
						{t("trackingUpdate.keepRemote")}
					</Button>
					<Button
						variant="outline"
						disabled={mutation.isPending}
						onClick={() => mutation.mutate("local")}
					>
						{t("trackingUpdate.submitLocal")}
					</Button>
				</>
			)}
			{current?.state === "authorization-required" && (
				<span role="alert">{t("trackingList.reconnect")}</span>
			)}
			{(mutation.error || operations.error) && (
				<p role="alert">
					{mutation.error?.message ?? t("playbackCompletion.error")}
					{operations.error && (
						<Button variant="outline" onClick={() => void operations.refetch()}>
							{t("actions.retry")}
						</Button>
					)}
				</p>
			)}
		</fieldset>
	);
}
