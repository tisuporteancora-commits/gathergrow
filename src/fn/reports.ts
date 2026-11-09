import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "./db";
import { requireUser } from "./require-user";

export const getReportsData = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        days: z.coerce.number().int().min(1).max(90).default(7),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const days = data?.days ?? 7;

    const kpis = await query<{
      revenue: string;
      profit: string;
      ticket: string;
      sales_count: string;
    }>(
      `SELECT
         COALESCE(SUM(s.total), 0)::text AS revenue,
         COALESCE(SUM(si.line_total - (si.qty * p.cost_price)), 0)::text AS profit,
         COALESCE(AVG(s.total), 0)::text AS ticket,
         COUNT(DISTINCT s.id)::text AS sales_count
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed'
         AND s.created_at >= NOW() - ($1 || ' days')::interval`,
      [String(days)],
    );

    const daily = await query<{ day: string; total: string }>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(s.total), 0)::text AS total
       FROM generate_series(CURRENT_DATE - (($1::int - 1) || ' days')::interval, CURRENT_DATE, '1 day') d
       LEFT JOIN sales s ON s.created_at::date = d::date AND s.status = 'completed'
       GROUP BY d::date
       ORDER BY d::date`,
      [String(days)],
    );

    const byOperator = await query<{
      name: string;
      sales_count: string;
      total: string;
    }>(
      `SELECT u.name,
              COUNT(s.id)::text AS sales_count,
              COALESCE(SUM(s.total), 0)::text AS total
       FROM sales s
       JOIN users u ON u.id = s.operator_id
       WHERE s.status = 'completed'
         AND s.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY u.id, u.name
       ORDER BY SUM(s.total) DESC`,
      [String(days)],
    );

    const abc = await query<{
      name: string;
      category: string | null;
      qty: string;
      revenue: string;
      margin: string;
    }>(
      `SELECT p.name, c.name AS category,
              COALESCE(SUM(si.qty), 0)::text AS qty,
              COALESCE(SUM(si.line_total), 0)::text AS revenue,
              CASE WHEN SUM(si.line_total) = 0 THEN 0
                   ELSE SUM(si.line_total - (si.qty * p.cost_price)) / SUM(si.line_total) * 100
              END::text AS margin
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE s.status = 'completed'
         AND s.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY p.id, p.name, c.name
       ORDER BY SUM(si.line_total) DESC
       LIMIT 50`,
      [String(days)],
    );

    const revenue = Number(kpis.rows[0]?.revenue ?? 0);
    const profit = Number(kpis.rows[0]?.profit ?? 0);
    let running = 0;
    const abcRows = abc.rows.map((r) => {
      const rev = Number(r.revenue);
      running += rev;
      const share = revenue > 0 ? (running / revenue) * 100 : 0;
      const abcClass = share <= 80 ? "A" : share <= 95 ? "B" : "C";
      return {
        name: r.name,
        category: r.category,
        qty: Number(r.qty),
        revenue: rev,
        margin: Number(r.margin),
        abcClass,
      };
    });

    return {
      days,
      revenue,
      profit,
      profitability: revenue > 0 ? (profit / revenue) * 100 : 0,
      ticket: Number(kpis.rows[0]?.ticket ?? 0),
      salesCount: Number(kpis.rows[0]?.sales_count ?? 0),
      daily: daily.rows.map((r) => ({ day: r.day, total: Number(r.total) })),
      byOperator: byOperator.rows.map((r) => ({
        name: r.name,
        salesCount: Number(r.sales_count),
        total: Number(r.total),
      })),
      abc: abcRows,
    };
  });
