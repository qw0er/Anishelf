import { cn } from "cn";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	MoreHorizontalIcon,
} from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { type Button, buttonStyles } from "./button.js";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
	const { t } = useTranslation();
	return (
		<nav
			aria-label={t("pagination.label")}
			data-slot="pagination"
			className={cn("mx-auto flex w-full justify-center", className)}
			{...props}
		/>
	);
}

function PaginationContent({
	className,
	...props
}: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="pagination-content"
			className={cn("flex items-center gap-0.5", className)}
			{...props}
		/>
	);
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
	return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
	isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, "size"> &
	React.ComponentProps<"a">;

function PaginationLink({
	className,
	isActive,
	size = "icon",
	...props
}: PaginationLinkProps) {
	return (
		<a
			aria-current={isActive ? "page" : undefined}
			data-slot="pagination-link"
			data-active={isActive}
			className={buttonStyles(isActive ? "outline" : "ghost", className, size)}
			{...props}
		/>
	);
}

function PaginationPrevious({
	className,
	text,
	...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
	const { t } = useTranslation();
	return (
		<PaginationLink
			aria-label={t("pagination.previousLabel")}
			size="default"
			className={cn("pl-1.5!", className)}
			{...props}
		>
			<ChevronLeftIcon className="cn-rtl-flip" aria-hidden="true" />
			<span className="hidden sm:block">
				{text ?? t("pagination.previous")}
			</span>
		</PaginationLink>
	);
}

function PaginationNext({
	className,
	text,
	...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
	const { t } = useTranslation();
	return (
		<PaginationLink
			aria-label={t("pagination.nextLabel")}
			size="default"
			className={cn("pr-1.5!", className)}
			{...props}
		>
			<span className="hidden sm:block">{text ?? t("pagination.next")}</span>
			<ChevronRightIcon className="cn-rtl-flip" aria-hidden="true" />
		</PaginationLink>
	);
}

function PaginationEllipsis({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			aria-hidden
			data-slot="pagination-ellipsis"
			className={cn(
				"flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			<MoreHorizontalIcon aria-hidden="true" />
		</span>
	);
}

export {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
};
