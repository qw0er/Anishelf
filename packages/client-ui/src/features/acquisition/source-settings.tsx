import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ExternalLink,
	MoreHorizontal,
	Package,
	RefreshCw,
	Save,
	Unplug,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	SourceConnectorSettings,
	SourceProviders,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
import {
	ActionButton,
	ActionLink,
} from "../../shared/components/ui/action-button.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../shared/components/ui/collapsible.js";
import { ConnectionSettings } from "../../shared/components/ui/connection-settings.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { Field, FieldError } from "../../shared/components/ui/field.js";
import { FieldHeading } from "../../shared/components/ui/field-heading.js";
import { FieldHelp } from "../../shared/components/ui/field-help.js";
import { Input } from "../../shared/components/ui/input.js";
import { LoadingState } from "../../shared/components/ui/loading-state.js";
import { StatusBadge } from "../../shared/components/ui/status-badge.js";
import { toast } from "../../shared/components/ui/toast.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";
import { useAutoSave } from "../../shared/hooks/use-auto-save.js";
import { useRefreshError } from "../../shared/hooks/use-refresh-error.js";
import { isHttpUrl } from "../../shared/lib/url.js";
import {
	SourceDiagnosticsDialog,
	useSourceDiagnostics,
} from "./source-diagnostics.js";
import { SourceProviderSettings } from "./source-provider-settings.js";
import {
	activateBundledSourceConnector,
	clearSourceConnector,
	getSourceConnector,
	getSourceProviders,
	saveSourceConnector,
	sourceSettingsKey,
} from "./sources-api.js";

function sourceConnectionKey(settings: SourceConnectorSettings): string {
	if (settings.origin === "bundled") return "acquisition.connection.bundled";
	if (settings.url) return "acquisition.connection.external";
	return "acquisition.connection.unconfigured";
}

export function SourceSettings() {
	const { t } = useTranslation();
	const query = useQuery<SourceConnectorSettings>({
		queryKey: sourceSettingsKey,
		staleTime: 5 * 60_000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			!query.state.data?.url || query.state.data.bundledSetup === "pending"
				? 5000
				: false,
		queryFn: ({ signal }) =>
			getSourceConnector({ signal: boundedSignal(signal) }),
	});
	useRefreshError(
		"source-settings",
		query.data ? query.error : null,
		query.errorUpdatedAt,
		() => void query.refetch(),
	);
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("acquisition.sources.title")}</CardTitle>
				{query.data && (
					<div role="status" className="flex flex-wrap items-center gap-1">
						<StatusBadge>{t(sourceConnectionKey(query.data))}</StatusBadge>
						{query.data.url && (
							<StatusBadge>
								{t(
									query.data.ready
										? "acquisition.sources.configured"
										: "acquisition.connection.unconfigured",
								)}
							</StatusBadge>
						)}
					</div>
				)}
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-4 lg:max-w-2xl">
				{query.isPending ? (
					<LoadingState label={t("acquisition.sources.loading")} />
				) : query.isError && !query.data ? (
					<div role="alert" className="flex flex-col gap-2 text-sm">
						<p className="text-destructive">
							{t("acquisition.sources.loadFailed")}
						</p>
						<div className="action-row">
							<Button variant="outline" onClick={() => void query.refetch()}>
								{t("acquisition.sources.retry")}
							</Button>
						</div>
					</div>
				) : (
					<ConnectorForm settings={query.data} />
				)}
			</CardContent>
		</Card>
	);
}

function ConnectorForm({ settings }: { settings: SourceConnectorSettings }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [url, setUrl] = useState(settings.url ?? "");
	const [managementUrl, setManagementUrl] = useState(
		settings.managementUrl ?? "",
	);
	const [apiKey, setApiKey] = useState("");
	const [providers, setProviders] = useState(settings.providers);
	const [available, setAvailable] = useState<SourceProviders>([]);
	const diagnostics = useSourceDiagnostics(
		settings.generation,
		settings.providers[0] ?? "",
	);
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
	const connectionChanged = url !== (settings.url ?? "") || Boolean(apiKey);
	const sitesChanged =
		JSON.stringify(providers) !== JSON.stringify(settings.providers);
	const changed = connectionChanged || sitesChanged;
	const saved = (value: SourceConnectorSettings) => {
		setApiKey("");
		setAvailable([]);
		diagnostics.reset();
		setUrl(value.url ?? "");
		client.setQueryData(sourceSettingsKey, value);
		console.info("[Settings] Jackett source settings saved.");
		toast.add({
			type: "success",
			title: t("acquisition.sources.saved"),
			id: "source-connection-save",
		});
	};
	const save = useMutation({
		mutationFn: () =>
			saveSourceConnector({
				generation: settings.generation,
				url,
				managementUrl: settings.managementUrl ?? null,
				origin:
					settings.origin === "bundled" && url === settings.url
						? "bundled"
						: "external",
				providers: settings.providers,
				...(apiKey ? { apiKey } : {}),
			}),
		onSuccess: saved,
		onError: () => {
			console.warn("[Settings] Jackett source settings save failed.");
			toast.add({
				type: "error",
				title: t("acquisition.sources.actionFailed"),
				id: "source-connection-save",
			});
		},
	});
	const saveSites = useMutation({
		mutationFn: () =>
			saveSourceConnector({
				generation: settings.generation,
				url: settings.url ?? "",
				managementUrl: settings.managementUrl ?? null,
				origin: settings.origin ?? "external",
				providers,
			}),
		onSuccess: (value) => {
			diagnostics.reconcileProvider(value.providers);
			client.setQueryData(sourceSettingsKey, value);
			console.info("[Settings] Jackett source sites saved.");
			toast.add({
				type: "success",
				title: t("acquisition.sources.saved"),
				id: "source-sites-save",
			});
		},
		onError: () => {
			console.warn("[Settings] Jackett source sites save failed.");
			toast.add({
				type: "error",
				title: t("acquisition.sources.actionFailed"),
				id: "source-sites-save",
			});
		},
	});

	const saveWebui = useMutation({
		mutationFn: (nextManagementUrl: string) =>
			saveSourceConnector({
				generation: settings.generation,
				url: settings.url ?? "",
				managementUrl: nextManagementUrl.trim() || null,
				origin: settings.origin ?? "external",
				providers: settings.providers,
			}),
		onSuccess: (value) => {
			setManagementUrl(value.managementUrl ?? "");
			diagnostics.reset();
			client.setQueryData(sourceSettingsKey, value);
			console.info("[Settings] Jackett management URL saved.");
			toast.add({
				type: "success",
				title: t("acquisition.sources.saved"),
				id: "source-management-save",
			});
		},
		onError: (_error, value) => {
			console.warn("[Settings] Jackett management URL save failed.");
			toast.add({
				type: "error",
				title: t("acquisition.sources.actionFailed"),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => saveWebui.mutate(value),
				},
				id: "source-management-save",
			});
		},
	});

	const clear = useMutation({
		mutationFn: () => clearSourceConnector(settings.generation),
		onSuccess: (value) => {
			saved(value);
			setManagementUrl(value.managementUrl ?? "");
			setProviders(value.providers);
		},
	});
	const bundled = useMutation({
		mutationFn: (initializeSite: boolean) =>
			activateBundledSourceConnector(settings.generation, initializeSite),
		onSuccess: (value) => {
			saved(value);
			setManagementUrl(value.managementUrl ?? "");
			setProviders(value.providers);
		},
	});
	const list = useMutation({
		mutationFn: () => getSourceProviders(settings.generation),
		onSuccess: (sites) => {
			setAvailable(sites);
			toast.add({
				type: "success",
				title: t("acquisition.sources.loaded", { count: sites.length }),
			});
		},
	});
	const managementDraft = managementUrl.trim();
	const managementValid = managementDraft === "" || isHttpUrl(managementDraft);
	const flushManagementUrl = useAutoSave(
		managementDraft,
		(settings.managementUrl ?? "").trim(),
		(value) => saveWebui.mutate(value),
		Boolean(settings.url) && managementValid,
	);
	const busy =
		saveWebui.isPending ||
		save.isPending ||
		saveSites.isPending ||
		clear.isPending ||
		bundled.isPending ||
		list.isPending ||
		diagnostics.checking ||
		diagnostics.searching;
	const error =
		clear.isError || bundled.isError || list.isError || diagnostics.failed;
	const canTest =
		!busy && !changed && settings.hasApiKey && Boolean(settings.url);
	return (
		<div className="flex min-w-0 flex-col gap-4">
			{(settings.error ||
				(settings.origin === "bundled" &&
					(settings.bundledSetup === "manual" ||
						settings.bundledSetup === "pending"))) && (
				<div className="flex flex-col gap-2 text-sm">
					{settings.origin === "bundled" &&
						settings.bundledSetup === "manual" && (
							<p className="text-muted-foreground">
								{t("acquisition.sources.manualSetup")}
							</p>
						)}
					{settings.origin === "bundled" &&
						settings.bundledSetup === "pending" && (
							<p className="text-muted-foreground">
								{t("acquisition.sources.setupPending")}
							</p>
						)}
					{settings.error && (
						<p role="alert" className="text-destructive">
							{t("acquisition.sources.credentialsError")}
						</p>
					)}
				</div>
			)}

			<form
				className="flex min-w-0 flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					save.mutate();
				}}
			>
				<ConnectionSettings
					onCancel={() => {
						setUrl(settings.url ?? "");
						setApiKey("");
					}}
					actions={
						<ActionButton
							icon={Save}
							label={t("acquisition.sources.save")}
							shortLabel={t("actions.save")}
							type="submit"
							disabled={busy || !connectionChanged}
							aria-busy={save.isPending}
						/>
					}
					menu={
						settings.bundledAvailable || settings.url ? (
							<DropdownMenu>
								<Tooltip content={t("acquisition.connection.more")}>
									<DropdownMenuTrigger
										render={
											<Button
												type="button"
												variant="ghost"
												aria-label={t("acquisition.connection.more")}
											/>
										}
									>
										<MoreHorizontal size={16} />
									</DropdownMenuTrigger>
								</Tooltip>
								<DropdownMenuContent>
									{settings.bundledAvailable && (
										<DropdownMenuItem
											disabled={busy}
											onClick={() => bundled.mutate(false)}
										>
											<Package size={16} aria-hidden="true" />
											{t("acquisition.sources.useBundled")}
										</DropdownMenuItem>
									)}
									{settings.url && (
										<DropdownMenuItem
											disabled={busy}
											onClick={() => clear.mutate()}
										>
											<Unplug size={16} aria-hidden="true" />
											{t("acquisition.sources.disconnect")}
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null
					}
					endpoint={settings.url}
					configured={
						Boolean(settings.url) && settings.hasApiKey && !settings.error
					}
					label={t("acquisition.sources.connectionSettings")}
				>
					<Field className="flex flex-col gap-2">
						<FieldHeading
							id="source-api-url"
							label={t("acquisition.sources.apiUrl")}
							help={t("acquisition.sources.apiUrlHelp")}
						/>
						<Input
							id="source-api-url"
							type="url"
							required
							maxLength={2048}
							placeholder="http://jackett:9117/"
							value={url}
							disabled={busy}
							onChange={(event) => setUrl(event.target.value)}
						/>
					</Field>
					<div className="flex flex-col gap-2">
						<div className="field-heading justify-between">
							<label className="field-label" htmlFor="source-api-key">
								{t("acquisition.sources.apiKey")}
							</label>
							<FieldHelp
								label={`${t("acquisition.sources.apiKey")} · ${t("actions.help")}`}
								help={t("acquisition.sources.keyHelp")}
							/>
						</div>
						<Input
							id="source-api-key"
							type="password"
							autoComplete="new-password"
							maxLength={4096}
							required={!settings.hasApiKey || url !== settings.url}
							placeholder={
								settings.hasApiKey && url === settings.url
									? t("acquisition.sources.keySaved")
									: undefined
							}
							value={apiKey}
							disabled={busy}
							onChange={(event) => setApiKey(event.target.value)}
						/>
					</div>
				</ConnectionSettings>
			</form>
			{settings.origin === "bundled" && settings.bundledSetup === "manual" && (
				<div className="action-row">
					<ActionButton
						icon={RefreshCw}
						label={t("acquisition.sources.retrySetup")}
						shortLabel={t("actions.retry")}
						type="button"
						variant="outline"
						disabled={busy || changed}
						onClick={() => bundled.mutate(true)}
						aria-busy={bundled.isPending}
					/>
				</div>
			)}

			<SourceProviderSettings
				settings={settings}
				providers={providers}
				setProviders={setProviders}
				available={available}
				busy={busy}
				changed={changed}
				sitesChanged={sitesChanged}
				canTest={canTest}
				loadingSites={list.isPending}
				savingSites={saveSites.isPending}
				onOpenDiagnostics={() => setDiagnosticsOpen(true)}
				onLoadSites={() => list.mutate()}
				onSaveSites={() => saveSites.mutate()}
			/>

			<SourceDiagnosticsDialog
				diagnostics={diagnostics}
				providers={settings.providers}
				open={diagnosticsOpen}
				onOpenChange={setDiagnosticsOpen}
				busy={busy}
				changed={changed}
				canTest={canTest}
			/>

			{error && (
				<p role="alert" className="field-error">
					{t("acquisition.sources.actionFailed")}
				</p>
			)}

			<div className="space-y-3 border-t pt-4">
				<Collapsible>
					<CollapsibleTrigger className="cursor-pointer text-sm font-medium">
						{t("acquisition.webui.settings")}
					</CollapsibleTrigger>
					<CollapsibleContent keepMounted>
						<div className="flex flex-col gap-3 pt-4">
							<div className="flex flex-col gap-2">
								<div className="field-heading justify-between">
									<label
										className="field-label"
										htmlFor="source-management-url"
									>
										{t("acquisition.sources.managementUrl")}
									</label>
									<FieldHelp
										label={
											t("acquisition.sources.managementUrl") +
											" · " +
											t("actions.help")
										}
										help={t("acquisition.sources.managementHelp")}
									/>
								</div>
								<Input
									id="source-management-url"
									type="url"
									maxLength={2048}
									placeholder="http://localhost:9117/"
									value={managementUrl}
									aria-invalid={!managementValid || undefined}
									aria-describedby={
										!managementValid ? "source-management-url-error" : undefined
									}
									onChange={(event) => setManagementUrl(event.target.value)}
									onBlur={flushManagementUrl}
								/>
								<FieldError
									id="source-management-url-error"
									className="field-error"
								>
									{!managementValid && t("acquisition.sources.invalidUrl")}
								</FieldError>
							</div>
						</div>
					</CollapsibleContent>
				</Collapsible>
				{settings.managementUrl && (
					<div className="action-row">
						<ActionLink
							icon={ExternalLink}
							label={t("acquisition.sources.openManagement")}
							shortLabel={t("actions.open")}
							href={settings.managementUrl}
							target="_blank"
							rel="noopener noreferrer"
						/>
					</div>
				)}
			</div>
		</div>
	);
}
