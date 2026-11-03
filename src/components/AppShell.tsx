import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

const LOGO =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBfIGecOXFNNlwHvmsXrG9vhVdKPvj_TOCFchUUlyVvWTDQRYo-khH8l92asZCXsd3y2t1GmSRyrIkAXHR1Afbp02HtTKNuJ6KaaDw1938RsKgFcwreyHAztR56x2O9WQvMifun0wn4arpeEwov4FawMk1LQkiQLjsXki9_bH__PSVH6iaCif0Rs4kWPQ6-d_Uq8G1M797w2O9v_dm3_n-lsSNOX5hI3oAelIxdx7s";

const NAV = [
  { to: "/", icon: "dashboard", label: "Dashboard" },
  { to: "/caixa-pdv", icon: "point_of_sale", label: "Caixa PDV" },
  { to: "/controle-de-estoque", icon: "inventory_2", label: "Controle de Estoque" },
  { to: "/financeiro", icon: "payments", label: "Financeiro" },
  { to: "/contas-a-pagar-receber", icon: "receipt_long", label: "Contas a Pagar & Receber" },
  { to: "/relatorios", icon: "bar_chart", label: "Relatórios" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <>
      <aside className="fixed left-0 top-0 h-full w-64 bg-surface-container-low z-50 flex flex-col pt-space-lg pb-space-lg">
        <div className="px-space-lg mb-space-lg flex items-center gap-space-sm">
          <img alt="MarketFlow" className="h-8 w-auto object-contain" src={LOGO} />
          <span className="text-headline-sm font-bold text-primary">MarketFlow</span>
        </div>
        <nav className="flex-1 px-space-md space-y-space-xs">
          {NAV.map((n) => {
            const active = path === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={
                  "flex items-center px-space-md py-space-sm rounded-xl transition-all " +
                  (active
                    ? "bg-primary-container text-on-primary-container font-semibold"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface")
                }
              >
                <span className="material-symbols-outlined mr-space-md">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <header className="fixed top-0 left-64 right-0 h-16 bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 flex items-center justify-between px-space-lg">
        <div className="flex items-center gap-space-md bg-surface-container px-space-md py-space-xs rounded-xl">
          <span className="material-symbols-outlined text-outline text-[18px]">storefront</span>
          <span className="text-body-md font-medium text-on-surface">Filial Centro - Matriz</span>
          <span className="material-symbols-outlined text-outline text-[18px]">expand_more</span>
        </div>
        <div className="flex items-center gap-space-md">
          <button className="p-space-xs rounded-full hover:bg-surface-container-high transition-colors relative">
            <span className="material-symbols-outlined text-on-surface-variant">notifications</span>
            <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full"></span>
          </button>
          <div className="flex items-center gap-space-sm pl-space-sm border-l border-outline-variant/30">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
            </div>
            <span className="text-body-md font-medium text-on-surface">Carlos Silva</span>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}

/** Renders a design screen and wires up its interactive behaviour. */
export function Screen({ html, script, fns }: { html: string; script: string; fns: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!script) return;
    const timers: number[] = [];
    const si = (fn: () => void, ms: number) => {
      const id = window.setInterval(fn, ms);
      timers.push(id);
      return id;
    };
    const w = window as unknown as Record<string, unknown>;
    try {
      const exported = new Function(
        "setInterval",
        `${script}\nreturn {${fns.join(",")}};`,
      )(si) as Record<string, unknown>;
      Object.assign(w, exported);
    } catch (e) {
      console.error(e);
    }
    return () => {
      timers.forEach(clearInterval);
      fns.forEach((f) => delete w[f]);
    };
  }, [script, fns]);
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
