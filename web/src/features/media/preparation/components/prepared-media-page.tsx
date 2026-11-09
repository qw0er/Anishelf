import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Play, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type {
	PreparedMediaItem,
	PreparedMediaQuery,
} from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Checkbox } from "../../../../shared/components/ui/checkbox.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "../../../../shared/components/ui/dialog.js";
import { Input } from "../../../../shared/components/ui/input.js";
import { NativeSelect } from "../../../../shared/components/ui/native-select.js";
import { PaginationControls } from "../../../../shared/components/ui/pagination-controls.js";
import { RefreshButton } from "../../../../shared/components/ui/refresh-button.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import { formatFileSize } from "../../../resources/public.js";
import { deletePreparedMediaBatch } from "../api.js";
import { preparationKeys, preparedMediaQuery } from "../queries.js";

export function PreparedMediaPage({ onDeleted }: { onDeleted(): void }) {
	const scope = useQueryScope();
	return (
		<PreparedMediaInventory key={scope} scope={scope} onDeleted={onDeleted} />
	);
}

function watchPath(item: PreparedMediaItem) {
	const query = new URLSearchParams({
		version: item.sourceVersion,
		asset: item.id,
		audio: item.audioStreamIndices.length
			? String(item.audioStreamIndices[0])
			: "none",
	});
	return `/files/${encodeURIComponent(item.fileId)}?${query}`;
}

function PreparedMediaInventory({
	scope,
	onDeleted,
}: {
	scope: string;
	onDeleted(): void;
}) {
	const { t, i18n } = useTranslation();
	const controlId = useId();
	const [params, setParams] = useSearchParams();
	const rawStatus = params.get("status");
	const input: PreparedMediaQuery = {
		search: params.get("search") ?? "",
		...(rawStatus === "ready" ||
		rawStatus === "unknown" ||
		rawStatus === "unavailable"
			? { status: rawStatus }
			: {}),
		sort: params.get("sort") === "size" ? "size" : "newest",
		page: String(
			Math.min(
				999999,
				Math.max(1, Math.floor(Number(params.get("page"))) || 1),
			),
		),
	};
	const query = useQuery(preparedMediaQuery(scope, input));
	const client = useQueryClient();
	const [selected, setSelected] = useState<string[]>([]);
	const [selecting, setSelecting] = useState(false);
	const [confirmation, setConfirmation] = useState<PreparedMediaItem[] | null>(
		null,
	);
	const notificationId = `prepared-media-delete:${controlId}`;
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			toast.close(notificationId);
		};
	}, [notificationId]);
	const size = (bytes: number) => formatFileSize(bytes, i18n.language);
	const mutation = useMutation({
		mutationFn: (items: PreparedMediaItem[]) =>
			deletePreparedMediaBatch(
				items.map((item) => item.id),
				{ signal: AbortSignal.timeout(30000) },
			),
		onSuccess: (response, items) => {
			const failures = response.results.flatMap((result) => {
				const item = items.find((item) => item.id === result.id);
				return result.error && item ? [{ item, error: result.error }] : [];
			});
			if (!mounted.current) return;
			const deleted = response.results.length - failures.length;
			toast.add({
				id: notificationId,
				type: failures.length ? (deleted ? "warning" : "error") : "success",
				title: failures.length
					? deleted
						? t("preparedMedia.result", { deleted, failed: failures.length })
						: t("preparedMedia.deleteFailed", { count: failures.length })
					: t("preparedMedia.deleted", { count: deleted }),
				...(failures.length
					? {
							timeout: 0,
							priority: "high" as const,
							description: (
								<ul className="max-h-40 space-y-1 overflow-y-auto break-words">
									{failures.map(({ item, error }) => (
										<li key={item.id}>
											{item.filename}: {t(`errors.api.${error}`)}
										</li>
									))}
								</ul>
							),
							actionProps: {
								children: t("actions.retry"),
								onClick: () => confirm(failures.map(({ item }) => item)),
							},
						}
					: {}),
			});
			setSelected(failures.map(({ item }) => item.id));
			setConfirmation(null);
		},
		onError: (error, items) => {
			if (!mounted.current) return;
			toast.add({
				id: notificationId,
				type: "error",
				priority: "high",
				timeout: 0,
				title: t("preparedMedia.deleteFailed", { count: items.length }),
				description: t(getErrorTranslationKey(error) ?? "errors.requestFailed"),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => confirm(items),
				},
			});
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: preparationKeys.preparations });
			onDeleted();
		},
	});
	const items = query.data?.items ?? [];
	const selectable = items.filter((item) => !item.deleteBlockedReason);
	const chosen = selectable.filter((item) => selected.includes(item.id));
	function change(name: string, value: string) {
		const next = new URLSearchParams(params);
		if (value) next.set(name, value);
		else next.delete(name);
		if (name !== "page") next.delete("page");
		setParams(next, { replace: name === "search" });
		setSelected([]);
	}
	function confirm(items: PreparedMediaItem[]) {
		toast.close(notificationId);
		mutation.reset();
		setConfirmation(items);
	}
	function resetFilters() {
		const next = new URLSearchParams(params);
		for (const key of ["search", "status", "page"]) next.delete(key);
		setParams(next);
		setSelected([]);
	}
	return (
		<section className="stack-page" aria-labelledby="prepared-media-title">
			<PageHeader
				id="prepared-media-title"
				title={t("preparedMedia.title")}
				description={
					query.data && (
						<span className="block text-xs" aria-live="polite">
							{t("preparedMedia.usage", {
								count: query.data.usage.count,
								used: size(query.data.usage.copyBytes),
								budget: size(query.data.usage.budgetBytes),
							})}
							{query.data.usage.retainedBytes !==
								query.data.usage.copyBytes && (
								<span className="mt-1 block">
									{t("preparedMedia.retained", {
										size: size(query.data.usage.retainedBytes),
									})}
								</span>
							)}
						</span>
					)
				}
			/>
			<div className="surface-panel space-y-4">
				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:grid-cols-[minmax(12rem,1fr)_11rem_10rem_auto]">
					<Input
						className="col-span-2 sm:col-span-3 lg:col-span-1"
						type="search"
						aria-label={t("preparedMedia.search")}
						placeholder={t("preparedMedia.search")}
						maxLength={500}
						value={input.search}
						disabled={mutation.isPending}
						onChange={(event) => change("search", event.target.value)}
					/>
					<div className="col-span-2 min-w-0 sm:col-span-1">
						<NativeSelect
							aria-label={t("preparedMedia.status")}
							value={input.status ?? ""}
							disabled={mutation.isPending}
							onChange={(event) => change("status", event.target.value)}
						>
							<option value="">{t("preparedMedia.all")}</option>
							{(["ready", "unknown", "unavailable"] as const).map((status) => (
								<option key={status} value={status}>
									{t(`preparedMedia.states.${status}`)}
								</option>
							))}
						</NativeSelect>
					</div>
					<NativeSelect
						aria-label={t("preparedMedia.sort")}
						value={input.sort}
						disabled={mutation.isPending}
						onChange={(event) => change("sort", event.target.value)}
					>
						<option value="newest">{t("preparedMedia.newest")}</option>
						<option value="size">{t("preparedMedia.largest")}</option>
					</NativeSelect>
					<div className="flex shrink-0 items-center gap-1">
						{items.length > 0 && (
							<Button
								variant="ghost"
								className="px-2 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
								aria-pressed={selecting}
								disabled={mutation.isPending}
								onClick={() => {
									console.debug("[Prepared media] Selection mode changed.", {
										selecting: !selecting,
									});
									setSelecting((value) => !value);
									setSelected([]);
								}}
							>
								{t(
									selecting
										? "preparedMedia.doneSelecting"
										: "preparedMedia.multiSelect",
								)}
							</Button>
						)}
						<RefreshButton
							label={t("preparedMedia.refresh")}
							busy={query.isFetching}
							disabled={mutation.isPending}
							onClick={() => void query.refetch()}
						/>
					</div>
				</div>
				{query.isPending && <p role="status">{t("preparedMedia.loading")}</p>}
				{query.error && (
					<div role="alert" className="flex flex-wrap items-center gap-2">
						<span>
							{t(getErrorTranslationKey(query.error) ?? "errors.requestFailed")}
						</span>
						<Button variant="outline" onClick={() => void query.refetch()}>
							{t("actions.retry")}
						</Button>
					</div>
				)}
				{query.data && (
					<>
						{items.length === 0 ? (
							!query.error && (
								<EmptyState
									embedded
									icon={<FolderOpen size={24} />}
									title={t(
										query.data.usage.count === 0
											? "preparedMedia.emptyTitle"
											: "preparedMedia.noMatchesTitle",
									)}
									description={t(
										query.data.usage.count === 0
											? "preparedMedia.empty"
											: "preparedMedia.noMatches",
									)}
									actions={
										query.data.usage.count === 0 ? (
											<Link
												className={buttonStyles("outline")}
												to="/directories/root"
											>
												{t("preparedMedia.browseFiles")}
											</Link>
										) : (
											<Button variant="outline" onClick={resetFilters}>
												{t("preparedMedia.resetFilters")}
											</Button>
										)
									}
								/>
							)
						) : (
							<>
								{selecting && (
									<div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
										<div className="flex min-h-11 items-center gap-2 text-sm">
											<Checkbox
												id={`${controlId}-all`}
												disabled={mutation.isPending || selectable.length === 0}
												checked={
													selectable.length > 0 &&
													chosen.length === selectable.length
												}
												indeterminate={
													chosen.length > 0 && chosen.length < selectable.length
												}
												onCheckedChange={(checked) =>
													setSelected(
														checked ? selectable.map((item) => item.id) : [],
													)
												}
											/>
											<label htmlFor={`${controlId}-all`}>
												{t("preparedMedia.selectPage")}
											</label>
										</div>
										<Button
											variant="outline"
											className="text-destructive"
											disabled={chosen.length === 0 || mutation.isPending}
											onClick={() => confirm(chosen)}
										>
											{t("preparedMedia.deleteSelected", {
												count: chosen.length,
											})}
										</Button>
									</div>
								)}
								<ul className="divide-y">
									{items.map((item) => (
										<li
											key={item.id}
											className={`grid items-center gap-x-3 gap-y-2 py-3 ${
												selecting
													? "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]"
													: "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]"
											}`}
										>
											{selecting && (
												<Checkbox
													className="size-5 shrink-0"
													aria-label={t("preparedMedia.select", {
														name: item.filename,
													})}
													checked={chosen.some(
														(chosen) => chosen.id === item.id,
													)}
													disabled={
														mutation.isPending || !!item.deleteBlockedReason
													}
													onCheckedChange={(checked) =>
														setSelected((previous) =>
															checked
																? [...previous, item.id]
																: previous.filter((id) => id !== item.id),
														)
													}
												/>
											)}
											<div className="min-w-0 flex-1 space-y-1">
												<Tooltip
													openOnClick
													content={
														<div className="space-y-1 break-all">
															<p>{item.sourcePath}</p>
															<p>
																{new Date(item.createdAtMs).toLocaleString(
																	i18n.language,
																)}
															</p>
														</div>
													}
												>
													<button
														type="button"
														className="block w-full truncate rounded text-left list-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
														aria-label={item.filename}
													>
														{item.filename}
													</button>
												</Tooltip>
												<p className="break-words text-xs text-muted-foreground">
													{item.profileName} ·{" "}
													{item.audioStreamIndices.length
														? t("preparedMedia.audio", {
																count: item.audioStreamIndices.length,
															})
														: t("audioTracks.none")}{" "}
													· {size(item.sizeBytes)} ·{" "}
													{t(`preparedMedia.states.${item.status}`)}
													{item.deleteBlockedReason &&
														` · ${t(`preparedMedia.blocked.${item.deleteBlockedReason}`)}`}
												</p>
											</div>
											<div
												className={`flex items-center justify-end ${selecting ? "col-start-2 sm:col-start-auto" : ""}`}
											>
												<Tooltip content={t("preparedMedia.watch")}>
													{item.status === "ready" ? (
														<Link
															className={buttonStyles(
																"ghost",
																undefined,
																"icon",
															)}
															aria-label={t("preparedMedia.watch")}
															to={watchPath(item)}
														>
															<Play size={16} aria-hidden="true" />
														</Link>
													) : (
														<Button
															size="icon"
															variant="ghost"
															disabled
															aria-label={t("preparedMedia.watch")}
														>
															<Play size={16} aria-hidden="true" />
														</Button>
													)}
												</Tooltip>
												<Tooltip content={t("preparedMedia.locate")}>
													<Link
														className={buttonStyles("ghost", undefined, "icon")}
														aria-label={t("preparedMedia.locate")}
														to={`/files/${encodeURIComponent(item.fileId)}/locate`}
													>
														<FolderOpen size={16} aria-hidden="true" />
													</Link>
												</Tooltip>
												<Tooltip content={t("preparedMedia.delete")}>
													<Button
														size="icon"
														variant="ghost"
														aria-label={t("preparedMedia.delete")}
														disabled={
															mutation.isPending || !!item.deleteBlockedReason
														}
														onClick={() => confirm([item])}
													>
														<Trash2 size={16} aria-hidden="true" />
													</Button>
												</Tooltip>
											</div>
										</li>
									))}
								</ul>
							</>
						)}
						{items.length > 0 &&
							(query.data.total > query.data.pageSize ||
								query.data.page > 1) && (
								<div className="border-t pt-4">
									<PaginationControls
										page={query.data.page}
										fetching={query.isFetching || mutation.isPending}
										hasNextPage={
											query.data.page * query.data.pageSize < query.data.total
										}
										onPage={(page) => change("page", String(page))}
										label={t("preparedMedia.title")}
									/>
								</div>
							)}
					</>
				)}
			</div>
			<Dialog
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open && !mutation.isPending) setConfirmation(null);
				}}
			>
				<DialogContent showCloseButton={!mutation.isPending}>
					<DialogTitle>{t("preparedMedia.confirmTitle")}</DialogTitle>
					<DialogDescription>
						{t("preparedMedia.confirm", {
							count: confirmation?.length ?? 0,
							size: size(
								confirmation?.reduce(
									(total, item) => total + item.sizeBytes,
									0,
								) ?? 0,
							),
						})}
					</DialogDescription>
					<p className="text-sm text-muted-foreground">
						{t("preparedMedia.regeneration")}
					</p>
					<DialogFooter>
						<Button
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => setConfirmation(null)}
						>
							{t("actions.cancel")}
						</Button>
						<Button
							variant="outline"
							className="text-destructive"
							disabled={mutation.isPending || !confirmation?.length}
							onClick={() => confirmation && mutation.mutate(confirmation)}
						>
							{t(
								mutation.isPending
									? "preparedMedia.deleting"
									: "preparedMedia.delete",
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
