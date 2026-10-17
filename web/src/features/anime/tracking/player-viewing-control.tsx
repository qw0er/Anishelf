import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingEpisodeCommandRequest,
	TrackingEpisodeTargetResponse,
	TrackingOperationResponse,
} from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { Button } from "../../../shared/components/ui/button.js";
import { operationsQuery } from "./operations.js";
import { accountQuery, trackingIdentity } from "./queries.js";
import { useTrackingMutation } from "./use-tracking-mutation.js";
import { useViewingState } from "./use-viewing-state.js";
import { ViewingEditor } from "./viewing-editor.js";

/** Tracking owns player actions and their results; Playback only supplies a source identity. */
export function PlayerViewingControl({
	fileId,
	sourceVersion,
}: {
	fileId: string;
	sourceVersion: string;
}) {
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
			request<TrackingEpisodeTargetResponse | null>(
				`/api/tracking/episode-target?${new URLSearchParams({ fileId, sourceVersion })}`,
				"GET",
				{ signal: boundedSignal(signal) },
			),
	});
	if (target.error) return <TargetError retry={() => void target.refetch()} />;
	if (!target.data) return null;
	return (
		<TargetControl
			key={`${identity.generation}:${target.data.mediaId}:${target.data.episode}`}
			target={target.data}
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
	identity: { accountId: number | null; generation: string };
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
	const [status, setStatus] =
		useState<NonNullable<TrackingEpisodeCommandRequest["initialStatus"]>>(
			"CURRENT",
		);
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
				variant="outline"
				disabled={busy || Boolean(operations.error)}
				onClick={() => mutation.mutate("mark")}
			>
				{t(known ? "playbackCompletion.watched" : "playbackCompletion.mark")}
			</Button>
			{operation && (
				<span role="status" className="text-sm text-muted-foreground">
					{t(`trackingUpdate.states.${operation.state}`)}
				</span>
			)}
			{operation?.state === "decision-required" && (
				<>
					<span>
						{t(
							operation.decisionReason === "initial-status-required"
								? "playbackCompletion.initial"
								: "playbackCompletion.advance",
							{ episode: operation.desired.progress },
						)}
					</span>
					{operation.decisionReason === "initial-status-required" && (
						<select
							aria-label={t("playbackCompletion.status")}
							value={status}
							onChange={(e) => setStatus(e.target.value as typeof status)}
							className="rounded-md border bg-background p-2"
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
			{operation?.state === "failed" && (
				<Button
					variant="outline"
					disabled={mutation.isPending}
					onClick={() => mutation.mutate("retry")}
				>
					{t("actions.retry")}
				</Button>
			)}
			{operation?.state === "conflict" && (
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
			{operation?.state === "authorization-required" && (
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
			<ViewingEditor mediaId={String(target.mediaId)} state={viewing} />
		</fieldset>
	);
}
