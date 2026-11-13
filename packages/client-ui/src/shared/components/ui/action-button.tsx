import { type LucideIcon, RefreshCw } from "lucide-react";
import type { ComponentProps } from "react";
import { Button, buttonStyles } from "./button.js";
import { Spinner } from "./spinner.js";
import { Tooltip } from "./tooltip.js";

/** Business actions retain visible labels, including in narrow toolbars. */
export function ActionButton({
	icon: Icon,
	label,
	shortLabel = label,
	className,
	...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
	icon: LucideIcon;
	label: string;
	shortLabel?: string;
}) {
	const busy = props["aria-busy"] === true || props["aria-busy"] === "true";
	return (
		<Tooltip content={label}>
			<Button
				{...props}
				aria-label={label}
				className={(state) =>
					`responsive-action ${typeof className === "function" ? className(state) : (className ?? "")}`
				}
			>
				{busy && Icon !== RefreshCw ? (
					<Spinner />
				) : (
					<Icon
						size={16}
						className={`shrink-0 ${Icon === RefreshCw && busy ? "motion-safe:animate-spin" : ""}`}
						aria-hidden="true"
					/>
				)}
				<span className="responsive-action-label">{shortLabel}</span>
			</Button>
		</Tooltip>
	);
}

export function ActionLink({
	icon: Icon,
	label,
	shortLabel = label,
	href,
	...props
}: Omit<ComponentProps<"a">, "children"> & {
	icon: LucideIcon;
	label: string;
	shortLabel?: string;
	href: string;
}) {
	return (
		<Tooltip content={label}>
			<a
				{...props}
				href={href}
				aria-label={label}
				className={buttonStyles("outline", "responsive-action")}
			>
				<Icon size={16} className="shrink-0" aria-hidden="true" />
				<span className="responsive-action-label">{shortLabel}</span>
			</a>
		</Tooltip>
	);
}
