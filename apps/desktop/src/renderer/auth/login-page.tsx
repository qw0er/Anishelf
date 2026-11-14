import {
	Button,
	FieldError,
	Input,
	loginReturnPath,
	SignInPanel,
	Spinner,
} from "@anishelf/client-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	useBlocker,
	useLocation,
	useNavigate,
	useSearchParams,
} from "react-router";
import type { ServerSignInResult } from "../../ipc/desktop.js";

type SignInError =
	| Exclude<ServerSignInResult["status"], "ok" | "rejected">
	| "invalidPassword"
	| "rateLimited"
	| "signInFailed";

function signInError(
	result: Exclude<ServerSignInResult, { status: "ok" }>,
): SignInError {
	if (result.status !== "rejected") return result.status;
	if (result.httpStatus === 401) return "invalidPassword";
	if (result.httpStatus === 429) return "rateLimited";
	return "signInFailed";
}

export function DesktopLoginPage({
	origin,
	signIn,
	restart,
}: {
	origin: string;
	signIn(address: string, password: string): Promise<ServerSignInResult>;
	restart(path: string): void;
}) {
	const { t } = useTranslation();
	const { state } = useLocation();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const [address, setAddress] = useState(origin);
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<SignInError>();
	useBlocker(pending);

	async function submit() {
		setPending(true);
		setError(undefined);
		try {
			const result = await signIn(address, password.trim());
			if (result.status === "ok") {
				const returnTo =
					result.origin === origin ? params.get("returnTo") : null;
				restart(loginReturnPath(returnTo, result.origin));
				return;
			}
			setError(signInError(result));
		} catch {
			console.error("desktop.sign_in_request_failed");
			setError("signInFailed");
		}
		setPending(false);
	}

	return (
		<SignInPanel>
			<h1 className="page-title">{t("auth.login.title")}</h1>
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (!pending) void submit();
				}}
			>
				<label htmlFor="server-origin" className="block space-y-2">
					<span className="field-label">{t("serverConnection.address")}</span>
					<Input
						id="server-origin"
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
						aria-invalid={error === "invalidAddress" || undefined}
						aria-describedby={
							error === "invalidAddress"
								? "server-origin-help sign-in-error"
								: "server-origin-help"
						}
					/>
				</label>
				<p id="server-origin-help" className="text-sm text-muted-foreground">
					{t("serverConnection.addressHelp")}
				</p>
				<label htmlFor="login-password" className="block space-y-2">
					<span className="field-label">{t("auth.login.password")}</span>
					<Input
						id="login-password"
						type="password"
						autoComplete="current-password"
						maxLength={128}
						required
						value={password}
						onChange={(event) => {
							setPassword(event.target.value);
							setError(undefined);
						}}
						disabled={pending}
						aria-invalid={error === "invalidPassword" || undefined}
						aria-describedby={
							error === "invalidPassword" ? "sign-in-error" : undefined
						}
					/>
				</label>
				{error && (
					<FieldError id="sign-in-error">
						{t(`serverConnection.${error}`)}
					</FieldError>
				)}
				<div className="action-row">
					<Button
						type="submit"
						disabled={pending || !password.trim()}
						aria-busy={pending}
					>
						{pending && <Spinner />}
						{t("auth.login.signIn")}
					</Button>
					{state?.canGoBack === true && (
						<Button
							type="button"
							variant="ghost"
							disabled={pending}
							onClick={() => void navigate(-1)}
						>
							{t("actions.cancel")}
						</Button>
					)}
				</div>
			</form>
		</SignInPanel>
	);
}
