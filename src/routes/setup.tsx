import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { requireGuestSetup } from "@/lib/auth-guard";
import { completeSetup } from "@/fn/setup";

export const Route = createFileRoute("/setup")({
  beforeLoad: () => requireGuestSetup(),
  head: () => ({
    meta: [
      { title: "Configuração inicial | MarketFlow" },
      { name: "description", content: "Configure o banco Postgres e o super administrador." },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const completeSetupFn = useServerFn(completeSetup);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await completeSetupFn({
        data: {
          host: String(form.get("host") ?? ""),
          port: Number(form.get("port") ?? 5432),
          database: String(form.get("database") ?? ""),
          dbUser: String(form.get("dbUser") ?? ""),
          dbPassword: String(form.get("dbPassword") ?? ""),
          adminUsername: String(form.get("adminUsername") ?? ""),
          adminPassword: String(form.get("adminPassword") ?? ""),
          adminName: String(form.get("adminName") ?? "Super Admin"),
        },
      });
      await navigate({ to: "/login" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na configuração.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-space-lg">
      <div className="w-full max-w-2xl bg-surface-container-lowest shadow-sm rounded-xl overflow-hidden">
        <div className="px-space-lg py-space-md bg-surface-container-low border-b border-surface-container">
          <h1 className="text-headline-lg text-on-surface">Configuração inicial</h1>
          <p className="text-body-md text-on-surface-variant mt-space-xs">
            Informe o Postgres e crie o super administrador. Os dados do banco serão salvos no arquivo
            .env.
          </p>
        </div>
        <form onSubmit={onSubmit} className="p-space-lg flex flex-col gap-space-lg">
          <section className="flex flex-col gap-space-md">
            <h2 className="text-headline-sm text-primary">Banco PostgreSQL</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
              <Field label="IP / Host" name="host" placeholder="192.168.0.10" required />
              <Field label="Porta" name="port" type="number" defaultValue="5432" required />
              <Field label="Nome do banco" name="database" placeholder="marketflow" required />
              <Field label="Usuário do banco" name="dbUser" placeholder="postgres" required />
              <Field
                label="Senha do banco"
                name="dbPassword"
                type="password"
                required
                className="md:col-span-2"
              />
            </div>
          </section>

          <section className="flex flex-col gap-space-md">
            <h2 className="text-headline-sm text-primary">Super administrador</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
              <Field label="Nome" name="adminName" defaultValue="Super Admin" required />
              <Field label="Usuário" name="adminUsername" placeholder="admin" required />
              <Field
                label="Senha"
                name="adminPassword"
                type="password"
                required
                className="md:col-span-2"
              />
            </div>
          </section>

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
            {loading ? "Configurando..." : "Salvar e continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required,
  className = "",
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-space-xs ${className}`}>
      <span className="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider">
        {label}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="w-full bg-surface-container-low px-space-md py-space-sm rounded-xl text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}
