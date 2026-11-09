import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { requireGuestLogin } from "@/lib/auth-guard";
import { login } from "@/fn/auth";

const LOGO =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBfIGecOXFNNlwHvmsXrG9vhVdKPvj_TOCFchUUlyVvWTDQRYo-khH8l92asZCXsd3y2t1GmSRyrIkAXHR1Afbp02HtTKNuJ6KaaDw1938RsKgFcwreyHAztR56x2O9WQvMifun0wn4arpeEwov4FawMk1LQkiQLjsXki9_bH__PSVH6iaCif0Rs4kWPQ6-d_Uq8G1M797w2O9v_dm3_n-lsSNOX5hI3oAelIxdx7s";

export const Route = createFileRoute("/login")({
  beforeLoad: () => requireGuestLogin(),
  head: () => ({
    meta: [
      { title: "Entrar | MarketFlow" },
      { name: "description", content: "Acesse o MarketFlow com seu usuário." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const loginFn = useServerFn(login);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await loginFn({
        data: {
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        },
      });
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-space-lg">
      <div className="w-full max-w-md bg-surface-container-lowest shadow-sm rounded-xl overflow-hidden">
        <div className="px-space-lg py-space-lg bg-surface-container-low flex flex-col items-center gap-space-sm">
          <img alt="MarketFlow" className="h-10 w-auto object-contain" src={LOGO} />
          <h1 className="text-headline-lg text-on-surface">Entrar</h1>
          <p className="text-body-md text-on-surface-variant text-center">
            Use o super admin criado no primeiro acesso.
          </p>
        </div>
        <form onSubmit={onSubmit} className="p-space-lg flex flex-col gap-space-md">
          <label className="flex flex-col gap-space-xs">
            <span className="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider">
              Usuário
            </span>
            <input
              name="username"
              required
              autoComplete="username"
              className="w-full bg-surface-container-low px-space-md py-space-sm rounded-xl text-body-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="flex flex-col gap-space-xs">
            <span className="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider">
              Senha
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full bg-surface-container-low px-space-md py-space-sm rounded-xl text-body-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>

          {error ? (
            <div className="rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm text-body-md">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-space-sm bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-label-md disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
