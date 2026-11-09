import { createServerFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "./db";
import { isSupervisorOrAbove } from "./permissions";
import { requireUser } from "./require-user";
import type { SessionUser } from "./session";

export async function verifySupervisorCredentials(
  username: string,
  password: string,
): Promise<SessionUser> {
  const result = await query<{
    id: number;
    username: string;
    name: string;
    role: SessionUser["role"];
    password_hash: string;
  }>(
    `SELECT id, username, name, role, password_hash
     FROM users WHERE username = $1 LIMIT 1`,
    [username.trim().toLowerCase()],
  );
  const user = result.rows[0];
  if (!user || !isSupervisorOrAbove(user)) {
    throw new Error("Autorização inválida: informe um supervisor/admin.");
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error("Senha de autorização incorreta.");
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  };
}

export const authorizeSensitiveAction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const auth = await verifySupervisorCredentials(data.username, data.password);
    return { ok: true as const, authorizer: auth };
  });
