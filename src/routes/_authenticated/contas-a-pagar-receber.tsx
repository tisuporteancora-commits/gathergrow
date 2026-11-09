import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { formatBRL } from "@/lib/money";
import {
  createAccount,
  getAccountsSummary,
  listAccounts,
  settleAccount,
  type AccountRow,
} from "@/fn/accounts";

export const Route = createFileRoute("/_authenticated/contas-a-pagar-receber")({
  head: () => ({
    meta: [
      { title: "Contas a Pagar & Receber | MarketFlow" },
      { name: "description", content: "Controle de contas a pagar e a receber do mercado." },
    ],
  }),
  component: ContasPage,
});

function ContasPage() {
  const listFn = useServerFn(listAccounts);
  const summaryFn = useServerFn(getAccountsSummary);
  const createFn = useServerFn(createAccount);
  const settleFn = useServerFn(settleAccount);

  const [tab, setTab] = useState<"receivable" | "payable">("receivable");
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getAccountsSummary>> | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    direction: "receivable" as "payable" | "receivable",
    partyName: "",
    accountKind: "fiado" as "fiado" | "crediario" | "card" | "boleto" | "utility" | "other",
    documentCode: "",
    description: "",
    amount: "",
    dueAt: new Date().toISOString().slice(0, 10),
  });

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [list, sum] = await Promise.all([
        listFn({
          data: {
            direction: tab,
            search: search || undefined,
          },
        }),
        summaryFn(),
      ]);
      setRows(list);
      setSummary(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar contas.");
    }
  }, [listFn, search, summaryFn, tab]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createFn({
        data: {
          direction: form.direction,
          partyName: form.partyName,
          accountKind: form.accountKind,
          documentCode: form.documentCode || undefined,
          description: form.description || undefined,
          amount: Number(form.amount.replace(",", ".")),
          dueAt: form.dueAt,
        },
      });
      setModalOpen(false);
      setForm((f) => ({ ...f, partyName: "", documentCode: "", description: "", amount: "" }));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar conta.");
    } finally {
      setSaving(false);
    }
  }

  async function onSettle(id: number) {
    if (!window.confirm("Confirmar liquidação desta conta?")) return;
    try {
      await settleFn({ data: { id } });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao liquidar conta.");
    }
  }

  return (
    <div className="pl-64">
      <main className="relative pt-16 bg-surface min-h-screen">
        <div className="p-space-lg flex flex-col gap-space-lg">
          <div className="flex items-center justify-between gap-space-md flex-wrap">
            <div>
              <h1 className="text-headline-lg">Contas a Pagar & Receber</h1>
              <p className="text-body-md text-on-surface-variant">
                Fiados, boletos e demais obrigações.
              </p>
            </div>
            <button
              type="button"
              className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
              onClick={() => {
                setForm((f) => ({ ...f, direction: tab }));
                setModalOpen(true);
              }}
            >
              Adicionar conta
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
            <Kpi label="A receber hoje" value={formatBRL(summary?.receiveToday ?? 0)} />
            <Kpi label="A pagar vencidos" value={formatBRL(summary?.payOverdue ?? 0)} />
            <Kpi label="Saldo previsto no mês" value={formatBRL(summary?.monthBalance ?? 0)} />
          </div>

          <div className="flex gap-space-sm">
            <TabBtn active={tab === "receivable"} onClick={() => setTab("receivable")}>
              A receber
            </TabBtn>
            <TabBtn active={tab === "payable"} onClick={() => setTab("payable")}>
              A pagar
            </TabBtn>
          </div>

          <div className="flex gap-space-md">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, fornecedor ou documento..."
              className="flex-1 bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm"
            />
            <button
              type="button"
              onClick={() => void reload()}
              className="px-space-md py-space-sm rounded-xl bg-surface-container-high"
            >
              Atualizar
            </button>
          </div>

          {error ? (
            <div className="rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm">
              {error}
            </div>
          ) : null}

          <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
            {rows.length === 0 ? (
              <p className="p-space-lg text-center text-on-surface-variant">
                Nenhuma conta {tab === "receivable" ? "a receber" : "a pagar"}.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-surface-container-low text-label-sm uppercase text-on-surface-variant">
                  <tr>
                    <th className="px-space-md py-space-sm">
                      {tab === "receivable" ? "Cliente" : "Fornecedor"}
                    </th>
                    <th className="px-space-md py-space-sm">Tipo</th>
                    <th className="px-space-md py-space-sm">Documento</th>
                    <th className="px-space-md py-space-sm">Vencimento</th>
                    <th className="px-space-md py-space-sm text-right">Valor</th>
                    <th className="px-space-md py-space-sm">Status</th>
                    <th className="px-space-md py-space-sm text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-space-md py-space-sm font-medium">{r.party_name}</td>
                      <td className="px-space-md py-space-sm text-body-sm">{kindLabel(r.account_kind)}</td>
                      <td className="px-space-md py-space-sm text-body-sm">
                        {r.document_code || "—"}
                      </td>
                      <td className="px-space-md py-space-sm text-body-sm">
                        {new Date(r.due_at + "T12:00:00").toLocaleDateString("pt-BR")}
                      </td>
                      <td className="px-space-md py-space-sm text-right text-numeric-data">
                        {formatBRL(Number(r.amount))}
                      </td>
                      <td className="px-space-md py-space-sm">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-space-md py-space-sm text-right">
                        {r.status === "paid" ? (
                          <span className="text-body-sm text-on-surface-variant">Liquidada</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onSettle(r.id)}
                            className="px-space-sm py-1 rounded-lg bg-primary/10 text-primary text-label-sm font-semibold"
                          >
                            {tab === "receivable" ? "Receber" : "Pagar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        {modalOpen ? (
          <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-50 flex items-center justify-center p-space-md">
            <form
              onSubmit={onCreate}
              className="bg-surface-container-lowest w-full max-w-lg rounded-xl shadow-xl overflow-hidden"
            >
              <div className="px-space-lg py-space-md bg-surface-container-low flex justify-between items-center">
                <h3 className="text-headline-md">Nova conta</h3>
                <button type="button" onClick={() => setModalOpen(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-space-lg grid grid-cols-1 md:grid-cols-2 gap-space-md">
                <label className="flex flex-col gap-space-xs md:col-span-2">
                  <span className="text-label-sm uppercase text-on-surface-variant">Tipo</span>
                  <div className="grid grid-cols-2 gap-space-sm">
                    <button
                      type="button"
                      className={
                        "py-space-sm rounded-xl border " +
                        (form.direction === "receivable"
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-surface-container-high")
                      }
                      onClick={() => setForm((f) => ({ ...f, direction: "receivable" }))}
                    >
                      A receber
                    </button>
                    <button
                      type="button"
                      className={
                        "py-space-sm rounded-xl border " +
                        (form.direction === "payable"
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-surface-container-high")
                      }
                      onClick={() => setForm((f) => ({ ...f, direction: "payable" }))}
                    >
                      A pagar
                    </button>
                  </div>
                </label>
                <Field
                  label={form.direction === "receivable" ? "Cliente" : "Fornecedor"}
                  value={form.partyName}
                  onChange={(v) => setForm((f) => ({ ...f, partyName: v }))}
                  required
                  className="md:col-span-2"
                />
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Espécie</span>
                  <select
                    value={form.accountKind}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        accountKind: e.target.value as typeof form.accountKind,
                      }))
                    }
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    <option value="fiado">Fiado</option>
                    <option value="crediario">Crediário</option>
                    <option value="card">Cartão</option>
                    <option value="boleto">Boleto</option>
                    <option value="utility">Conta / utilidade</option>
                    <option value="other">Outro</option>
                  </select>
                </label>
                <Field
                  label="Documento"
                  value={form.documentCode}
                  onChange={(v) => setForm((f) => ({ ...f, documentCode: v }))}
                />
                <Field
                  label="Valor"
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                  required
                />
                <Field
                  label="Vencimento"
                  type="date"
                  value={form.dueAt}
                  onChange={(v) => setForm((f) => ({ ...f, dueAt: v }))}
                  required
                />
                <Field
                  label="Observações"
                  value={form.description}
                  onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                  className="md:col-span-2"
                />
              </div>
              <div className="px-space-lg py-space-md bg-surface-container-low flex justify-end gap-space-sm">
                <button type="button" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md">
      <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className="text-headline-lg mt-space-xs">{value}</p>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-space-lg py-space-sm rounded-xl font-semibold " +
        (active ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant")
      }
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "bg-surface-container-high text-on-surface",
    overdue: "bg-error-container text-on-error-container",
    paid: "bg-primary/15 text-primary",
  };
  const labels: Record<string, string> = {
    open: "Em aberto",
    overdue: "Vencida",
    paid: "Paga",
  };
  return (
    <span className={"px-space-sm py-0.5 rounded-lg text-label-sm font-medium " + (styles[status] ?? "")}>
      {labels[status] ?? status}
    </span>
  );
}

function kindLabel(kind: string) {
  const map: Record<string, string> = {
    fiado: "Fiado",
    crediario: "Crediário",
    card: "Cartão",
    boleto: "Boleto",
    utility: "Utilidade",
    other: "Outro",
  };
  return map[kind] ?? kind;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  step,
  required,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-space-xs ${className}`}>
      <span className="text-label-sm uppercase text-on-surface-variant">{label}</span>
      <input
        type={type}
        step={step}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
      />
    </label>
  );
}
