import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Screen } from "@/components/AppShell";
import * as s from "@/screens/estoque";

export const Route = createFileRoute("/controle-de-estoque")({
  head: () => ({
    meta: [
      { title: "Controle de Estoque | MarketFlow" },
      { name: "description", content: "Gerencie produtos, níveis de estoque e reposição." },
      { property: "og:title", content: "Controle de Estoque | MarketFlow" },
      { property: "og:description", content: "Gerencie produtos, níveis de estoque e reposição." },
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
