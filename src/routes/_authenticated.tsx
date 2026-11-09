import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { requireAuth } from "@/lib/auth-guard";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const user = await requireAuth();
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
