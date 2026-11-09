import { SignJWT, jwtVerify } from "jose";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { requireConfig } from "./config";

const SESSION_COOKIE = "mf_session";
const ONE_DAY = 60 * 60 * 24;

export type SessionUser = {
  id: number;
  username: string;
  name: string;
  role: "super_admin" | "admin" | "supervisor" | "cashier";
};

function secretKey() {
  return new TextEncoder().encode(requireConfig().jwtSecret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const id = payload["id"];
    const username = payload["username"];
    const name = payload["name"];
    const role = payload["role"];
    if (
      typeof id !== "number" ||
      typeof username !== "string" ||
      typeof name !== "string" ||
      typeof role !== "string"
    ) {
      return null;
    }
    return {
      id,
      username,
      name,
      role: role as SessionUser["role"],
    };
  } catch {
    return null;
  }
}

export function readSessionToken(): string | null {
  const header = getRequestHeader("cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

function isSecureRequest(): boolean {
  const proto = getRequestHeader("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim() === "https";
  try {
    const host = getRequestHeader("host") ?? "";
    return !host.includes("localhost") && !host.startsWith("127.0.0.1");
  } catch {
    return false;
  }
}

export function setSessionCookie(token: string) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${ONE_DAY * 7}`,
  ];
  if (isSecureRequest()) parts.push("Secure");
  setResponseHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie() {
  const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (isSecureRequest()) parts.push("Secure");
  setResponseHeader("Set-Cookie", parts.join("; "));
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = readSessionToken();
  if (!token) return null;
  return verifySessionToken(token);
}
