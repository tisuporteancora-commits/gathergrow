import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Screen } from "@/components/AppShell";
import * as s from "@/screens/contas";

export const Route = createFileRoute("/contas-a-pagar-receber")({
  head: () => ({
    meta: [
      { title: "Contas a Pagar & Receber | MarketFlow" },
      { name: "description", content: "Controle de contas a pagar e a receber do mercado." },
      { property: "og:title", content: "Contas a Pagar & Receber | MarketFlow" },
      { property: "og:description", content: "Controle de contas a pagar e a receber do mercado." },
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
