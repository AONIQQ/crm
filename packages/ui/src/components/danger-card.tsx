"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@crm/ui/components/alert-dialog";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { CardTable } from "@crm/ui/components/card-table";
import { TableCell, TableRow } from "@crm/ui/components/table";
import type { ReactNode } from "react";

export type DangerAction = {
	id: string;
	action: ReactNode;
	description: ReactNode;
	buttonLabel: string;
	disabled?: boolean;
	confirmTitle: string;
	confirmDescription: ReactNode;
	confirmLabel: string;
	onConfirm: () => void;
};

export function DangerCard({
	title = "Danger zone",
	description,
	actions,
}: {
	title?: string;
	description: ReactNode;
	actions: DangerAction[];
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardTable
				columns={[
					{ header: "Action", width: "w-64" },
					{ header: "Description" },
					{ header: "", width: "w-40", srLabel: "Actions", align: "right" },
				]}
			>
				{actions.map((item) => (
					<TableRow key={item.id} className="hover:bg-transparent">
						<TableCell className="px-3 py-3 font-medium">
							{item.action}
						</TableCell>
						<TableCell className="whitespace-normal px-3 py-3 text-muted-foreground">
							{item.description}
						</TableCell>
						<TableCell className="px-3 py-3 text-right">
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button
										variant="destructive"
										size="sm"
										disabled={item.disabled}
									>
										{item.buttonLabel}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>{item.confirmTitle}</AlertDialogTitle>
										<AlertDialogDescription>
											{item.confirmDescription}
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction onClick={item.onConfirm}>
											{item.confirmLabel}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</TableCell>
					</TableRow>
				))}
			</CardTable>
		</Card>
	);
}
