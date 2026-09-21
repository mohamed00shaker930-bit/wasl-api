import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "@/db/db.module";
import { num } from "@/domain/money";

export type Grain = "day" | "week" | "month";

/**
 * admin_kpis(p_from, p_to, p_grain) reimplemented as one query batch. Shape follows what admin.kpis.tsx renders:
 * summary with previous-period deltas, by_channel/by_status/by_payment, a time series, top stores/products, customers,
 * credit outstanding + collection rate, attention queue, ratings. Time zone fixed to Asia/Aden as before.
 */
@Injectable()
export class AdminKpisService {
  constructor(private dbs: DbService) {}

  async kpis(from: Date, to: Date, grain: Grain) {
    const db = this.dbs.db;
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span), prevTo = from;
    const period = (f: Date, t: Date) => db.execute(sql`
      select count(*)::int as orders,
             count(*) filter (where status = 'delivered')::int as delivered,
             count(*) filter (where status in ('declined','cancelled'))::int as cancelled,
             coalesce(sum(total) filter (where status = 'delivered'), 0) as revenue,
             coalesce(sum(commission_amount) filter (where status = 'delivered'), 0) as commission,
             count(distinct customer_id)::int as customers,
             count(*) filter (where return_status = 'requested')::int as returns_pending
      from orders where created_at >= ${f} and created_at < ${t}`).then((r) => r.rows[0] as Record<string, unknown>);
    const [cur, prev] = await Promise.all([period(from, to), period(prevFrom, prevTo)]);
    const group = (col: string) => db.execute(sql`select ${sql.raw(col)}::text as key, count(*)::int as orders, coalesce(sum(total), 0) as total from orders where created_at >= ${from} and created_at < ${to} group by 1 order by 2 desc`).then((r) => r.rows);
    const [byChannel, byStatus, byPayment] = await Promise.all([group("channel"), group("status"), group("payment_method")]);
    const series = await db.execute(sql`
      select to_char(date_trunc(${grain}, created_at at time zone 'Asia/Aden'), 'YYYY-MM-DD') as bucket, count(*)::int as orders,
             coalesce(sum(total) filter (where status = 'delivered'), 0) as revenue, coalesce(sum(commission_amount) filter (where status = 'delivered'), 0) as commission
      from orders where created_at >= ${from} and created_at < ${to} group by 1 order by 1`).then((r) => r.rows);
    const topStores = await db.execute(sql`
      select s.id, s.name, count(*)::int as orders, coalesce(sum(o.total) filter (where o.status = 'delivered'), 0) as revenue
      from orders o join stores s on s.id = o.store_id where o.created_at >= ${from} and o.created_at < ${to} group by s.id, s.name order by revenue desc limit 10`).then((r) => r.rows);
    const topProducts = await db.execute(sql`
      select i.name, sum(i.qty)::int as qty, coalesce(sum(i.qty * i.price), 0) as total
      from order_items i join orders o on o.id = i.order_id where o.created_at >= ${from} and o.created_at < ${to} and o.status = 'delivered' group by i.name order by qty desc limit 10`).then((r) => r.rows);
    const customersRow = await db.execute(sql`
      select count(*) filter (where p.created_at >= ${from} and p.created_at < ${to})::int as new_customers,
             count(*) filter (where p.account_status = 'pending')::int as pending_accounts,
             count(*) filter (where p.account_status = 'active')::int as active_accounts
      from profiles p`).then((r) => r.rows[0] as Record<string, unknown>);
    const creditRow = await db.execute(sql`
      select coalesce((select sum(balance) from credit_accounts), 0) as outstanding,
             coalesce(sum(amount) filter (where type = 'charge' and status = 'approved'), 0) as charged,
             coalesce(sum(amount) filter (where type = 'payment' and status = 'approved'), 0) as collected,
             count(*) filter (where status = 'pending')::int as pending_entries
      from credit_transactions where created_at >= ${from} and created_at < ${to}`).then((r) => r.rows[0] as Record<string, unknown>);
    const attention = await db.execute(sql`
      select 'orders_stuck' as kind, count(*)::int as n from orders where status in ('sent','accepted','preparing') and created_at < now() - interval '24 hours'
      union all select 'wallet_topups_pending', count(*)::int from wallet_transactions where status = 'pending'
      union all select 'returns_requested', count(*)::int from orders where return_status = 'requested'
      union all select 'accounts_pending', count(*)::int from profiles where account_status = 'pending'
      union all select 'stores_pending', count(*)::int from stores where status = 'pending'
      union all select 'password_resets_pending', count(*)::int from password_reset_requests where status = 'pending'`).then((r) => r.rows);
    const ratings = await db.execute(sql`select coalesce(avg(stars), 0) as avg_stars, count(*)::int as ratings from ratings where created_at >= ${from} and created_at < ${to}`).then((r) => r.rows[0] as Record<string, unknown>);
    const delta = (k: string) => { const a = num(cur[k] as string), b = num(prev[k] as string); return { value: a, previous: b, delta_pct: b ? Math.round(((a - b) / b) * 1000) / 10 : null }; };
    const charged = num(creditRow.charged as string), collected = num(creditRow.collected as string);
    return {
      range: { from, to, grain }, summary: { orders: delta("orders"), delivered: delta("delivered"), cancelled: delta("cancelled"), revenue: delta("revenue"), commission: delta("commission"), customers: delta("customers"), returns_pending: num(cur.returns_pending as string) },
      by_channel: byChannel, by_status: byStatus, by_payment: byPayment, series, top_stores: topStores, top_products: topProducts, customers: customersRow,
      credit: { outstanding: num(creditRow.outstanding as string), charged, collected, collection_rate: charged ? Math.round((collected / charged) * 1000) / 10 : null, pending_entries: creditRow.pending_entries },
      attention: Object.fromEntries(attention.map((a) => [a.kind as string, a.n])), ratings,
    };
  }
}
