import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { useId, useState } from "react";
import type {
	SubscriptionPreview,
	SubscriptionView,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";
import { DownloadActivityPanel } from "./download-activity.js";
import { downloadKeys } from "./downloads-api.js";
import {
	confirmSubscription,
	getSubscription,
	previewSubscription,
	refreshSubscription,
	removeSubscription,
	toggleSubscription,
} from "./subscriptions-api.js";

const key = (workKey: string) =>
	["acquisition", "subscription", workKey] as const;
export function SubscriptionPanel({ workKey }: { workKey: string }) {
	const client = useQueryClient();
	const [page, setPage] = useState(1),
		[editing, setEditing] = useState(false);
	const query = useQuery({
		queryKey: [...key(workKey), page],
		queryFn: ({ signal }) =>
			getSubscription(workKey, page, { signal: boundedSignal(signal) }),
		refetchInterval: 30_000,
	});
	const subscription = query.data?.subscription;
	function updated() {
		setEditing(false);
		setPage(1);
		void client.invalidateQueries({ queryKey: key(workKey) });
		void client.invalidateQueries({ queryKey: downloadKeys });
	}
	const action = useMutation({
		mutationFn: async (command: "toggle" | "refresh" | "remove") => {
			if (!subscription) return;
			if (command === "toggle")
				await toggleSubscription(
					workKey,
					subscription.revision,
					!subscription.enabled,
				);
			else if (command === "refresh")
				await refreshSubscription(workKey, subscription.revision);
			else await removeSubscription(workKey, subscription.revision);
		},
		onSuccess: () => {
			updated();
			toast.add({ title: "RSS subscription updated.", type: "success" });
		},
		onError: () => {
			void client.invalidateQueries({ queryKey: key(workKey) });
			void client.invalidateQueries({ queryKey: downloadKeys });
			toast.add({
				title: "Could not update the subscription. Refresh and retry.",
				type: "error",
			});
		},
	});
	return (
		<section className="surface-panel space-y-4" aria-label="RSS subscription">
			<div className="action-row justify-between">
				<h2 className="text-lg font-semibold">RSS subscription</h2>
				{subscription && (
					<div className="action-row">
						<Tooltip
							openOnClick
							content="Pausing stops future acquisitions; existing downloads continue. AniList status changes do not alter subscriptions or downloads."
						>
							<button
								type="button"
								className="text-sm text-muted-foreground underline decoration-dotted"
								aria-label="Subscription policy"
							>
								{subscription.enabled ? "Enabled" : "Paused"}
							</button>
						</Tooltip>{" "}
						<DropdownMenu>
							<Tooltip content="Subscription actions">
								<DropdownMenuTrigger
									render={
										<Button
											variant="ghost"
											className="size-9 shrink-0 p-0"
											aria-label="Subscription actions"
										/>
									}
								>
									<Ellipsis className="size-4" aria-hidden="true" />
								</DropdownMenuTrigger>
							</Tooltip>
							<DropdownMenuContent>
								<DropdownMenuItem
									disabled={action.isPending}
									onClick={() => action.mutate("toggle")}
								>
									{subscription.enabled
										? "Pause subscription"
										: "Resume subscription"}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={action.isPending || !subscription.enabled}
									onClick={() => action.mutate("refresh")}
								>
									Check now
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={action.isPending}
									onClick={() => setEditing(!editing)}
								>
									Edit subscription
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={action.isPending}
									onClick={() => action.mutate("remove")}
								>
									Remove subscription
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				)}
			</div>
			{query.isPending ? (
				<p role="status">Loading subscription…</p>
			) : query.isError ? (
				<div role="alert">
					Subscription unavailable.{" "}
					<Button variant="outline" onClick={() => void query.refetch()}>
						Retry subscription
					</Button>
				</div>
			) : (
				<>
					{subscription && (
						<>
							<p className="break-all text-sm">
								{subscription.source} · From episode {subscription.startEpisode}
							</p>

							{subscription.error && (
								<p role="status" className="text-sm">
									Could not update candidates ({reason(subscription.error)}).
									Previous results are retained; automatic retry is scheduled.
								</p>
							)}
						</>
					)}
					{(!subscription || editing) && (
						<SubscriptionForm
							key={subscription?.revision ?? "new"}
							workKey={workKey}
							current={subscription ?? null}
							onSaved={updated}
						/>
					)}
					{query.data && (
						<DownloadActivityPanel
							key={workKey}
							workKey={workKey}
							view={query.data}
							reason={reason}
							onConfigure={() => setEditing(true)}
						/>
					)}
					{query.data && query.data.total > 20 && (
						<div className="action-row">
							<Button
								variant="outline"
								disabled={page <= 1}
								onClick={() => setPage(page - 1)}
							>
								Previous releases
							</Button>
							<span className="text-sm">Page {page}</span>
							<Button
								variant="outline"
								disabled={page * 20 >= query.data.total}
								onClick={() => setPage(page + 1)}
							>
								Next releases
							</Button>
						</div>
					)}
				</>
			)}
		</section>
	);
}

function SubscriptionForm({
	workKey,
	current,
	onSaved,
}: {
	workKey: string;
	current: SubscriptionView["subscription"];
	onSaved(): void;
}) {
	const id = useId(),
		[url, setUrl] = useState(""),
		[start, setStart] = useState(String(current?.startEpisode ?? 1));
	const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
	const check = useMutation({
		mutationFn: () =>
			previewSubscription({
				workKey,
				rssUrl: url,
				startEpisode: Number(start),
				revision: current?.revision ?? null,
			}),
		onSuccess: setPreview,
		onError: () => {
			setPreview(null);
			toast.add({
				title: "Could not read RSS. Check the address and try again.",
				type: "error",
			});
		},
	});
	const save = useMutation({
		mutationFn: () => {
			if (!preview) throw new Error("Missing subscription preview.");
			return confirmSubscription(workKey, preview.token);
		},
		onSuccess: () => {
			setUrl("");
			onSaved();
			toast.add({ title: "RSS subscription enabled.", type: "success" });
		},
		onError: () => {
			setPreview(null);
			toast.add({
				title: "The preview changed or expired. Check RSS again.",
				type: "error",
			});
		},
	});
	const busy = check.isPending || save.isPending;
	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				setPreview(null);
				check.mutate();
			}}
		>
			<label htmlFor={`${id}-url`} className="block space-y-2">
				<span className="text-sm font-medium">RSS URL</span>
				<Input
					id={`${id}-url`}
					type="url"
					required={!current}
					maxLength={4096}
					value={url}
					onChange={(event) => {
						setUrl(event.target.value);
						setPreview(null);
					}}
					disabled={busy}
					placeholder={
						current
							? "Leave blank to keep the saved RSS address"
							: "https://example.org/rss.xml"
					}
				/>
			</label>
			<label htmlFor={`${id}-start`} className="block space-y-2">
				<span className="text-sm font-medium">Starting episode</span>
				<Input
					id={`${id}-start`}
					type="number"
					min={1}
					max={10000}
					required
					value={start}
					onChange={(event) => {
						setStart(event.target.value);
						setPreview(null);
					}}
					disabled={busy}
				/>
			</label>
			<p className="text-sm text-muted-foreground">
				Choose your preferred release source on the torrent site and paste its
				RSS address. RSS may not include older episodes.
			</p>
			<Button type="submit" variant="outline" disabled={busy}>
				{check.isPending ? "Reading RSS…" : "Check RSS"}
			</Button>
			{preview && (
				<div className="space-y-3">
					<p className="break-all text-sm">{preview.source}</p>
					<p className="text-sm">
						From episode {preview.startEpisode}
						{preview.knownEpisodeCount
							? ` · ${preview.knownEpisodeCount} known episodes`
							: " · Episode count unknown"}
						. {preview.availableEpisodes.length} episodes already available.{" "}
						{preview.total} releases found.
					</p>
					<p className="text-sm text-muted-foreground">
						The first check includes releases currently returned by this feed.
						Eligible versions are selected automatically; no review is required.
					</p>
					<p className="break-words text-sm">
						{preview.downloadDestination
							? `Automatic download destination: ${preview.downloadDestination}`
							: "Discovery only. Configure and validate a download destination in Settings to enable automatic downloads."}
					</p>
					<Button type="button" disabled={busy} onClick={() => save.mutate()}>
						{save.isPending ? "Enabling subscription…" : "Enable subscription"}
					</Button>
				</div>
			)}
		</form>
	);
}

function reason(code: string): string {
	const messages: Record<string, string> = {
		acquisition_unavailable:
			"automatic acquisition could not be queued; check metadata and destination settings",
		identity_unconfirmed: "animation or season could not be confirmed",
		unsupported_content: "special, pack or unsupported content",
		episode_unconfirmed: "single regular episode could not be confirmed",
		download_unavailable: "no supported download link",
		outside_scope: "before the starting episode",
		already_available: "already in your library",
		existing_download: "already present in qBittorrent",
		episode_downloading:
			"another version of this episode is already in qBittorrent",
		downloader_unavailable: "downloader status could not be checked",
		another_version_selected: "another version was selected",
		fetch_failed: "source could not be reached",
		invalid_xml: "invalid RSS XML",
		storage_limit: "source history limit reached",
		assessment_unavailable:
			"animation metadata or local availability could not be checked",
	};
	return messages[code] ?? "source could not be refreshed";
}
