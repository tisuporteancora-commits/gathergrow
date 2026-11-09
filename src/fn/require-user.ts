import { getSessionUser, type SessionUser } from "./session";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  return user;
}
