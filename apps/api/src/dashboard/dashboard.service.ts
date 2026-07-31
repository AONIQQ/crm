import { ActivityType, type Db, type DealStage } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { OPEN_DEAL_STAGES } from "../deals/deal-stage";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

@Injectable()
export class DashboardService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * What a rep wants on opening the app: where the pipeline is, what closes
	 * this month, what they are late on, and what just happened.
	 *
	 * Everything is aggregated in Postgres. The alternative — fetching deals and
	 * summing them here — is a page that gets slower every quarter.
	 */
	async summary(actingUserId: string) {
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

		const [
			byStage,
			closingThisMonth,
			overdueTasks,
			recentActivity,
			wonThisMonth,
		] = await Promise.all([
			this.db.deal.groupBy({
				by: ["stage"],
				where: { stage: { in: [...OPEN_DEAL_STAGES] } },
				_count: { _all: true },
				_sum: { amount: true },
			}),
			this.db.deal.findMany({
				where: {
					stage: { in: [...OPEN_DEAL_STAGES] },
					expectedCloseDate: { gte: startOfMonth, lt: startOfNextMonth },
				},
				orderBy: [{ expectedCloseDate: "asc" }],
				take: 10,
				select: {
					id: true,
					name: true,
					stage: true,
					amount: true,
					currency: true,
					expectedCloseDate: true,
					company: { select: { id: true, name: true, iconUrl: true } },
					owner: { select: OWNER_SELECT },
				},
			}),
			this.db.activity.findMany({
				where: {
					type: ActivityType.TASK,
					completedAt: null,
					dueAt: { lt: now },
					createdById: actingUserId,
				},
				orderBy: [{ dueAt: "asc" }],
				take: 10,
				select: {
					id: true,
					subject: true,
					dueAt: true,
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
			this.db.activity.findMany({
				orderBy: [{ createdAt: "desc" }],
				take: 12,
				select: {
					id: true,
					type: true,
					subject: true,
					body: true,
					createdAt: true,
					meta: true,
					createdBy: { select: OWNER_SELECT },
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
			this.db.deal.aggregate({
				where: {
					stage: "CLOSED_WON",
					closedAt: { gte: startOfMonth, lt: startOfNextMonth },
				},
				_count: { _all: true },
				_sum: { amount: true },
			}),
		]);

		const stages = OPEN_DEAL_STAGES.map((stage) => {
			const group = byStage.find((row) => row.stage === stage);
			return {
				stage: stage as DealStage,
				count: group?._count._all ?? 0,
				valueCents: toCents(group?._sum.amount ?? null) ?? 0,
			};
		});

		return {
			pipeline: {
				stages,
				totalCents: stages.reduce(
					(total, stage) => total + stage.valueCents,
					0,
				),
				totalDeals: stages.reduce((total, stage) => total + stage.count, 0),
			},
			wonThisMonth: {
				count: wonThisMonth._count._all,
				valueCents: toCents(wonThisMonth._sum.amount) ?? 0,
			},
			closingThisMonth: closingThisMonth.map(
				({ amount, expectedCloseDate, ...deal }) => ({
					...deal,
					amountCents: toCents(amount),
					expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
				}),
			),
			overdueTasks: overdueTasks.map(({ dueAt, ...task }) => ({
				...task,
				dueAt: dueAt?.toISOString() ?? null,
			})),
			recentActivity: recentActivity.map(({ createdAt, meta, ...entry }) => ({
				...entry,
				createdAt: createdAt.toISOString(),
				meta: meta as Record<string, unknown> | null,
			})),
		};
	}
}
