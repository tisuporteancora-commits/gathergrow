import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Screen } from "@/components/AppShell";
import * as s from "@/screens/relatorios";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios | MarketFlow" },
      { name: "description", content: "Relatórios e análises de desempenho do mercado." },
      { property: "og:title", content: "Relatórios | MarketFlow" },
      { property: "og:description", content: "Relatórios e análises de desempenho do mercado." },
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
