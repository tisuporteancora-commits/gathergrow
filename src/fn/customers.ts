import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "./db";
import { requireUser } from "./require-user";

export type CustomerRow = {
  id: number;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: string;
  open_balance: string;
  active: boolean;
};

const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.document, c.phone, c.email, c.address, c.notes,
         c.credit_limit::text, c.active,
         COALESCE((
           SELECT SUM(a.amount) FROM accounts a
           WHERE a.direction = 'receivable'
             AND a.status IN ('open', 'overdue')
             AND a.party_name = c.name
         ), 0)::text AS open_balance
  FROM customers c
`;

export const listCustomers = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        search: z.string().optional(),
        activeOnly: z.boolean().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const params: unknown[] = [];
    const where: string[] = [];

    if (data?.activeOnly !== false) {
      where.push(`c.active = TRUE`);
    }
    if (data?.search?.trim()) {
      params.push(`%${data.search.trim()}%`);
      where.push(
        `(c.name ILIKE $${params.length} OR COALESCE(c.document,'') ILIKE $${params.length} OR COALESCE(c.phone,'') ILIKE $${params.length})`,
      );
    }

    const result = await query<CustomerRow>(
      `${CUSTOMER_SELECT}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.name ASC
       LIMIT 300`,
      params,
    );
    return result.rows;
  });

export const searchCustomers = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireUser();
    const q = `%${data.q.trim()}%`;
    const result = await query<CustomerRow>(
      `${CUSTOMER_SELECT}
       WHERE c.active AND (c.name ILIKE $1 OR COALESCE(c.document,'') ILIKE $1)
       ORDER BY c.name
       LIMIT 20`,
      [q],
    );
    return result.rows;
  });

const customerInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(2).max(160),
  document: z.string().max(32).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  email: z.string().max(120).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  creditLimit: z.coerce.number().min(0).default(0),
  active: z.boolean().optional(),
});

export const upsertCustomer = createServerFn({ method: "POST" })
  .validator(customerInput)
  .handler(async ({ data }) => {
    await requireUser();
    const document = data.document?.trim() || null;
    const phone = data.phone?.trim() || null;
    const email = data.email?.trim() || null;
    const address = data.address?.trim() || null;
    const notes = data.notes?.trim() || null;

    if (data.id) {
      const result = await query<{ id: number }>(
        `UPDATE customers SET
           name=$1, document=$2, phone=$3, email=$4, address=$5, notes=$6,
           credit_limit=$7, active=COALESCE($8, active)
         WHERE id=$9
         RETURNING id`,
        [
          data.name.trim(),
          document,
          phone,
          email,
          address,
          notes,
          data.creditLimit,
          data.active,
          data.id,
        ],
      );
      if (!result.rows[0]) throw new Error("Cliente não encontrado.");
      return { id: result.rows[0].id };
    }

    const result = await query<{ id: number }>(
      `INSERT INTO customers (name, document, phone, email, address, notes, credit_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [data.name.trim(), document, phone, email, address, notes, data.creditLimit],
    );
    return { id: result.rows[0]!.id };
  });

/** Compatível com o atalho do PDV */
export const createCustomer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(2).max(160),
      document: z.string().max(32).optional(),
      phone: z.string().max(32).optional(),
      creditLimit: z.coerce.number().min(0).default(0),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const result = await query<{ id: number }>(
      `INSERT INTO customers (name, document, phone, credit_limit)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        data.name.trim(),
        data.document?.trim() || null,
        data.phone?.trim() || null,
        data.creditLimit,
      ],
    );
    return { id: result.rows[0]!.id };
  });
