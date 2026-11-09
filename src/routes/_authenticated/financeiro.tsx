import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatBRL } from "@/lib/money";
import {
  confirmPendingEntry,
  createFinancialEntry,
  getFinanceDashboard,
  listBankAccounts,
  listFinancialEntries,
  upsertBankAccount,
  type BankAccountRow,
  type FinancialEntryRow,
} from "@/fn/finance";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro | MarketFlow" },
      {
        name: "description",
        content: "Saldos, resultado, inadimplência, evolução e previsão financeira.",
      },
    ],
  }),
  component: FinanceiroPage,
});

type Dash = Awaited<ReturnType<typeof getFinanceDashboard>>;

const ORIGINS = ["PDV", "Serviços", "Vendas", "Contas a receber", "Outros"];
const EXPENSE_CATS = [
  "Geral",
  "Fornecedores",
  "Folha",
  "Aluguel",
  "Utilities",
  "Impostos",
  "Marketing",
  "Contas a pagar",
];

function FinanceiroPage() {
  const dashFn = useServerFn(getFinanceDashboard);
  const listFn = useServerFn(listFinancialEntries);
  const createFn = useServerFn(createFinancialEntry);
  const confirmFn = useServerFn(confirmPendingEntry);
  const listBanksFn = useServerFn(listBankAccounts);
  const upsertBankFn = useServerFn(upsertBankAccount);

  const [dash, setDash] = useState<Dash | null>(null);
  const [entries, setEntries] = useState<FinancialEntryRow[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [bankModal, setBankModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [entryType, setEntryType] = useState<"income" | "expense">("income");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Geral");
  const [origin, setOrigin] = useState("Outros");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"confirmed" | "pending">("confirmed");
  const [bankAccountId, setBankAccountId] = useState("");

  const [bankForm, setBankForm] = useState({
    id: undefined as number | undefined,
    name: "",
    kind: "bank" as "cash" | "bank" | "digital",
    balance: "0",
    bankName: "",
  });

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [d, list, b] = await Promise.all([
        dashFn({ data: { periodDays: 30 } }),
        listFn({ data: { search: search || undefined } }),
        listBanksFn(),
      ]);
      setDash(d);
      setEntries(list);
      setBanks(b);
      if (!bankAccountId && b[0]) setBankAccountId(String(b[0].id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar financeiro.");
    }
  }, [bankAccountId, dashFn, listBanksFn, listFn, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const maxBal = useMemo(() => {
    const vals = dash?.balanceEvolution.map((d) => Math.abs(d.balance)) ?? [1];
    return Math.max(1, ...vals);
  }, [dash]);

  const maxCat = useMemo(() => {
    const vals = dash?.expensesByCategory.map((c) => c.amount) ?? [1];
    return Math.max(1, ...vals);
  }, [dash]);

  const maxOrigin = useMemo(() => {
    const vals = dash?.incomeByOrigin.map((c) => c.amount) ?? [1];
    return Math.max(1, ...vals);
  }, [dash]);

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createFn({
        data: {
          type: entryType,
          description,
          category: entryType === "income" ? origin : category,
          origin: entryType === "income" ? origin : undefined,
          amount: Number(amount.replace(",", ".")),
          status,
          bankAccountId: bankAccountId ? Number(bankAccountId) : null,
        },
      });
      setModalOpen(false);
      setDescription("");
      setAmount("");
      setOk(status === "pending" ? "Lançamento previsto registrado." : "Lançamento confirmado.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function saveBank(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await upsertBankFn({
        data: {
          id: bankForm.id,
          name: bankForm.name,
          kind: bankForm.kind,
          bankName: bankForm.bankName || null,
          balance: Number(bankForm.balance.replace(",", ".")),
        },
      });
      setBankModal(false);
      setOk("Conta salva.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar conta.");
    } finally {
      setSaving(false);
    }
  }

  function deltaClass(pct: number) {
    if (pct > 0) return "text-primary";
    if (pct < 0) return "text-error";
    return "text-on-surface-variant";
  }

  function deltaLabel(pct: number) {
    const sign = pct > 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}% vs mês anterior`;
  }

  return (
    <div className="pl-64">
      <main className="relative pt-16 bg-surface min-h-screen">
        <div className="p-space-lg flex flex-col gap-space-lg">
          <div className="flex items-center justify-between gap-space-md flex-wrap">
            <div>
              <h1 className="text-headline-lg">Financeiro</h1>
              <p className="text-body-md text-on-surface-variant">
                Liquidez, resultado, contas, inadimplência e previsão de saldo.
              </p>
            </div>
            <div className="flex flex-wrap gap-space-sm">
              <button
                type="button"
                className="px-space-md py-space-sm rounded-xl bg-surface-container-high font-semibold"
                onClick={() => {
                  setBankForm({ id: undefined, name: "", kind: "bank", balance: "0", bankName: "" });
                  setBankModal(true);
                }}
              >
                Nova conta
              </button>
              <button
                type="button"
                className="px-space-md py-space-sm rounded-xl bg-primary text-on-primary font-semibold"
                onClick={() => {
                  setEntryType("income");
                  setStatus("confirmed");
                  setOrigin("Outros");
                  setModalOpen(true);
                }}
              >
                Nova receita
              </button>
              <button
                type="button"
                className="px-space-md py-space-sm rounded-xl bg-error text-on-error font-semibold"
                onClick={() => {
                  setEntryType("expense");
                  setStatus("confirmed");
                  setCategory("Geral");
                  setModalOpen(true);
                }}
              >
                Nova despesa
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm">
              {error}
            </div>
          ) : null}
          {ok ? (
            <div className="rounded-xl bg-tertiary-container text-on-tertiary-container px-space-md py-space-sm">
              {ok}
            </div>
          ) : null}

          {/* Liquidez */}
          <section className="grid grid-cols-1 lg:grid-cols-4 gap-space-md">
            <Kpi
              label="Saldo total (bancos + caixas)"
              value={formatBRL(dash?.totalLiquidity ?? 0)}
              highlight
            />
            <Kpi label="Caixas abertos (esperado)" value={formatBRL(dash?.openCashExpected ?? 0)} />
            <Kpi label="Receitas do mês (recebidas)" value={formatBRL(dash?.current.income ?? 0)}>
              <span className={`text-label-sm ${deltaClass(dash?.comparison.incomeDeltaPct ?? 0)}`}>
                {deltaLabel(dash?.comparison.incomeDeltaPct ?? 0)}
              </span>
            </Kpi>
            <Kpi label="Despesas do mês (pagas)" value={formatBRL(dash?.current.expense ?? 0)}>
              <span className={`text-label-sm ${deltaClass(-(dash?.comparison.expenseDeltaPct ?? 0))}`}>
                {deltaLabel(dash?.comparison.expenseDeltaPct ?? 0)}
              </span>
            </Kpi>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
            <Kpi
              label="Resultado do período"
              value={formatBRL(dash?.current.result ?? 0)}
              tone={(dash?.current.result ?? 0) >= 0 ? "good" : "bad"}
            >
              <span className={`text-label-sm ${deltaClass(dash?.comparison.resultDeltaPct ?? 0)}`}>
                {deltaLabel(dash?.comparison.resultDeltaPct ?? 0)}
              </span>
            </Kpi>
            <Kpi
              label="Receitas previstas (aberto + pendente)"
              value={formatBRL(dash?.forecasted.income ?? 0)}
            />
            <Kpi
              label="Despesas previstas (aberto + pendente)"
              value={formatBRL(dash?.forecasted.expense ?? 0)}
            />
          </section>

          {/* Contas bancárias */}
          <section className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
            <div className="flex justify-between items-center mb-space-md">
              <h2 className="text-headline-sm">Contas bancárias e caixas</h2>
              <button
                type="button"
                className="text-label-sm text-primary"
                onClick={() => void reload()}
              >
                Atualizar
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
              {(dash?.bankAccounts ?? []).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="text-left rounded-xl bg-surface-container-low p-space-md hover:ring-2 hover:ring-primary/40"
                  onClick={() => {
                    setBankForm({
                      id: b.id,
                      name: b.name,
                      kind: b.kind,
                      balance: String(b.balance),
                      bankName: b.bankName ?? "",
                    });
                    setBankModal(true);
                  }}
                >
                  <p className="text-label-sm text-on-surface-variant uppercase">
                    {kindLabel(b.kind)}
                    {b.isDefault ? " · padrão" : ""}
                  </p>
                  <p className="text-body-md font-semibold mt-space-xs">{b.name}</p>
                  <p className="text-headline-sm mt-space-xs">{formatBRL(b.balance)}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Contas a pagar/receber + inadimplência */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
            <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
              <div className="flex justify-between items-center">
                <h2 className="text-headline-sm">Contas em aberto</h2>
                <Link to="/contas-a-pagar-receber" className="text-label-sm text-primary">
                  Ver todas
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-space-sm">
                <Mini label="A receber" value={formatBRL(dash?.accounts.openReceivable ?? 0)} />
                <Mini label="A pagar" value={formatBRL(dash?.accounts.openPayable ?? 0)} />
                <Mini
                  label="Receber vencido"
                  value={formatBRL(dash?.accounts.overdueReceivable ?? 0)}
                  bad
                />
                <Mini
                  label="Pagar vencido"
                  value={formatBRL(dash?.accounts.overduePayable ?? 0)}
                  bad
                />
                <Mini
                  label="A vencer (7 dias) receber"
                  value={formatBRL(dash?.accounts.dueSoonReceivable ?? 0)}
                />
                <Mini
                  label="A vencer (7 dias) pagar"
                  value={formatBRL(dash?.accounts.dueSoonPayable ?? 0)}
                />
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
              <h2 className="text-headline-sm">Inadimplência de clientes</h2>
              <div className="grid grid-cols-3 gap-space-sm">
                <Mini label="Vencido" value={formatBRL(dash?.delinquency.total ?? 0)} bad />
                <Mini label="Qtd títulos" value={String(dash?.delinquency.count ?? 0)} />
                <Mini label="Taxa s/ aberto" value={`${dash?.delinquency.rate ?? 0}%`} bad />
              </div>
              {(dash?.delinquency.top.length ?? 0) === 0 ? (
                <p className="text-body-sm text-on-surface-variant">Sem clientes inadimplentes.</p>
              ) : (
                <ul className="divide-y divide-surface-container-low">
                  {dash!.delinquency.top.map((c) => (
                    <li key={`${c.partyName}-${c.dueAt}`} className="py-space-xs flex justify-between gap-space-sm text-body-sm">
                      <span>
                        {c.partyName}
                        <span className="block text-label-sm text-outline">
                          {c.daysOverdue}d atraso
                        </span>
                      </span>
                      <span className="font-semibold text-error">{formatBRL(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Categorias e origens */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
            <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
              <h2 className="text-headline-sm mb-space-md">Despesas por categoria (mês)</h2>
              {(dash?.expensesByCategory.length ?? 0) === 0 ? (
                <p className="text-body-sm text-on-surface-variant">Sem despesas no mês.</p>
              ) : (
                <div className="flex flex-col gap-space-sm">
                  {dash!.expensesByCategory.map((c) => (
                    <BarRow
                      key={c.category}
                      label={c.category}
                      value={formatBRL(c.amount)}
                      pct={(c.amount / maxCat) * 100}
                      color="bg-error/70"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
              <h2 className="text-headline-sm mb-space-md">Receitas por origem (mês)</h2>
              {(dash?.incomeByOrigin.length ?? 0) === 0 ? (
                <p className="text-body-sm text-on-surface-variant">Sem receitas no mês.</p>
              ) : (
                <div className="flex flex-col gap-space-sm">
                  {dash!.incomeByOrigin.map((c) => (
                    <BarRow
                      key={c.origin}
                      label={c.origin}
                      value={formatBRL(c.amount)}
                      pct={(c.amount / maxOrigin) * 100}
                      color="bg-primary/70"
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Evolução + comparação + previsão */}
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-space-md">
            <div className="xl:col-span-2 bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
              <h2 className="text-headline-sm mb-space-md">Evolução do saldo (30 dias)</h2>
              {!dash || dash.balanceEvolution.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">Sem dados.</p>
              ) : (
                <div className="flex items-end gap-0.5 h-40 overflow-x-auto">
                  {dash.balanceEvolution.map((d) => (
                    <div
                      key={d.day}
                      className="min-w-[6px] flex-1 flex flex-col justify-end h-full"
                      title={`${d.day}: saldo ${formatBRL(d.balance)} | +${formatBRL(d.income)} / -${formatBRL(d.expense)}`}
                    >
                      <div
                        className={
                          "w-full rounded-t " + (d.balance >= 0 ? "bg-primary/70" : "bg-error/70")
                        }
                        style={{
                          height: `${Math.max(4, (Math.abs(d.balance) / maxBal) * 100)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
              <h2 className="text-headline-sm">Comparativo mensal</h2>
              <CompareRow
                label="Receitas"
                current={dash?.comparison.current.income ?? 0}
                previous={dash?.comparison.previous.income ?? 0}
                pct={dash?.comparison.incomeDeltaPct ?? 0}
              />
              <CompareRow
                label="Despesas"
                current={dash?.comparison.current.expense ?? 0}
                previous={dash?.comparison.previous.expense ?? 0}
                pct={dash?.comparison.expenseDeltaPct ?? 0}
              />
              <CompareRow
                label="Resultado"
                current={dash?.comparison.current.result ?? 0}
                previous={dash?.comparison.previous.result ?? 0}
                pct={dash?.comparison.resultDeltaPct ?? 0}
              />
            </div>
          </section>

          <section className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
            <h2 className="text-headline-sm mb-space-md">
              Previsão de saldo (liquidez + títulos a vencer)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <ForecastCard
                label="Em 7 dias"
                balance={dash?.forecast.days7 ?? 0}
                receive={dash?.forecast.in7.receive ?? 0}
                pay={dash?.forecast.in7.pay ?? 0}
              />
              <ForecastCard
                label="Em 15 dias"
                balance={dash?.forecast.days15 ?? 0}
                receive={dash?.forecast.in15.receive ?? 0}
                pay={dash?.forecast.in15.pay ?? 0}
              />
              <ForecastCard
                label="Em 30 dias"
                balance={dash?.forecast.days30 ?? 0}
                receive={dash?.forecast.in30.receive ?? 0}
                pay={dash?.forecast.in30.pay ?? 0}
              />
            </div>
          </section>

          {/* Lançamentos */}
          <div className="flex gap-space-md flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar lançamentos..."
              className="flex-1 min-w-[220px] bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm"
            />
            <button
              type="button"
              onClick={() => {
                setEntryType("income");
                setStatus("pending");
                setModalOpen(true);
              }}
              className="px-space-md py-space-sm rounded-xl bg-surface-container-high font-medium"
            >
              Receita prevista
            </button>
            <button
              type="button"
              onClick={() => {
                setEntryType("expense");
                setStatus("pending");
                setModalOpen(true);
              }}
              className="px-space-md py-space-sm rounded-xl bg-surface-container-high font-medium"
            >
              Despesa prevista
            </button>
            <button
              type="button"
              onClick={() => void reload()}
              className="px-space-md py-space-sm rounded-xl bg-surface-container-high"
            >
              Atualizar
            </button>
          </div>

          <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
            {entries.length === 0 ? (
              <p className="p-space-lg text-center text-on-surface-variant">
                Nenhum lançamento. Vendas do PDV e liquidações de contas aparecem aqui.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-surface-container-low text-label-sm uppercase text-on-surface-variant">
                  <tr>
                    <th className="px-space-md py-space-sm">Tipo</th>
                    <th className="px-space-md py-space-sm">Descrição</th>
                    <th className="px-space-md py-space-sm">Categoria/Origem</th>
                    <th className="px-space-md py-space-sm">Conta</th>
                    <th className="px-space-md py-space-sm">Status</th>
                    <th className="px-space-md py-space-sm">Data</th>
                    <th className="px-space-md py-space-sm text-right">Valor</th>
                    <th className="px-space-md py-space-sm" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-space-md py-space-sm">
                        <span
                          className={
                            e.type === "income"
                              ? "text-primary font-semibold"
                              : "text-error font-semibold"
                          }
                        >
                          {e.type === "income" ? "Receita" : "Despesa"}
                        </span>
                      </td>
                      <td className="px-space-md py-space-sm">{e.description}</td>
                      <td className="px-space-md py-space-sm text-body-sm">
                        {e.origin || e.category}
                      </td>
                      <td className="px-space-md py-space-sm text-body-sm">
                        {e.bank_account_name || "—"}
                      </td>
                      <td className="px-space-md py-space-sm text-body-sm">
                        {e.status === "pending" ? "Previsto" : "Confirmado"}
                      </td>
                      <td className="px-space-md py-space-sm text-body-sm">
                        {new Date(e.occurred_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-space-md py-space-sm text-right text-numeric-data">
                        {formatBRL(Number(e.amount))}
                      </td>
                      <td className="px-space-md py-space-sm text-right">
                        {e.status === "pending" ? (
                          <button
                            type="button"
                            className="text-label-sm text-primary"
                            onClick={() => {
                              void confirmFn({ data: { id: e.id } })
                                .then(() => {
                                  setOk("Lançamento confirmado e saldo atualizado.");
                                  return reload();
                                })
                                .catch((err: unknown) =>
                                  setError(err instanceof Error ? err.message : "Falha."),
                                );
                            }}
                          >
                            Confirmar
                          </button>
                        ) : null}
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
              onSubmit={saveEntry}
              className="bg-surface-container-lowest w-full max-w-md rounded-xl shadow-xl overflow-hidden"
            >
              <div className="px-space-lg py-space-md bg-surface-container-low flex justify-between items-center">
                <h3 className="text-headline-md">
                  {entryType === "income" ? "Receita" : "Despesa"}
                  {status === "pending" ? " prevista" : ""}
                </h3>
                <button type="button" onClick={() => setModalOpen(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-space-lg flex flex-col gap-space-md">
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Descrição</span>
                  <input
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  />
                </label>
                {entryType === "income" ? (
                  <label className="flex flex-col gap-space-xs">
                    <span className="text-label-sm uppercase text-on-surface-variant">Origem</span>
                    <select
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                    >
                      {ORIGINS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="flex flex-col gap-space-xs">
                    <span className="text-label-sm uppercase text-on-surface-variant">Categoria</span>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                    >
                      {EXPENSE_CATS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Conta</span>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Valor</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  />
                </label>
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as "confirmed" | "pending")}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    <option value="confirmed">Confirmado (já recebido/pago)</option>
                    <option value="pending">Previsto</option>
                  </select>
                </label>
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

        {bankModal ? (
          <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-50 flex items-center justify-center p-space-md">
            <form
              onSubmit={saveBank}
              className="bg-surface-container-lowest w-full max-w-md rounded-xl shadow-xl overflow-hidden"
            >
              <div className="px-space-lg py-space-md bg-surface-container-low flex justify-between items-center">
                <h3 className="text-headline-md">
                  {bankForm.id ? "Editar conta" : "Nova conta bancária/caixa"}
                </h3>
                <button type="button" onClick={() => setBankModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-space-lg flex flex-col gap-space-md">
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Nome</span>
                  <input
                    required
                    value={bankForm.name}
                    onChange={(e) => setBankForm((f) => ({ ...f, name: e.target.value }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  />
                </label>
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Tipo</span>
                  <select
                    value={bankForm.kind}
                    onChange={(e) =>
                      setBankForm((f) => ({
                        ...f,
                        kind: e.target.value as "cash" | "bank" | "digital",
                      }))
                    }
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    <option value="cash">Caixa</option>
                    <option value="bank">Banco</option>
                    <option value="digital">Digital / carteira</option>
                  </select>
                </label>
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Banco</span>
                  <input
                    value={bankForm.bankName}
                    onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  />
                </label>
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm uppercase text-on-surface-variant">Saldo</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={bankForm.balance}
                    onChange={(e) => setBankForm((f) => ({ ...f, balance: e.target.value }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  />
                </label>
              </div>
              <div className="px-space-lg py-space-md bg-surface-container-low flex justify-end gap-space-sm">
                <button type="button" onClick={() => setBankModal(false)}>
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

function kindLabel(kind: string) {
  if (kind === "cash") return "Caixa";
  if (kind === "digital") return "Digital";
  return "Banco";
}

function Kpi({
  label,
  value,
  children,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  children?: ReactNode;
  highlight?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <div
      className={
        "rounded-xl shadow-sm p-space-md " +
        (highlight ? "bg-primary-container text-on-primary-container" : "bg-surface-container-lowest")
      }
    >
      <p
        className={
          "text-label-sm uppercase tracking-wider " +
          (highlight ? "opacity-80" : "text-on-surface-variant")
        }
      >
        {label}
      </p>
      <p
        className={
          "text-headline-lg mt-space-xs " +
          (tone === "good" ? "text-primary" : tone === "bad" ? "text-error" : "")
        }
      >
        {value}
      </p>
      {children}
    </div>
  );
}

function Mini({
  label,
  value,
  bad,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low p-space-sm">
      <p className="text-label-sm text-on-surface-variant">{label}</p>
      <p className={"text-body-md font-semibold mt-0.5 " + (bad ? "text-error" : "")}>{value}</p>
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-body-sm mb-1">
        <span>{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-container-low overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function CompareRow({
  label,
  current,
  previous,
  pct,
}: {
  label: string;
  current: number;
  previous: number;
  pct: number;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low p-space-sm">
      <p className="text-label-sm text-on-surface-variant uppercase">{label}</p>
      <p className="text-body-md font-semibold">{formatBRL(current)}</p>
      <p className="text-label-sm text-on-surface-variant">
        Anterior: {formatBRL(previous)} ·{" "}
        <span className={pct >= 0 ? "text-primary" : "text-error"}>
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%
        </span>
      </p>
    </div>
  );
}

function ForecastCard({
  label,
  balance,
  receive,
  pay,
}: {
  label: string;
  balance: number;
  receive: number;
  pay: number;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low p-space-md">
      <p className="text-label-sm uppercase text-on-surface-variant">{label}</p>
      <p className={"text-headline-md mt-space-xs " + (balance >= 0 ? "text-primary" : "text-error")}>
        {formatBRL(balance)}
      </p>
      <p className="text-label-sm text-on-surface-variant mt-space-xs">
        +{formatBRL(receive)} a receber · −{formatBRL(pay)} a pagar
      </p>
    </div>
  );
}
