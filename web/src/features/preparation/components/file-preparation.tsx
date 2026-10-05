import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
	createPreparation,
	getPreparation,
	getTranscodeProfiles,
} from "../../../api/client.js";
import type {
	PreparationTaskResponse,
	TranscodeProfileCatalog,
} from "../../../api/contracts.js";
import { Button, buttonStyles } from "../../../components/ui/button.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import {
	negotiatePreparation,
	verifyPreparedPlayback,
} from "../negotiation.js";
import { usePreparationAction, usePreparations } from "../use-preparations.js";
import { PreparationTaskCard } from "./task-card.js";

export function FilePreparation({
	fileId,
	sourceVersion,
	selectedTaskId,
	requestedTaskId,
	onSelect,
}: {
	fileId: string;
	sourceVersion?: string | undefined;
	selectedTaskId?: string | undefined;
	requestedTaskId?: string | null;
	onSelect(task: PreparationTaskResponse | null): void;
}) {
	const { t } = useTranslation();
	const list = usePreparations();
	const action = usePreparationAction();
	const [catalog, setCatalog] = useState<TranscodeProfileCatalog | null>(null);
	const [profileId, setProfileId] = useState("");
	const [catalogError, setCatalogError] = useState<unknown>(null);
	const [catalogRevision, setCatalogRevision] = useState(0);
	const [message, setMessage] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit catalog retry trigger
	useEffect(() => {
		const controller = new AbortController();
		void getTranscodeProfiles({ signal: controller.signal })
			.then((value) => {
				if (controller.signal.aborted) return;
				setCatalog(value);
				setProfileId(value.selectionAvailable ? value.selectedProfileId : "");
				setCatalogError(null);
			})
			.catch((error) => {
				if (!controller.signal.aborted) setCatalogError(error);
			});
		return () => controller.abort();
	}, [catalogRevision]);

	const selectRef = useRef(onSelect);
	selectRef.current = onSelect;
	const [requestedError, setRequestedError] = useState<unknown>(null);
	const [requestedBusy, setRequestedBusy] = useState(false);
	useEffect(() => {
		if (!requestedTaskId || !sourceVersion) return;
		const controller = new AbortController();
		const signal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
		]);
		setRequestedBusy(true);
		setRequestedError(null);
		void (async () => {
			const task = await getPreparation(requestedTaskId, { signal });
			if (task.fileId !== fileId || task.sourceVersion !== sourceVersion)
				throw new Error("Prepared copy unavailable");
			const verified = await verifyPreparedPlayback(task, signal);
			if (!signal.aborted) selectRef.current(verified);
		})()
			.catch((error) => {
				if (!controller.signal.aborted) setRequestedError(error);
			})
			.finally(() => {
				if (!controller.signal.aborted) setRequestedBusy(false);
			});
		return () => controller.abort();
	}, [fileId, sourceVersion, requestedTaskId]);
	const tasks = list.tasks.filter(
		(task) =>
			task.fileId === fileId &&
			(!sourceVersion || task.sourceVersion === sourceVersion),
	);
	async function prepare(
		profile: string,
		expectedTask?: PreparationTaskResponse,
	) {
		await action.run(async (signal) => {
			setMessage(null);
			if (expectedTask) {
				const verified = await verifyPreparedPlayback(expectedTask, signal);
				if (!signal.aborted) onSelect(verified);
				return;
			}
			const body = await negotiatePreparation(
				fileId,
				profile,
				signal,
				sourceVersion,
			);
			const result = await createPreparation(fileId, body, { signal });
			if (signal.aborted) return;
			if (result.kind === "blocked")
				setMessage(
					t(`compatibility.reasons.${result.reason}`, {
						defaultValue: t("preparation.blocked"),
					}),
				);
			else if (result.kind === "direct") {
				onSelect(null);
				setMessage(t("preparation.direct"));
			} else {
				list.refresh();
				if (result.task.status === "ready" && result.task.playbackUrl)
					onSelect(result.task);
			}
		});
	}
	return (
		<section
			id="media-preparation"
			className="space-y-4"
			aria-label={t("preparation.title")}
		>
			<div className="action-row">
				<h2 className="text-lg font-semibold">{t("preparation.title")}</h2>
				<Link className={buttonStyles("outline")} to="/preparations">
					{t("preparation.allTasks")}
				</Link>
			</div>
			<p className="text-sm text-muted-foreground">
				{t("preparation.description")}
			</p>
			{catalog && (
				<div className="action-row">
					<label htmlFor={`profile-${fileId}`}>
						{t("preparation.profile")}
					</label>
					<select
						id={`profile-${fileId}`}
						className="rounded-md border bg-background p-2"
						value={profileId}
						disabled={action.busy || requestedBusy}
						onChange={(event) => setProfileId(event.target.value)}
					>
						<option value="" disabled>
							{t("preparation.chooseProfile")}
						</option>
						{catalog.profiles.map((profile) => (
							<option key={profile.id} value={profile.id}>
								{profile.name}
							</option>
						))}
					</select>
					<Button
						disabled={!profileId || action.busy || requestedBusy}
						onClick={() => void prepare(profileId)}
					>
						{t(action.busy ? "preparation.checking" : "preparation.start")}
					</Button>
				</div>
			)}
			{catalog?.profiles.find((profile) => profile.id === profileId)
				?.description && (
				<p className="text-sm text-muted-foreground">
					{
						catalog.profiles.find((profile) => profile.id === profileId)
							?.description
					}
				</p>
			)}
			{message && <p role="status">{message}</p>}
			{requestedError !== null && (
				<p role="alert">
					{t(getErrorTranslationKey(requestedError) ?? "errors.requestFailed")}
				</p>
			)}
			{(catalogError !== null || list.error !== null) && (
				<div>
					<p role="alert">
						{t(
							getErrorTranslationKey(catalogError ?? list.error) ??
								"errors.requestFailed",
						)}
					</p>
					<Button
						variant="outline"
						onClick={() => {
							list.refresh();
							setCatalogRevision((v) => v + 1);
						}}
					>
						{t("actions.retry")}
					</Button>
				</div>
			)}
			{list.loading && <p role="status">{t("preparation.loading")}</p>}
			{selectedTaskId && (
				<Button variant="outline" onClick={() => onSelect(null)}>
					{t("compatibility.tryDirect")}
				</Button>
			)}
			{tasks.map((task) => (
				<PreparationTaskCard
					key={task.id}
					task={task}
					refresh={list.refresh}
					playing={task.id === selectedTaskId}
					onWatch={(task) => void prepare(task.profileId, task)}
				/>
			))}
		</section>
	);
}
