import {
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	FieldError,
	Input,
	NativeSelect,
	NativeSelectOption,
	Spinner,
} from "@anishelf/client-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopBridge, ServerSignInResult } from "../../ipc/desktop.js";

import { connectionError } from "../server/connection-error.js";

type ConnectionKind = Awaited<
	ReturnType<DesktopBridge["getServerConnection"]>
>["kind"];

export function ServerConnectionSettings({
	server,
	signIn,
	switchToLocal,
	restart,
}: {
	server: { kind: ConnectionKind; origin: string };
	signIn(address: string, password: string): Promise<ServerSignInResult>;
	switchToLocal(): Promise<ServerSignInResult>;
	restart(): void;
}) {
	const { t } = useTranslation();
	const [kind, setKind] = useState(server.kind);
	const [address, setAddress] = useState(
		server.kind === "external" ? server.origin : "",
	);
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<ReturnType<typeof connectionError>>();

	async function submit() {
		setPending(true);
		setError(undefined);
		try {
			const result =
				kind === "local"
					? await switchToLocal()
					: await signIn(address, password.trim());
			if (result.status === "ok") {
				restart();
				return;
			}
			setError(connectionError(result));
		} catch {
			setError(kind === "local" ? "localStartFailed" : "signInFailed");
		}
		setPending(false);
	}

	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("serverConnection.title")}</CardTitle>
				<p className="supporting-text">
					{server.kind === "local"
						? t("serverConnection.currentLocal")
						: t("serverConnection.currentExternal", { address: server.origin })}
				</p>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!pending && (kind !== "local" || server.kind !== "local"))
							void submit();
					}}
				>
					<label htmlFor="settings-connection-kind" className="block space-y-2">
						<span className="field-label">{t("serverConnection.mode")}</span>
						<NativeSelect
							id="settings-connection-kind"
							value={kind}
							disabled={pending}
							onChange={({ target: { value } }) => {
								if (value !== "local" && value !== "external") return;
								setKind(value);
								setError(undefined);
							}}
						>
							<NativeSelectOption value="local">
								{t("serverConnection.local")}
							</NativeSelectOption>
							<NativeSelectOption value="external">
								{t("serverConnection.external")}
							</NativeSelectOption>
						</NativeSelect>
					</label>
					{kind === "external" && (
						<>
							<label
								htmlFor="settings-server-address"
								className="block space-y-2"
							>
								<span className="field-label">
									{t("serverConnection.address")}
								</span>
								<Input
									id="settings-server-address"
									value={address}
									onChange={(event) => {
										setAddress(event.target.value);
										setError(undefined);
									}}
									inputMode="url"
									autoComplete="off"
									spellCheck={false}
									placeholder="https://anishelf.example.com"
									required
									disabled={pending}
									aria-describedby="settings-server-address-help"
									aria-invalid={error === "invalidAddress" || undefined}
								/>
							</label>
							<p id="settings-server-address-help" className="supporting-text">
								{t("serverConnection.addressHelp")}
							</p>
							<label
								htmlFor="settings-server-password"
								className="block space-y-2"
							>
								<span className="field-label">{t("auth.login.password")}</span>
								<Input
									id="settings-server-password"
									type="password"
									autoComplete="current-password"
									maxLength={128}
									value={password}
									onChange={(event) => {
										setPassword(event.target.value);
										setError(undefined);
									}}
									required
									disabled={pending}
									aria-invalid={error === "invalidPassword" || undefined}
								/>
							</label>
							{server.kind === "local" && (
								<p className="supporting-text">
									{t("serverConnection.stopLocalHelp")}
								</p>
							)}
						</>
					)}
					{error && <FieldError>{t(`serverConnection.${error}`)}</FieldError>}
					{(kind !== "local" || server.kind !== "local") && (
						<Button
							type="submit"
							aria-busy={pending}
							disabled={
								pending ||
								(kind === "external" && (!address.trim() || !password.trim()))
							}
						>
							{pending && <Spinner />}
							{t("serverConnection.connect")}
						</Button>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
