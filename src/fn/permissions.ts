import type { SessionUser } from "./session";

export type Role = SessionUser["role"] | "supervisor";

export function isAdmin(user: SessionUser) {
  return user.role === "super_admin" || user.role === "admin";
}

export function isSupervisorOrAbove(user: SessionUser) {
  return isAdmin(user) || user.role === "supervisor";
}

export function canApplyItemDiscount(user: SessionUser) {
  return true; // todos os operadores
}

export function canApplySaleDiscount(user: SessionUser) {
  return isSupervisorOrAbove(user);
}

export function canCancelSale(user: SessionUser) {
  return isSupervisorOrAbove(user);
}

export function canDoCashMovement(user: SessionUser) {
  return isSupervisorOrAbove(user);
}

export function canCloseAnySession(user: SessionUser) {
  return isSupervisorOrAbove(user);
}

export function canManageFiado(user: SessionUser) {
  return isSupervisorOrAbove(user) || user.role === "cashier";
}

export function roleLabel(role: string) {
  const map: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Administrador",
    supervisor: "Supervisor",
    cashier: "Operador",
  };
  return map[role] ?? role;
}
