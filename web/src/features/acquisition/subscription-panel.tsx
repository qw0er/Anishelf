import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Rss } from "lucide-react";
import { useId, useState } from "react";
import type {
	DownloadActivity,
	SubscriptionView,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../shared/components/ui/dialog.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { DownloadActivityPanel } from "./download-activity.js";
import { downloadKeys, getDownloadSettings } from "./downloads-api.js";
import {
	acquisitionProfilesQuery,
	getSubscription,
	refreshSubscription,
	removeSubscription,
	saveSubscription,
	toggleSubscription,
} from "./subscriptions-api.js";

const key = (workKey: string) =>
	["acquisition", "subscription", workKey] as const;
export function SubscriptionPanel({
	workKey,
	initialView,
	initialActivity,
}: {
	workKey: string;
	initialView?: SubscriptionView;
	initialActivity?: DownloadActivity | null;
}) {
	const client = useQueryClient();
	const [page, setPage] = useState(1),
		[editing, setEditing] = useState(false);
	const query = useQuery({
		queryKey: [...key(workKey), page],
		enabled: page !== 1 || !initialView,
		initialData: page === 1 ? initialView : undefined,
		queryFn: ({ signal }) =>
			getSubscription(workKey, page, { signal: boundedSignal(signal) }),
		refetchInterval: 30_000,
	});
	const viewData = page === 1 && initialView ? initialView : query.data;
	const subscription = viewData?.subscription;
	function updated() {
		setEditing(false);
		setPage(1);
		void client.invalidateQueries({ queryKey: key(workKey) });
		void client.invalidateQueries({ queryKey: downloadKeys });
		void invalidateAnimeQueries(client, "acquisition");
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
			void invalidateAnimeQueries(client, "acquisition");
			toast.add({
				title: "Could not update the subscription. Refresh and retry.",
				type: "error",
			});
		},
	});
	return (
		<section className="space-y-2 border-t pt-3" aria-label="RSS subscription">
			<Dialog open={editing} onOpenChange={setEditing}>
				<div className="action-row justify-between">
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
						<h2 className="flex items-center gap-2 font-medium">
							<Rss
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
							Subscription
						</h2>
						{subscription && (
							<span className="text-muted-foreground">
								From episode {subscription.startEpisode}
							</span>
						)}
					</div>
					<div className="action-row">
						{!query.isPending && !query.isError && (
							<DialogTrigger
								render={<Button variant="ghost" disabled={action.isPending} />}
							>
								{subscription ? "Manage" : "Subscribe"}
							</DialogTrigger>
						)}
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
				</div>
				<DialogContent className="max-h-[85dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{subscription ? "Manage RSS subscription" : "Subscribe via RSS"}
						</DialogTitle>
						<DialogDescription>
							Choose a feed and starting episode. Saving enables automatic
							acquisition to the configured destination.
						</DialogDescription>
					</DialogHeader>
					<SubscriptionForm
						key={subscription?.revision ?? "new"}
						workKey={workKey}
						current={subscription ?? null}
						onSaved={updated}
					/>
				</DialogContent>
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
						{subscription?.error && (
							<p role="status" className="text-sm">
								Could not update candidates ({reason(subscription.error)}).
								Previous results are retained; automatic retry is scheduled.
							</p>
						)}
						{viewData && (
							<DownloadActivityPanel
								initialActivity={initialActivity}
								key={workKey}
								workKey={workKey}
								view={viewData}
								reason={reason}
								onConfigure={() => setEditing(true)}
								releasePagination={
									viewData.total > 20 ? (
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
												disabled={page * 20 >= viewData.total}
												onClick={() => setPage(page + 1)}
											>
												Next releases
											</Button>
										</div>
									) : null
								}
							/>
						)}
					</>
				)}
			</Dialog>
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
	const profiles = useQuery(acquisitionProfilesQuery());
	const [profileId, setProfileId] = useState(current?.profileId ?? "");
	const id = useId(),
		[url, setUrl] = useState(""),
		[start, setStart] = useState(String(current?.startEpisode ?? 1));
	const destination = useQuery({
		queryKey: [...downloadKeys, "settings"],
		queryFn: ({ signal }) =>
			getDownloadSettings({ signal: boundedSignal(signal) }),
	});
	const target = destination.data?.destination;
	const save = useMutation({
		mutationFn: () => {
			if (!target?.validated)
				throw new Error("Configure and validate a download destination first.");
			return saveSubscription({
				workKey,
				source: url.trim() ? { kind: "feed", url: url.trim() } : null,
				profileId: profileId || null,
				startEpisode: Number(start),
				revision: current?.revision ?? null,
				destinationRevision: target.revision,
				connectionGeneration: target.connectionGeneration,
			});
		},
		onSuccess: () => {
			setUrl("");
			onSaved();
			toast.add({
				title:
					"Subscription enabled. Releases will be checked in the background.",
				type: "success",
			});
		},
		onError: () => {
			void destination.refetch();
			toast.add({
				title:
					"Could not save the subscription. Check the source and current download settings, then retry.",
				type: "error",
			});
		},
	});
	const busy = save.isPending;
	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			{current && (
				<p className="break-all text-sm text-muted-foreground">
					{current.source}
				</p>
			)}
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
					}}
					disabled={busy}
				/>
			</label>
			<label htmlFor={`${id}-profile`} className="block space-y-2">
				<span className="text-sm font-medium">Release selection profile</span>
				<select
					id={`${id}-profile`}
					className="w-full rounded-md border bg-background p-2 text-sm"
					value={profileId}
					disabled={busy || profiles.isPending || profiles.isError}
					onChange={(event) => {
						setProfileId(event.target.value);
					}}
				>
					<option value="">
						Follow global default
						{profiles.data
							? ` (${profiles.data.profiles.find((profile) => profile.id === profiles.data.selectedProfileId)?.name ?? "Unavailable"})`
							: ""}
					</option>
					{profileId &&
						!profiles.data?.profiles.some(
							(profile) => profile.id === profileId,
						) && <option value={profileId}>Unavailable: {profileId}</option>}
					{profiles.data?.profiles.map((profile) => (
						<option key={profile.id} value={profile.id}>
							{profile.name}
							{profile.source === "custom" ? " (Custom)" : ""}
						</option>
					))}
				</select>
			</label>
			{profiles.isError && (
				<p role="alert">
					Could not load release profiles.{" "}
					<Button
						type="button"
						variant="outline"
						onClick={() => void profiles.refetch()}
					>
						Retry profiles
					</Button>
				</p>
			)}
			<p className="text-sm text-muted-foreground">
				{
					profiles.data?.profiles.find(
						(profile) =>
							profile.id === (profileId || profiles.data.selectedProfileId),
					)?.description
				}
			</p>
			<p className="text-sm text-muted-foreground">
				Choose your preferred release source on the torrent site and paste its
				RSS address. RSS may not include older episodes.
			</p>
			{destination.isPending ? (
				<p role="status">Loading download destination…</p>
			) : target?.validated ? (
				<p className="wrap-break-word text-sm">
					Automatic download destination: {target.path}. A directory is created
					for this anime. Eligible releases from episode {start || "1"} will be
					downloaded automatically.
				</p>
			) : (
				<p role="alert">
					Configure and validate a download destination in{" "}
					<a className="underline" href="/settings">
						Settings
					</a>{" "}
					before enabling this subscription.{" "}
					<Button
						type="button"
						variant="outline"
						onClick={() => void destination.refetch()}
					>
						Retry destination
					</Button>
				</p>
			)}
			<Button
				type="submit"
				disabled={
					busy || !target?.validated || profiles.isPending || profiles.isError
				}
			>
				{save.isPending
					? "Saving subscription…"
					: "Save and enable subscription"}
			</Button>
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
		newer_revision_available:
			"a newer revision from the same group is available",
		waiting_for_level: "waiting for this profile level to become available",
		requirements_not_met: "release does not satisfy the profile requirements",
		no_matching_level: "release does not match any profile level",
		profile_unavailable: "selected release profile is unavailable",
		episode_reserved: "another version is already reserved for this episode",
		fetch_failed: "source could not be reached",
		invalid_xml: "invalid RSS XML",
		storage_limit: "source history limit reached",
		assessment_unavailable:
			"animation metadata or local availability could not be checked",
	};
	return messages[code] ?? "source could not be refreshed";
}
