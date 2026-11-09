export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function parseBRL(input: string): number {
  const normalized = input.replace(/\s/g, "").replace("R$", "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function formatQty(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}
