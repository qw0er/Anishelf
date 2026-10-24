import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ExternalLink,
	Eye,
	PlugZap,
	RefreshCw,
	Unplug,
	X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingPreviewResponse,
} from "../../../shared/api/contracts.js";
import {
	ActionButton,
	ActionLink,
} from "../../../shared/components/ui/action-button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";

import { animeLibraryQueryKey } from "../shared/query-keys.js";
import { accountQuery } from "./queries.js";

const accountKey = accountQuery().queryKey;
export function TrackingAccountSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [credential, setCredential] = useState("");
	const [preview, setPreview] = useState<TrackingPreviewResponse | null>(null);
	const account = useQuery(accountQuery());
	const command = useMutation({
		mutationFn: async (
			operation: "preview" | "confirm" | "disconnect" | "check",
		) => {
			if (operation === "preview") {
				const input = credential.trim();
				setCredential("");
				setPreview(null);
				const result = await request<TrackingPreviewResponse>(
					"/api/tracking/account/preview",
					"POST",
					{},
					{ credential: input },
				);
				setPreview(result);
				return;
			}
			let result: TrackingAccountResponse;
			if (operation === "confirm") {
				if (!preview) return;
				result = await request(
					"/api/tracking/account/confirm",
					"POST",
					{},
					{ candidateId: preview.candidateId, generation: preview.generation },
				);
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
			setPreview(null);
		},
		onError: () => {
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
							<span className="rounded-md border px-2 py-1">
								{t(`trackingAccount.states.${current.state}`)}
							</span>
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
					<>
						<form
							id="tracking-credential-form"
							className="space-y-3"
							onSubmit={(event) => {
								event.preventDefault();
								command.mutate("preview");
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
								name="tracking-credential"
								type="password"
								autoComplete="off"
								maxLength={8192}
								value={credential}
								onChange={(event) => {
									setCredential(event.target.value);
									setPreview(null);
								}}
								disabled={busy}
								required
							/>
						</form>
						{preview && (
							<section
								className="space-y-3"
								aria-label={t("trackingAccount.confirmation")}
							>
								<p>
									{t("trackingAccount.confirmAccount", {
										name: preview.account.name,
									})}
								</p>
								<p className="text-sm text-muted-foreground">
									{t("trackingAccount.replaceNotice")}
								</p>
							</section>
						)}
					</>
				)}
				<fieldset
					aria-label={t("trackingAccount.actions")}
					className="action-row"
				>
					{current && (
						<>
							{current.provider.authorization.url && (
								<ActionLink
									icon={ExternalLink}
									label={t("trackingAccount.authorize")}
									shortLabel={t("trackingAccount.authorize")}
									href={current.provider.authorization.url}
									target="_blank"
									rel="noreferrer"
								/>
							)}
							<ActionButton
								icon={Eye}
								label={t("trackingAccount.preview")}
								shortLabel={t("actions.preview")}
								type="submit"
								form="tracking-credential-form"
								disabled={busy || !credential.trim()}
							/>
							{preview && (
								<>
									<ActionButton
										icon={Check}
										label={t("trackingAccount.confirm")}
										shortLabel={t("actions.connect")}
										disabled={busy}
										onClick={() => command.mutate("confirm")}
									/>
									<ActionButton
										icon={X}
										label={t("trackingAccount.cancel")}
										shortLabel={t("actions.cancel")}
										variant="outline"
										disabled={busy}
										onClick={() => setPreview(null)}
									/>
								</>
							)}
							{current.account && (
								<>
									<ActionButton
										icon={PlugZap}
										label={t("trackingAccount.check")}
										shortLabel={t("actions.test")}
										variant="outline"
										disabled={busy}
										onClick={() => command.mutate("check")}
									/>
									<ActionButton
										icon={Unplug}
										label={t("trackingAccount.disconnect")}
										shortLabel={t("actions.disconnect")}
										variant="outline"
										disabled={busy}
										onClick={() => command.mutate("disconnect")}
									/>
								</>
							)}
						</>
					)}
					{(account.error || command.error) && (
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
				{(account.error || command.error) && (
					<div role="alert" className="space-y-2">
						<p>{(command.error ?? account.error)?.message}</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
