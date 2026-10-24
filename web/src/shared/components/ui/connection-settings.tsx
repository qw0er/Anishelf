import type { ReactNode } from "react";

/** Shared disclosure for service connections; incomplete setup is immediately editable. */
export function ConnectionSettings({
	configured,
	label,
	status,
	children,
}: {
	configured: boolean;
	label: string;
	status: string;
	children: ReactNode;
}) {
	return (
		<details
			open={!configured || undefined}
			className="min-w-0 rounded-md border px-3 py-2"
		>
			<summary className="cursor-pointer text-sm font-medium">
				{label}{" "}
				<span className="ml-2 font-normal text-muted-foreground">{status}</span>
			</summary>
			<div className="grid gap-3 pt-3 sm:grid-cols-2">{children}</div>
		</details>
	);
}
