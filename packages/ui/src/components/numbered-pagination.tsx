"use client";

import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@crm/ui/components/pagination";

type PageEntry = number | "start-ellipsis" | "end-ellipsis";

/** First, last, and a window around the current page; ellipses for the rest. */
function paginationRange(current: number, total: number): PageEntry[] {
	if (total <= 7) {
		return Array.from({ length: total }, (_, index) => index + 1);
	}

	const start = Math.max(2, current - 1);
	const end = Math.min(total - 1, current + 1);
	const entries: PageEntry[] = [1];

	if (start > 2) entries.push("start-ellipsis");
	for (let page = start; page <= end; page++) entries.push(page);
	if (end < total - 1) entries.push("end-ellipsis");

	entries.push(total);
	return entries;
}

export function NumberedPagination({
	currentPage,
	totalPages,
	onPageChange,
}: {
	currentPage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}) {
	if (totalPages <= 1) return null;

	const goToPage = (page: number) => {
		const next = Math.min(Math.max(page, 1), totalPages);
		if (next !== currentPage) onPageChange(next);
	};

	return (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						href="#"
						aria-disabled={currentPage === 1 || undefined}
						className={
							currentPage === 1 ? "pointer-events-none opacity-50" : undefined
						}
						onClick={(event) => {
							event.preventDefault();
							goToPage(currentPage - 1);
						}}
					/>
				</PaginationItem>
				{paginationRange(currentPage, totalPages).map((entry) =>
					entry === "start-ellipsis" || entry === "end-ellipsis" ? (
						<PaginationItem key={entry} className="max-sm:hidden">
							<PaginationEllipsis />
						</PaginationItem>
					) : (
						<PaginationItem key={entry} className="max-sm:hidden">
							<PaginationLink
								href="#"
								isActive={entry === currentPage}
								onClick={(event) => {
									event.preventDefault();
									goToPage(entry);
								}}
							>
								{entry}
							</PaginationLink>
						</PaginationItem>
					),
				)}
				<PaginationItem>
					<PaginationNext
						href="#"
						aria-disabled={currentPage === totalPages || undefined}
						className={
							currentPage === totalPages
								? "pointer-events-none opacity-50"
								: undefined
						}
						onClick={(event) => {
							event.preventDefault();
							goToPage(currentPage + 1);
						}}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
