"use client";

import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@crm/ui/components/drawer";
import {
	type SheetSize,
	Sheet as UISheet,
	SheetClose as UISheetClose,
	SheetContent as UISheetContent,
	SheetDescription as UISheetDescription,
	SheetFooter as UISheetFooter,
	SheetHeader as UISheetHeader,
	SheetTitle as UISheetTitle,
	SheetTrigger as UISheetTrigger,
} from "@crm/ui/components/sheet";
import { useIsMobile } from "@crm/ui/hooks/use-mobile";
import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";
import { createContext, useContext } from "react";

/**
 * A sheet on a desktop, a drawer on a phone, one set of imports either way.
 *
 * Everything in this app that would have been a sub-page is a sheet, and a
 * 5xl panel sliding in from the right of a 390px screen is not a sheet, it is
 * a broken page. Swapping the primitive here rather than at each call site
 * means no screen has to know which one it got.
 */
const ResponsiveContext = createContext(false);
const useResponsive = () => useContext(ResponsiveContext);

type RootProps = {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	modal?: boolean;
	children?: React.ReactNode;
};

function Sheet({ children, ...props }: RootProps) {
	const isMobile = useIsMobile();
	return (
		<ResponsiveContext.Provider value={isMobile}>
			{isMobile ? (
				<Drawer {...props}>{children}</Drawer>
			) : (
				<UISheet {...props}>{children}</UISheet>
			)}
		</ResponsiveContext.Provider>
	);
}

function SheetTrigger(
	props: React.ComponentProps<"button"> & { asChild?: boolean },
) {
	return useResponsive() ? (
		<DrawerTrigger {...props} />
	) : (
		<UISheetTrigger {...props} />
	);
}

function SheetClose(
	props: React.ComponentProps<"button"> & { asChild?: boolean },
) {
	return useResponsive() ? (
		<DrawerClose {...props} />
	) : (
		<UISheetClose {...props} />
	);
}

function SheetContent({
	children,
	side,
	size,
	showCloseButton,
	className,
	...props
}: React.ComponentProps<"div"> & {
	side?: "top" | "right" | "bottom" | "left";
	size?: SheetSize;
	showCloseButton?: boolean;
}) {
	if (useResponsive()) {
		// A bottom drawer is otherwise content-height, so a short body (or a tab
		// switch to a near-empty panel) collapses it and shifts the page. Pin a
		// stable default height for every drawer app-wide; callers can still
		// override via `className` since it merges last.
		return (
			<DrawerContent
				className={cn(
					"data-[vaul-drawer-direction=bottom]:h-[88dvh]",
					className,
				)}
				{...props}
			>
				{children}
			</DrawerContent>
		);
	}
	return (
		<UISheetContent
			side={side}
			size={size}
			showCloseButton={showCloseButton}
			className={className}
			{...props}
		>
			{children}
		</UISheetContent>
	);
}

function SheetHeader(props: React.ComponentProps<"div">) {
	return useResponsive() ? (
		<DrawerHeader {...props} />
	) : (
		<UISheetHeader {...props} />
	);
}

function SheetFooter(props: React.ComponentProps<"div">) {
	return useResponsive() ? (
		<DrawerFooter {...props} />
	) : (
		<UISheetFooter {...props} />
	);
}

function SheetTitle(props: {
	className?: string;
	size?: "default" | "lg";
	children?: React.ReactNode;
}) {
	return useResponsive() ? (
		<DrawerTitle {...props} />
	) : (
		<UISheetTitle {...props} />
	);
}

function SheetDescription(props: {
	className?: string;
	children?: React.ReactNode;
}) {
	return useResponsive() ? (
		<DrawerDescription {...props} />
	) : (
		<UISheetDescription {...props} />
	);
}

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
};
