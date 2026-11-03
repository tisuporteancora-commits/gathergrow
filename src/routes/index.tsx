import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Screen } from "@/components/AppShell";
import * as s from "@/screens/dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard | MarketFlow" },
      { name: "description", content: "Visão geral de vendas, caixa e estoque do seu mercado." },
      { property: "og:title", content: "Dashboard | MarketFlow" },
      { property: "og:description", content: "Visão geral de vendas, caixa e estoque do seu mercado." },
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
