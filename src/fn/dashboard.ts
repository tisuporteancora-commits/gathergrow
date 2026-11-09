import { createServerFn } from "@tanstack/react-start";
import { query } from "./db";
import { requireUser } from "./require-user";

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();

  const kpis = await query<{
    sales_today: string;
    profit_today: string;
    customers_today: string;
    low_stock: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sales WHERE status = 'completed' AND created_at::date = CURRENT_DATE), 0)::text AS sales_today,
       COALESCE((
         SELECT SUM(si.line_total - (si.qty * p.cost_price))
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         WHERE s.status = 'completed' AND s.created_at::date = CURRENT_DATE
       ), 0)::text AS profit_today,
       COALESCE((SELECT COUNT(*) FROM sales WHERE status = 'completed' AND created_at::date = CURRENT_DATE), 0)::text AS customers_today,
       COALESCE((SELECT COUNT(*) FROM products WHERE stock_qty <= min_stock), 0)::text AS low_stock`,
  );

  const week = await query<{ day: string; total: string }>(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(s.total), 0)::text AS total
     FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') d
     LEFT JOIN sales s
       ON s.created_at::date = d::date AND s.status = 'completed'
     GROUP BY d::date
     ORDER BY d::date`,
  );

  const topProducts = await query<{
    name: string;
    category: string | null;
    qty: string;
    revenue: string;
  }>(
    `SELECT p.name, c.name AS category,
            COALESCE(SUM(si.qty), 0)::text AS qty,
            COALESCE(SUM(si.line_total), 0)::text AS revenue
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.status = 'completed' AND s.created_at::date = CURRENT_DATE
     GROUP BY p.id, p.name, c.name
     ORDER BY SUM(si.line_total) DESC
     LIMIT 5`,
  );

  const recentSales = await query<{
    code: string;
    created_at: string;
    operator: string;
    method: string | null;
    total: string;
    status: string;
  }>(
    `SELECT s.code, s.created_at::text, u.name AS operator,
            p.method, s.total::text, s.status
     FROM sales s
     JOIN users u ON u.id = s.operator_id
     LEFT JOIN LATERAL (
       SELECT method FROM payments WHERE sale_id = s.id ORDER BY id LIMIT 1
     ) p ON true
     ORDER BY s.created_at DESC
     LIMIT 8`,
  );

  return {
    userName: user.name,
    salesToday: Number(kpis.rows[0]?.sales_today ?? 0),
    profitToday: Number(kpis.rows[0]?.profit_today ?? 0),
    customersToday: Number(kpis.rows[0]?.customers_today ?? 0),
    lowStock: Number(kpis.rows[0]?.low_stock ?? 0),
    week: week.rows.map((r) => ({ day: r.day, total: Number(r.total) })),
    topProducts: topProducts.rows.map((r) => ({
      name: r.name,
      category: r.category,
      qty: Number(r.qty),
      revenue: Number(r.revenue),
    })),
    recentSales: recentSales.rows.map((r) => ({
      code: r.code,
      createdAt: r.created_at,
      operator: r.operator,
      method: r.method,
      total: Number(r.total),
      status: r.status,
    })),
  };
});
