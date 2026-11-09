import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { formatBRL, formatQty } from "@/lib/money";
import { getDashboardData } from "@/fn/dashboard";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard | MarketFlow" },
      { name: "description", content: "Visão geral de vendas, caixa e estoque do seu mercado." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const getDashboardDataFn = useServerFn(getDashboardData);
  const [data, setData] = useState<Awaited<ReturnType<typeof getDashboardData>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getDashboardDataFn()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar dashboard."));
  }, [getDashboardDataFn]);

  const maxWeek = Math.max(1, ...(data?.week.map((d) => d.total) ?? [1]));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="pl-64">
      <main className="relative pt-16 bg-surface min-h-screen">
        <div className="p-space-lg flex flex-col gap-space-lg">
          <div className="flex items-end justify-between gap-space-md flex-wrap">
            <div>
              <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                Visão geral · Filial Centro
              </p>
              <h1 className="text-headline-lg text-on-surface mt-space-xs">
                {greeting}, {data?.userName?.split(" ")[0] ?? "..."}.
              </h1>
            </div>
            <p className="text-body-md text-on-surface-variant">
              {new Date().toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </p>
          </div>

          {error ? (
            <div className="rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
            <Kpi label="Vendas hoje" value={formatBRL(data?.salesToday ?? 0)} />
            <Kpi label="Lucro estimado" value={formatBRL(data?.profitToday ?? 0)} />
            <Kpi label="Vendas (qtd)" value={String(data?.customersToday ?? 0)} />
            <Kpi label="Estoque em alerta" value={String(data?.lowStock ?? 0)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
            <Link
              to="/caixa-pdv"
              className="bg-primary text-on-primary rounded-xl p-space-lg flex items-center gap-space-md hover:bg-primary-container transition-colors"
            >
              <span className="material-symbols-outlined text-[32px]">point_of_sale</span>
              <div>
                <p className="text-headline-sm">Abrir Caixa PDV</p>
                <p className="text-body-sm opacity-90">Registrar vendas com baixa de estoque</p>
              </div>
            </Link>
            <Link
              to="/controle-de-estoque"
              className="bg-surface-container-lowest rounded-xl p-space-lg flex items-center gap-space-md shadow-sm hover:bg-surface-container-low transition-colors"
            >
              <span className="material-symbols-outlined text-primary text-[32px]">inventory_2</span>
              <div>
                <p className="text-headline-sm text-on-surface">Ver Estoque</p>
                <p className="text-body-sm text-on-surface-variant">Produtos e níveis atuais</p>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md">
            <section className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
              <h2 className="text-headline-sm mb-space-md">Vendas (últimos 7 dias)</h2>
              {!data || data.week.every((d) => d.total === 0) ? (
                <Empty text="Nenhuma venda no período." />
              ) : (
                <div className="flex items-end gap-space-sm h-40">
                  {data.week.map((d) => (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-space-xs h-full justify-end">
                      <div
                        className="w-full bg-primary/80 rounded-t-md min-h-[4px]"
                        style={{ height: `${Math.max(4, (d.total / maxWeek) * 100)}%` }}
                        title={formatBRL(d.total)}
                      />
                      <span className="text-label-sm text-on-surface-variant">
                        {new Date(d.day + "T12:00:00").toLocaleDateString("pt-BR", {
                          weekday: "short",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">
              <h2 className="text-headline-sm mb-space-md">Mais vendidos hoje</h2>
              {!data || data.topProducts.length === 0 ? (
                <Empty text="Sem vendas hoje." />
              ) : (
                <ul className="divide-y divide-surface-container-low">
                  {data.topProducts.map((p) => (
                    <li key={p.name} className="py-space-sm flex justify-between gap-space-md">
                      <div>
                        <p className="text-body-md font-semibold">{p.name}</p>
                        <p className="text-body-sm text-on-surface-variant">
                          {p.category ?? "Sem categoria"} · {formatQty(p.qty)}
                        </p>
                      </div>
                      <p className="text-numeric-data text-primary">{formatBRL(p.revenue)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
            <div className="px-space-lg py-space-md border-b border-surface-container-low">
              <h2 className="text-headline-sm">Últimas transações</h2>
            </div>
            {!data || data.recentSales.length === 0 ? (
              <div className="p-space-lg">
                <Empty text="Nenhuma venda registrada ainda." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low text-label-sm uppercase text-on-surface-variant">
                    <tr>
                      <th className="px-space-md py-space-sm">Código</th>
                      <th className="px-space-md py-space-sm">Horário</th>
                      <th className="px-space-md py-space-sm">Operador</th>
                      <th className="px-space-md py-space-sm">Pagamento</th>
                      <th className="px-space-md py-space-sm text-right">Valor</th>
                      <th className="px-space-md py-space-sm">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {data.recentSales.map((s) => (
                      <tr key={s.code}>
                        <td className="px-space-md py-space-sm text-body-sm">{s.code}</td>
                        <td className="px-space-md py-space-sm text-body-sm">
                          {new Date(s.createdAt).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-space-md py-space-sm text-body-sm">{s.operator}</td>
                        <td className="px-space-md py-space-sm text-body-sm">
                          {paymentLabel(s.method)}
                        </td>
                        <td className="px-space-md py-space-sm text-right text-numeric-data">
                          {formatBRL(s.total)}
                        </td>
                        <td className="px-space-md py-space-sm text-body-sm capitalize">{s.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md">
      <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className="text-headline-lg text-on-surface mt-space-xs">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-body-md text-on-surface-variant py-space-md text-center">{text}</p>;
}

function paymentLabel(method: string | null) {
  if (!method) return "—";
  const map: Record<string, string> = {
    cash: "Dinheiro",
    pix: "PIX",
    credit: "Crédito",
    debit: "Débito",
  };
  return map[method] ?? method;
}
