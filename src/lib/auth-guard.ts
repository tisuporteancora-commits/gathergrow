import { redirect } from "@tanstack/react-router";
import { getAppStatus } from "@/fn/auth";
import type { SessionUser } from "@/fn/session";

export async function requireAuth(): Promise<SessionUser> {
  const status = await getAppStatus();
  if (!status.setupComplete) {
    throw redirect({ to: "/setup" });
  }
  if (!status.user) {
    throw redirect({ to: "/login" });
  }
  return status.user;
}

export async function requireGuestSetup() {
  const status = await getAppStatus();
  if (status.setupComplete) {
    throw redirect({ to: status.user ? "/" : "/login" });
  }
}

export async function requireGuestLogin() {
  const status = await getAppStatus();
  if (!status.setupComplete) {
    throw redirect({ to: "/setup" });
  }
  if (status.user) {
    throw redirect({ to: "/" });
  }
}
