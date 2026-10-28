import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiClientError, request } from "../../../shared/api/client.js";
import type {
	TrackingEntryResponse,
	TrackingOperationResponse,
	TrackingUpdateRequest,
} from "../../../shared/api/contracts.js";
import { Button } from "../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "../../../shared/components/ui/dialog.js";
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";
import { operationsQuery } from "./operations.js";
import { useTrackingMutation } from "./use-tracking-mutation.js";
import type { ViewingState } from "./use-viewing-state.js";

type Status = NonNullable<TrackingEntryResponse["entry"]>["status"];
export function ViewingEditor({
	state,
	mediaId,
}: {
	state: ViewingState;
	mediaId: string;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const snapshot = state.snapshot;
	const identity = {
		accountId: snapshot?.accountId ?? null,
		generation: snapshot?.generation ?? "",
	};
	const operations = useQuery({
		...operationsQuery(identity),
		enabled: Boolean(identity.accountId && identity.generation),
	});
	const operation = operations.data?.find((op) => op.mediaId === mediaId);
	if (snapshot?.state !== "connected" || snapshot.fetchedAt === null)
		return null;
	return (
		<>
			<Button
				variant="ghost"
				className="h-7 px-2 text-xs text-muted-foreground"
				onClick={() => setOpen(true)}
			>
				{t("trackingUpdate.edit")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogTitle>{t("trackingUpdate.edit")}</DialogTitle>
					{operations.isPending ? (
						<p role="status">{t("anime.loading")}</p>
					) : operations.error ? (
						<div role="alert">
							<p>{t("errors.pageLoad")}</p>
							<Button onClick={() => void operations.refetch()}>
								{t("actions.retry")}
							</Button>
						</div>
					) : (
						<ViewingForm
							key={`${snapshot.generation}:${operation?.revision ?? 0}`}
							mediaId={mediaId}
							snapshot={snapshot}
							operation={operation}
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
function ViewingForm({
	mediaId,
	snapshot,
	operation,
}: {
	mediaId: string;
	snapshot: TrackingEntryResponse;
	operation: TrackingOperationResponse | undefined;
}) {
	const { t } = useTranslation();
	const progressId = useId();
	const statusId = useId();
	const pending =
		operation && !["succeeded", "cancelled"].includes(operation.state);
	const remote =
		operation && (snapshot.fetchedAt ?? 0) < operation.updatedAt
			? operation.remote
			: snapshot.entry;
	const [progress, setProgress] = useState(
		String(
			(pending ? operation.desired.progress : undefined) ??
				remote?.progress ??
				0,
		),
	);
	const [status, setStatus] = useState<Status>(
		(pending ? operation.desired.status : undefined) ??
			remote?.status ??
			snapshot.provider.capabilities.statuses[0] ??
			"watching",
	);
	const [progressEdited, setProgressEdited] = useState(false);
	const [statusEdited, setStatusEdited] = useState(false);
	const progressChanged =
		progressEdited &&
		(Number(progress) !== remote?.progress ||
			Boolean(
				pending &&
					operation.desired.progress !== undefined &&
					Number(progress) !== operation.desired.progress,
			));
	const statusChanged =
		statusEdited &&
		(status !== remote?.status ||
			Boolean(
				pending &&
					operation.desired.status !== undefined &&
					status !== operation.desired.status,
			));
	const mutation = useTrackingMutation(
		{ accountId: snapshot.accountId, generation: snapshot.generation },
		async (
			command: "update" | "retry" | "remote" | "local" | "confirm" | "keep",
			commandId,
		) => {
			const revision = operation?.revision ?? null;
			const body = { generation: snapshot.generation, revision };
			if ((command === "confirm" || command === "keep") && operation?.target)
				return request<TrackingOperationResponse>(
					"/api/tracking/episode-commands",
					"POST",
					{},
					{
						...body,
						commandId,
						mappingRevision: operation.target.mappingRevision,
						fileId: operation.target.fileId,
						sourceVersion: operation.target.sourceVersion,
						action: command === "keep" ? "keep" : "mark",
						confirmSkipped: true,
						initialStatus: status,
					},
				);
			if (command !== "update")
				return request<TrackingOperationResponse>(
					`/api/tracking/operations/${operation?.id}/${command === "retry" ? "retry" : "resolve"}`,
					"POST",
					{},
					command === "retry"
						? body
						: { ...body, keepRemote: command === "remote" },
				);
			const desired: TrackingUpdateRequest["desired"] = {};
			if (!remote || progressChanged) desired.progress = Number(progress);
			if (!remote || statusChanged) desired.status = status;
			return request<TrackingOperationResponse>(
				`/api/tracking/entries/${encodeURIComponent(mediaId)}/updates`,
				"POST",
				{},
				{
					...body,
					commandId,
					baseline: remote
						? {
								id: remote.id,
								progress: remote.progress,
								status: remote.status,
								updatedAt: remote.updatedAt,
							}
						: null,
					desired,
				},
			);
		},
		{
			progress,
			status,
			progressEdited,
			statusEdited,
			revision: operation?.revision,
			remote,
		},
	);
	const valid =
		progress.trim() !== "" &&
		Number.isInteger(Number(progress)) &&
		Number(progress) >= 0 &&
		Number(progress) <= snapshot.provider.capabilities.maximumProgress;
	const changed = !remote || progressChanged || statusChanged;
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (valid && changed) mutation.mutate("update");
			}}
		>
			<p className="text-sm text-muted-foreground">
				{remote
					? t("trackingUpdate.confirmed", {
							progress: remote.progress,
							count: remote.progress,
							status: t(`trackingList.statuses.${remote.status}`),
						})
					: t("trackingList.untracked")}
			</p>
			<div className="grid gap-1">
				<div className="flex items-center gap-1">
					<label htmlFor={progressId}>{t("trackingUpdate.progress")}</label>
					<FieldHelp
						label={t("trackingUpdate.progressHelp")}
						help={t("trackingUpdate.cumulative")}
					/>
				</div>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						aria-label={t("trackingUpdate.decrease")}
						disabled={!valid || Number(progress) <= 0}
						onClick={() => {
							setProgressEdited(true);
							setProgress(String(Number(progress) - 1));
						}}
					>
						−
					</Button>
					<Input
						id={progressId}
						type="number"
						min={0}
						max={snapshot.provider.capabilities.maximumProgress}
						step={1}
						required
						value={progress}
						onChange={(event) => {
							setProgressEdited(true);
							setProgress(event.target.value);
						}}
					/>
					<Button
						type="button"
						variant="outline"
						aria-label={t("trackingUpdate.increase")}
						disabled={
							!valid ||
							Number(progress) >= snapshot.provider.capabilities.maximumProgress
						}
						onClick={() => {
							setProgressEdited(true);
							setProgress(String(Number(progress) + 1));
						}}
					>
						+
					</Button>
				</div>
			</div>
			<div className="grid gap-1">
				<label htmlFor={statusId}>{t("trackingUpdate.status")}</label>
				<select
					id={statusId}
					className="form-select w-full"
					value={status}
					onChange={(event) => {
						setStatusEdited(true);
						setStatus(event.target.value as Status);
					}}
				>
					{snapshot.provider.capabilities.statuses.map((value) => (
						<option key={value} value={value}>
							{t(`trackingList.statuses.${value}`)}
						</option>
					))}
				</select>
			</div>
			{operation &&
				["conflict", "failed", "authorization-required"].includes(
					operation.state,
				) && (
					<div role="status" className="text-sm">
						<p>{t(`trackingUpdate.states.${operation.state}`)}</p>
						{operation.error && (
							<p>{t("trackingUpdate.failure", { code: operation.error })}</p>
						)}
						{operation.retryAt !== null && (
							<p>
								{t("trackingUpdate.retryAt", {
									time: new Date(operation.retryAt).toLocaleTimeString(),
								})}
							</p>
						)}
					</div>
				)}
			{mutation.error instanceof ApiClientError &&
				(mutation.error.status === 400 || mutation.error.status === 409) && (
					<p role="alert">{mutation.error.message}</p>
				)}
			{operation?.state === "decision-required" && (
				<div className="grid gap-2">
					<p>
						{t(
							operation.decisionReason === "initial-status-required"
								? "playbackCompletion.initial"
								: "playbackCompletion.advance",
							{ episode: operation.desired.progress },
						)}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => mutation.mutate("confirm")}
						>
							{t("playbackCompletion.confirm")}
						</Button>
						<Button
							type="button"
							variant="ghost"
							disabled={mutation.isPending}
							onClick={() => mutation.mutate("keep")}
						>
							{t("playbackCompletion.keep")}
						</Button>
					</div>
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{operation?.state === "conflict" ? (
					<>
						<Button
							type="button"
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => mutation.mutate("remote")}
						>
							{t("trackingUpdate.keepRemote")}
						</Button>
						<Button
							type="button"
							disabled={mutation.isPending}
							onClick={() => mutation.mutate("local")}
						>
							{t("trackingUpdate.submitLocal")}
						</Button>
					</>
				) : (
					<>
						<Button
							type="submit"
							disabled={mutation.isPending || !valid || !changed}
						>
							{t("trackingUpdate.save")}
						</Button>
						{operation?.state === "failed" && (
							<Button
								type="button"
								variant="outline"
								disabled={mutation.isPending}
								onClick={() => mutation.mutate("retry")}
							>
								{t("actions.retry")}
							</Button>
						)}
					</>
				)}
			</div>
		</form>
	);
}
