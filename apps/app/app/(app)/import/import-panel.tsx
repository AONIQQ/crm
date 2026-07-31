"use client";

import Upload from "@carbon/icons-react/es/Upload";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Field, FieldDescription, FieldLabel } from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Separator } from "@crm/ui/components/separator";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Report = RouterOutputs["import"]["run"];
type Outcome = Report["rows"][number]["outcome"];

const KINDS = ["companies", "contacts", "deals"] as const;

const KIND_HELP: Record<(typeof KINDS)[number], string> = {
	companies:
		"Matched on domain. Columns: Name, Company Domain Name, Phone, City, Country, Industry.",
	contacts:
		"Matched on email. Columns: First Name, Last Name, Email, Phone, Job Title, Associated Company.",
	deals:
		"Matched on deal name within a company. Columns: Deal Name, Associated Company, Deal Stage, Amount, Close Date. Import companies first.",
};

const OUTCOME_TONE: Record<Outcome, StatusTone> = {
	created: "success",
	updated: "info",
	skipped: "neutral",
	failed: "error",
};

const UNASSIGNED = "unassigned";

/**
 * HubSpot CSV import.
 *
 * Always dry-runs first. The report is the whole point: a bad column mapping is
 * invisible until you can see that four hundred rows would be "skipped — no
 * name and no domain", and by then it has already run.
 */
export function ImportPanel() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [kind, setKind] = useQueryState(
		"kind",
		parseAsStringLiteral(KINDS).withDefault("companies"),
	);
	const [fileName, setFileName] = useState<string | null>(null);
	const [csv, setCsv] = useState("");
	const [ownerId, setOwnerId] = useState(UNASSIGNED);
	const [report, setReport] = useState<Report | null>(null);

	const fileId = useId();

	const users = useQuery(trpc.users.list.queryOptions());

	const run = useMutation(
		trpc.import.run.mutationOptions({
			onSuccess: async (result) => {
				setReport(result);
				if (result.dryRun) {
					toast.success("Dry run finished — nothing was written.");
					return;
				}
				// An applied import touches everything.
				await queryClient.invalidateQueries();
				toast.success(
					`Imported: ${result.created} created, ${result.updated} updated.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const submit = (dryRun: boolean) =>
		run.mutate({
			kind,
			csv,
			dryRun,
			defaultOwnerId: ownerId === UNASSIGNED ? null : ownerId,
		});

	const readFile = async (file: File) => {
		setFileName(file.name);
		setCsv(await file.text());
		// The old report describes the old file.
		setReport(null);
	};

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>File</CardTitle>
				</CardHeader>
				<Separator />
				<CardContent className="flex flex-col gap-4">
					<Field>
						<FieldLabel htmlFor="import-kind">What is in it</FieldLabel>
						<Select
							value={kind}
							onValueChange={(next) => {
								void setKind(next as (typeof KINDS)[number]);
								setReport(null);
							}}
						>
							<SelectTrigger id="import-kind">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="companies">Companies</SelectItem>
								<SelectItem value="contacts">Contacts</SelectItem>
								<SelectItem value="deals">Deals</SelectItem>
							</SelectContent>
						</Select>
						<FieldDescription>{KIND_HELP[kind]}</FieldDescription>
					</Field>

					<Field>
						<FieldLabel htmlFor={fileId}>CSV</FieldLabel>
						<input
							id={fileId}
							type="file"
							accept=".csv,text/csv"
							className="text-sm file:mr-3 file:border file:bg-muted file:px-3 file:py-1.5 file:text-xs"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file) void readFile(file);
							}}
						/>
						{fileName ? (
							<FieldDescription>
								{fileName} · {csv.length.toLocaleString()} characters
							</FieldDescription>
						) : null}
					</Field>

					<Field>
						<FieldLabel htmlFor="import-owner">
							Owner for rows that do not name one
						</FieldLabel>
						<Select value={ownerId} onValueChange={setOwnerId}>
							<SelectTrigger id="import-owner">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
								{(users.data ?? []).map((user) => (
									<SelectItem key={user.id} value={user.id}>
										{user.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{kind === "deals" ? (
							<FieldDescription>
								Deals must have an owner, so this one is not optional for them.
							</FieldDescription>
						) : null}
					</Field>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							disabled={run.isPending || csv === ""}
							onClick={() => submit(true)}
						>
							{run.isPending ? <Spinner /> : null}
							Dry run
						</Button>
						<Button
							variant="outline"
							size="sm"
							// Only enabled once a dry run of *this* file has been read.
							disabled={run.isPending || !report?.dryRun}
							onClick={() => submit(false)}
						>
							<Icon icon={Upload} data-icon="inline-start" />
							Apply {report ? `${report.created + report.updated} rows` : ""}
						</Button>
					</div>
				</CardContent>
			</Card>

			{report ? <ImportReportCard report={report} /> : null}
		</div>
	);
}

const REPORT_COLUMNS = [
	{ header: "Row", width: "w-[10%]", align: "right" as const },
	{ header: "Outcome", width: "w-[18%]" },
	{ header: "Record", width: "w-[34%]" },
	{ header: "Why", width: "w-[38%]" },
];

function ImportReportCard({ report }: { report: Report }) {
	// The ones that need a decision come first; a thousand clean "created" rows
	// are not what anyone is scanning for.
	const rows = [...report.rows].sort((a, b) => {
		const rank = (outcome: Outcome) =>
			outcome === "failed" ? 0 : outcome === "skipped" ? 1 : 2;
		return rank(a.outcome) - rank(b.outcome) || a.line - b.line;
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{report.dryRun ? "Dry run" : "Imported"}</CardTitle>
				<CardAction>
					<span className="flex flex-wrap items-center gap-4 text-xs">
						<StatusIndicator
							tone="success"
							label={`${report.created} created`}
						/>
						<StatusIndicator tone="info" label={`${report.updated} updated`} />
						{report.skipped > 0 ? (
							<StatusIndicator
								tone="neutral"
								label={`${report.skipped} skipped`}
							/>
						) : null}
						{report.failed > 0 ? (
							<StatusIndicator tone="error" label={`${report.failed} failed`} />
						) : null}
					</span>
				</CardAction>
			</CardHeader>

			<SimpleTable columns={REPORT_COLUMNS}>
				{rows.map((row) => (
					<SimpleTableRow key={row.line}>
						<TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
							{row.line}
						</TableCell>
						<TableCell className="px-3 py-2 capitalize">
							<StatusIndicator
								tone={OUTCOME_TONE[row.outcome]}
								label={row.outcome}
							/>
						</TableCell>
						<TableCell className="truncate px-3 py-2">
							{row.label ?? row.key ?? "—"}
						</TableCell>
						<TableCell className="truncate px-3 py-2 text-muted-foreground">
							{row.reason ?? ""}
						</TableCell>
					</SimpleTableRow>
				))}
			</SimpleTable>
		</Card>
	);
}
