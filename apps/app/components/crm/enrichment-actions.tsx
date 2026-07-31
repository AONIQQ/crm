"use client";

import MagicWand from "@carbon/icons-react/es/MagicWand";
import Renew from "@carbon/icons-react/es/Renew";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

/**
 * The two things a rep can ask the agent for.
 *
 * Both are background work with no immediate result to show, so neither
 * navigates or blocks: the enrichment chip in the header goes to "Enriching"
 * and the page polls until it settles, and the brief appears on the timeline.
 */
export function EnrichmentActions({
	companyId,
	hasDomain,
}: {
	companyId: string;
	hasDomain: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const invalidateCompany = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: trpc.companies.byId.queryKey({ id: companyId }),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.companies.list.queryKey(),
			}),
		]);

	const enrich = useMutation(
		trpc.companies.enrich.mutationOptions({
			onSuccess: async (result) => {
				await invalidateCompany();
				toast.success(
					result.queued
						? "Looking it up — this page will update when it finishes."
						: "Already running.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const research = useMutation(
		trpc.companies.research.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.activities.timeline.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.activities.timelineCounts.queryKey(),
					}),
				]);
				toast.success("Brief added to the timeline.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				// Without a domain there is nothing to look up, and the API would only
				// come back and say so.
				disabled={!hasDomain || enrich.isPending}
				onClick={() => enrich.mutate({ id: companyId })}
			>
				{enrich.isPending ? (
					<Spinner />
				) : (
					<Icon icon={Renew} data-icon="inline-start" />
				)}
				Re-enrich
			</Button>

			<Button
				variant="outline"
				size="sm"
				disabled={!hasDomain || research.isPending}
				onClick={() => research.mutate({ id: companyId })}
			>
				{research.isPending ? (
					<Spinner />
				) : (
					<Icon icon={MagicWand} data-icon="inline-start" />
				)}
				Research
			</Button>
		</>
	);
}
