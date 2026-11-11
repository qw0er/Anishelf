import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isRequestCancelled, request } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingPreviewResponse,
} from "../../../shared/api/contracts.js";
import {
	ActionButton,
	ActionLink,
} from "../../../shared/components/ui/action-button.js";
import { Button } from "../../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../../shared/components/ui/dialog.js";
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";
import { StatusBadge } from "../../../shared/components/ui/status-badge.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { useRefreshError } from "../../../shared/hooks/use-refresh-error.js";

import { animeLibraryQueryKey } from "../shared/query-keys.js";
import { accountQuery } from "./queries.js";

const accountKey = accountQuery().queryKey;
export function TrackingAccountSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [credential, setCredential] = useState("");
	const credentialInput = useRef<HTMLInputElement>(null);
	const [pendingSwitch, setPendingSwitch] = useState<{
		candidate: TrackingPreviewResponse;
		previousName: string;
	} | null>(null);
	const account = useQuery(accountQuery());
	useRefreshError(
		"tracking-account",
		account.data ? account.error : null,
		account.errorUpdatedAt,
		() => void account.refetch(),
	);
	const command = useMutation({
		onMutate: () => toast.close("tracking-account-command"),
		mutationFn: async (
			operation: "connect" | "confirm" | "disconnect" | "check",
		) => {
			let candidate = pendingSwitch?.candidate;
			if (operation === "connect") {
				candidate = await request<TrackingPreviewResponse>(
					"/api/tracking/account/preview",
					"POST",
					{},
					{ credential: credential.trim() },
				);
				if (!account.data || candidate.generation !== account.data.generation)
					throw new Error("Tracking connection changed during validation.");
				const previous = account.data.account;
				if (previous && previous.id !== candidate.account.id) {
					setCredential("");
					setPendingSwitch({ candidate, previousName: previous.name });
					return;
				}
			}
			let result: TrackingAccountResponse;
			if (operation === "connect" || operation === "confirm") {
				if (!candidate) return;
				result = await request(
					"/api/tracking/account/confirm",
					"POST",
					{},
					{
						candidateId: candidate.candidateId,
						generation: candidate.generation,
					},
				);
				setCredential("");
				console.info("[Tracking] Account connection saved.");
			} else if (operation === "disconnect") {
				if (!account.data) return;
				result = await request(
					"/api/tracking/account",
					"DELETE",
					{},
					{ generation: account.data.generation },
				);
			} else result = await request("/api/tracking/account/check", "POST");
			await client.cancelQueries({ queryKey: ["tracking"] });
			await client.cancelQueries({ queryKey: animeLibraryQueryKey });
			await client.cancelQueries({ queryKey: ["anime-detail"] });
			await client.cancelQueries({ queryKey: ["anime-status"] });
			client.removeQueries({ queryKey: ["anime-detail"] });
			client.removeQueries({ queryKey: ["anime-status"] });
			client.removeQueries({ queryKey: animeLibraryQueryKey });
			client.removeQueries({
				queryKey: ["tracking"],
				predicate: (query) => query.queryKey[1] !== "account",
			});
			client.setQueryData(accountKey, result);
			setPendingSwitch(null);
		},
		onError: (error, operation) => {
			if (isRequestCancelled(error)) return;
			console.warn("[Tracking] Account command failed.", { operation });
			toast.add({
				id: "tracking-account-command",
				type: "error",
				title: t("errors.requestFailed"),
			});
			void client.invalidateQueries({ queryKey: accountKey });
		},
	});
	const busy = command.isPending;
	const current = account.data;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>
					{current?.provider.name ?? t("trackingAccount.title")}
				</CardTitle>
				<CardDescription>{t("trackingAccount.description")}</CardDescription>
				{current && (
					<div className="space-y-2 text-sm">
						{current.account && (
							<p>
								{t("trackingAccount.account", { name: current.account.name })}
							</p>
						)}
						<div role="status" className="flex flex-wrap items-center gap-1">
							<StatusBadge>
								{t(`trackingAccount.states.${current.state}`)}
							</StatusBadge>
							{current.account && (
								<FieldHelp
									label={t("trackingAccount.connectionStatusHelp")}
									help={t(
										`trackingAccount.connectivity.${current.connectivity}`,
									)}
								/>
							)}
							{current.connectivity === "unavailable" && (
								<span className="text-destructive">
									{t("trackingAccount.connectivity.unavailable")}
								</span>
							)}
						</div>
					</div>
				)}
			</CardHeader>
			<CardContent className="min-w-0 space-y-4">
				{account.isPending && (
					<p role="status" className="rounded-md border px-2 py-1">
						{t("trackingAccount.loading")}
					</p>
				)}
				{current && (
					<form
						id="tracking-credential-form"
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!busy && !pendingSwitch && credential.trim())
								command.mutate("connect");
						}}
					>
						<div className="flex items-center gap-1">
							<label
								htmlFor="tracking-credential"
								className="text-sm font-medium"
							>
								{current.provider.authorization.label}
							</label>
							<FieldHelp
								label={t("trackingAccount.credentialHelpLabel")}
								help={t("trackingAccount.instructions")}
							/>
						</div>
						<Input
							id="tracking-credential"
							ref={credentialInput}
							name="tracking-credential"
							type="password"
							autoComplete="off"
							maxLength={8192}
							value={credential}
							onChange={(event) => setCredential(event.target.value)}
							disabled={busy}
							required
						/>
					</form>
				)}
				<fieldset
					aria-label={t("trackingAccount.actions")}
					className="action-row"
				>
					{current && (
						<>
							<ActionButton
								icon={Check}
								label={t("trackingAccount.connect", {
									provider: current.provider.name,
								})}
								type="submit"
								form="tracking-credential-form"
								disabled={busy || pendingSwitch !== null || !credential.trim()}
								aria-busy={busy && command.variables === "connect"}
							/>
							{current.account && (
								<>
									<ActionButton
										icon={PlugZap}
										label={t("trackingAccount.check")}
										shortLabel={t("actions.test")}
										variant="outline"
										disabled={busy}
										onClick={() => command.mutate("check")}
										aria-busy={
											command.isPending && command.variables === "check"
										}
									/>
									<ActionButton
										icon={Unplug}
										label={t("trackingAccount.disconnect")}
										shortLabel={t("actions.disconnect")}
										variant="outline"
										disabled={busy}
										onClick={() => command.mutate("disconnect")}
										aria-busy={
											command.isPending && command.variables === "disconnect"
										}
									/>
								</>
							)}
							{current.provider.authorization.url && (
								<ActionLink
									icon={ExternalLink}
									label={t("trackingAccount.authorize")}
									href={current.provider.authorization.url}
									target="_blank"
									rel="noreferrer"
								/>
							)}
						</>
					)}
					{account.error && !current && (
						<ActionButton
							icon={RefreshCw}
							label={t("trackingAccount.refresh")}
							shortLabel={t("actions.retry")}
							variant="outline"
							disabled={busy}
							onClick={() => {
								command.reset();
								void account.refetch();
							}}
						/>
					)}
				</fieldset>
				<Dialog
					open={pendingSwitch !== null}
					onOpenChange={(open) => {
						if (!open && !busy) setPendingSwitch(null);
					}}
				>
					<DialogContent showCloseButton={false} finalFocus={credentialInput}>
						<DialogHeader>
							<DialogTitle>{t("trackingAccount.switchTitle")}</DialogTitle>
							<DialogDescription>
								{t("trackingAccount.switchDescription", {
									previous: pendingSwitch?.previousName,
									next: pendingSwitch?.candidate.account.name,
								})}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => setPendingSwitch(null)}
							>
								{t("actions.cancel")}
							</Button>
							<ActionButton
								icon={Check}
								label={t("trackingAccount.confirm")}
								type="button"
								disabled={busy || !pendingSwitch}
								aria-busy={busy && command.variables === "confirm"}
								onClick={() => command.mutate("confirm")}
							/>
						</DialogFooter>
					</DialogContent>
				</Dialog>
				{account.error && !current && (
					<div role="alert" className="space-y-2">
						<p>{account.error?.message}</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
