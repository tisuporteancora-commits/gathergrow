import { createServerFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { isSetupComplete } from "./config";
import { query } from "./db";
import {
  clearSessionCookie,
  getSessionUser,
  setSessionCookie,
  signSession,
  type SessionUser,
} from "./session";

const DUMMY_HASH = "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWEq.qO.";

export type AuthUser = SessionUser;

export const getAppStatus = createServerFn({ method: "GET" }).handler(async () => {
  const setupComplete = isSetupComplete();
  if (!setupComplete) {
    return { setupComplete: false as const, user: null };
  }
  const user = await getSessionUser();
  return { setupComplete: true as const, user };
});

export const login = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    if (!isSetupComplete()) {
      throw new Error("Sistema ainda não configurado.");
    }

    const result = await query<{
      id: number;
      username: string;
      name: string;
      role: SessionUser["role"];
      password_hash: string;
    }>(
      `SELECT id, username, name, role, password_hash
       FROM users WHERE username = $1 LIMIT 1`,
      [data.username.trim().toLowerCase()],
    );

    const user = result.rows[0];
    const hashToCheck = user?.password_hash ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(data.password, hashToCheck);
    if (!user || !passwordMatches) {
      throw new Error("Usuário ou senha inválidos.");
    }

    const sessionUser: SessionUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    };
    const token = await signSession(sessionUser);
    setSessionCookie(token);
    return { ok: true as const, user: sessionUser };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  clearSessionCookie();
  return { ok: true as const };
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  return getSessionUser();
});
