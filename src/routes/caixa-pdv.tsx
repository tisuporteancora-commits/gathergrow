import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Screen } from "@/components/AppShell";
import * as s from "@/screens/caixa";

export const Route = createFileRoute("/caixa-pdv")({
  head: () => ({
    meta: [
      { title: "Caixa PDV | MarketFlow" },
      { name: "description", content: "Frente de caixa rápida para registrar vendas e pagamentos." },
      { property: "og:title", content: "Caixa PDV | MarketFlow" },
      { property: "og:description", content: "Frente de caixa rápida para registrar vendas e pagamentos." },
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
