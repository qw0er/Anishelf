import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { ApiClientError, isRequestCancelled } from "../../shared/api/client.js";
import { getClientRuntime } from "../../shared/api/connection.js";
import { Button } from "../../shared/components/ui/button.js";
import { FieldError } from "../../shared/components/ui/field.js";
import { Input } from "../../shared/components/ui/input.js";
import { Spinner } from "../../shared/components/ui/spinner.js";
import { loginReturnPath } from "./return-path.js";

export function SignInPanel({ children }: { children: ReactNode }) {
	return (
		<main className="min-h-screen grid place-items-center p-6 bg-background">
			<div className="w-full max-w-sm rounded-lg border p-6 space-y-4">
				{children}
			</div>
		</main>
	);
}

export function PasswordSignInForm() {
	const { t } = useTranslation();
	const [params] = useSearchParams();
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	return (
		<form
			className="space-y-4"
			onSubmit={async (event) => {
				event.preventDefault();
				setPending(true);
				setError("");
				try {
					const runtime = getClientRuntime();
					await runtime.authentication.signIn(password.trim());
					runtime.restartSession(
						loginReturnPath(params.get("returnTo"), runtime.connection.origin),
					);
				} catch (error) {
					setPending(false);
					if (isRequestCancelled(error)) return;
					console.debug("auth.sign_in_failed", {
						kind: error instanceof ApiClientError ? error.kind : "unexpected",
						status: error instanceof ApiClientError ? error.status : null,
					});
					setError(
						error instanceof Error ? error.message : t("auth.login.failed"),
					);
				}
			}}
		>
			<label htmlFor="login-password" className="block space-y-2">
				<span className="field-label">{t("auth.login.password")}</span>
				<Input
					id="login-password"
					aria-invalid={Boolean(error) || undefined}
					aria-describedby={error ? "login-password-error" : undefined}
					type="password"
					autoComplete="current-password"
					required
					maxLength={256}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					disabled={pending}
				/>
			</label>
			<FieldError id="login-password-error">{error}</FieldError>
			<Button
				type="submit"
				disabled={pending}
				aria-busy={pending}
				className="w-full"
			>
				<span className="relative">
					<span className={pending ? "absolute -left-6 top-0.5" : "hidden"}>
						<Spinner />
					</span>
					{t("auth.login.signIn")}
				</span>
			</Button>
		</form>
	);
}
