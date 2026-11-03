import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Screen } from "@/components/AppShell";
import * as s from "@/screens/financeiro";

export const Route = createFileRoute("/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro | MarketFlow" },
      { name: "description", content: "Acompanhe o fluxo de caixa, entradas e saídas." },
      { property: "og:title", content: "Financeiro | MarketFlow" },
      { property: "og:description", content: "Acompanhe o fluxo de caixa, entradas e saídas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppShell>
      <Screen html={s.html} script={s.script} fns={s.fns} />
    </AppShell>
  );
}
