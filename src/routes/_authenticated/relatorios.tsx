import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { formatBRL, formatQty } from "@/lib/money";
import { getReportsData } from "@/fn/reports";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios | MarketFlow" },
      { name: "description", content: "Relatórios e análises de desempenho do mercado." },
    ],
  }),
  component: RelatoriosPage,
});

function RelatoriosPage() {
  const getReportsFn = useServerFn(getReportsData);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Awaited<ReturnType<typeof getReportsData>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void getReportsFn({ data: { days } })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar relatórios."))
      .finally(() => setLoading(false));
  }, [days, getReportsFn]);

  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.total) ?? [1]));

  return (
    <div className="pl-64">
      <main className="relative pt-16 bg-surface min-h-screen">
        <div className="p-space-lg flex flex-col gap-space-lg">
          <div className="flex items-center justify-between gap-space-md flex-wrap">
            <div>
              <h1 className="text-headline-lg">Relatórios</h1>
              <p className="text-body-md text-on-surface-variant">
                Desempenho com base nas vendas reais do período.
              </p>
            </div>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm"
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
            </select>
          </div>

          {error ? (
            <div className="rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
            <Kpi label="Faturamento" value={formatBRL(data?.revenue ?? 0)} />
            <Kpi
              label="Lucratividade"
              value={`${(data?.profitability ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
            />
            <Kpi label="Ticket médio" value={formatBRL(data?.ticket ?? 0)} />
            <Kpi label="Total de vendas" value={String(data?.salesCount ?? 0)} />
          </div>

          <section className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
            <h2 className="text-headline-sm mb-space-md">Vendas no período</h2>
            {loading ? (
              <p className="text-center text-on-surface-variant">Carregando...</p>
            ) : !data || data.daily.every((d) => d.total === 0) ? (
              <p className="text-center text-on-surface-variant py-space-md">
                Sem vendas no período selecionado.
              </p>
            ) : (
              <div className="flex items-end gap-space-sm h-44">
                {data.daily.map((d) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-space-xs h-full justify-end">
                    <div
                      className="w-full bg-primary rounded-t-md min-h-[4px]"
                      style={{ height: `${Math.max(4, (d.total / maxDaily) * 100)}%` }}
                      title={formatBRL(d.total)}
                    />
                    <span className="text-label-sm text-on-surface-variant">
                      {new Date(d.day + "T12:00:00").toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md">
            <section className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
              <h2 className="text-headline-sm mb-space-md">Caixa por operador</h2>
              {!data || data.byOperator.length === 0 ? (
                <p className="text-center text-on-surface-variant py-space-md">Sem dados.</p>
              ) : (
                <ul className="divide-y divide-surface-container-low">
                  {data.byOperator.map((op) => (
                    <li key={op.name} className="py-space-sm flex justify-between gap-space-md">
                      <div>
                        <p className="font-semibold">{op.name}</p>
                        <p className="text-body-sm text-on-surface-variant">
                          {op.salesCount} venda(s)
                        </p>
                      </div>
                      <p className="text-numeric-data text-primary">{formatBRL(op.total)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
              <div className="px-space-lg py-space-md">
                <h2 className="text-headline-sm">Curva ABC</h2>
              </div>
              {!data || data.abc.length === 0 ? (
                <p className="px-space-lg pb-space-lg text-center text-on-surface-variant">
                  Sem produtos vendidos no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container-low text-label-sm uppercase text-on-surface-variant">
                      <tr>
                        <th className="px-space-md py-space-sm">Classe</th>
                        <th className="px-space-md py-space-sm">Produto</th>
                        <th className="px-space-md py-space-sm text-right">Qtd</th>
                        <th className="px-space-md py-space-sm text-right">Receita</th>
                        <th className="px-space-md py-space-sm text-right">Margem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container-low">
                      {data.abc.map((p) => (
                        <tr key={p.name}>
                          <td className="px-space-md py-space-sm font-semibold">{p.abcClass}</td>
                          <td className="px-space-md py-space-sm">
                            <p className="font-medium">{p.name}</p>
                            <p className="text-body-sm text-on-surface-variant">
                              {p.category ?? "—"}
                            </p>
                          </td>
                          <td className="px-space-md py-space-sm text-right">{formatQty(p.qty)}</td>
                          <td className="px-space-md py-space-sm text-right text-numeric-data">
                            {formatBRL(p.revenue)}
                          </td>
                          <td className="px-space-md py-space-sm text-right">
                            {p.margin.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
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
