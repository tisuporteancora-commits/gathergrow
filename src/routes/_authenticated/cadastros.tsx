import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatBRL } from "@/lib/money";
import {
  listCustomers,
  upsertCustomer,
  type CustomerRow,
} from "@/fn/customers";
import {
  listSuppliers,
  upsertSupplier,
  type SupplierRow,
} from "@/fn/suppliers";

export const Route = createFileRoute("/_authenticated/cadastros")({
  head: () => ({
    meta: [
      { title: "Cadastros | MarketFlow" },
      { name: "description", content: "Cadastro de clientes e fornecedores." },
    ],
  }),
  component: CadastrosPage,
});

type Tab = "clientes" | "fornecedores";

type CustomerForm = {
  id?: number;
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  creditLimit: string;
  active: boolean;
};

type SupplierForm = {
  id?: number;
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  active: boolean;
};

const emptyCustomer = (): CustomerForm => ({
  name: "",
  document: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  creditLimit: "0",
  active: true,
});

const emptySupplier = (): SupplierForm => ({
  name: "",
  document: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  active: true,
});

function CadastrosPage() {
  const listCustomersFn = useServerFn(listCustomers);
  const upsertCustomerFn = useServerFn(upsertCustomer);
  const listSuppliersFn = useServerFn(listSuppliers);
  const upsertSupplierFn = useServerFn(upsertSupplier);

  const [tab, setTab] = useState<Tab>("clientes");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [customerModal, setCustomerModal] = useState(false);
  const [supplierModal, setSupplierModal] = useState(false);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(emptyCustomer());
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(emptySupplier());

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "clientes") {
        setCustomers(
          await listCustomersFn({
            data: { search: search || undefined, activeOnly: false },
          }),
        );
      } else {
        setSuppliers(
          await listSuppliersFn({
            data: { search: search || undefined, activeOnly: false },
          }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar cadastros.");
    } finally {
      setLoading(false);
    }
  }, [listCustomersFn, listSuppliersFn, search, tab]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function flash(msg: string) {
    setOk(msg);
    setError(null);
    setTimeout(() => setOk(null), 3000);
  }

  async function saveCustomer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertCustomerFn({
        data: {
          id: customerForm.id,
          name: customerForm.name,
          document: customerForm.document || null,
          phone: customerForm.phone || null,
          email: customerForm.email || null,
          address: customerForm.address || null,
          notes: customerForm.notes || null,
          creditLimit: Number(customerForm.creditLimit || 0),
          active: customerForm.active,
        },
      });
      setCustomerModal(false);
      flash(customerForm.id ? "Cliente atualizado." : "Cliente cadastrado.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertSupplierFn({
        data: {
          id: supplierForm.id,
          name: supplierForm.name,
          document: supplierForm.document || null,
          phone: supplierForm.phone || null,
          email: supplierForm.email || null,
          address: supplierForm.address || null,
          notes: supplierForm.notes || null,
          active: supplierForm.active,
        },
      });
      setSupplierModal(false);
      flash(supplierForm.id ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar fornecedor.");
    } finally {
      setSaving(false);
    }
  }

  function openCustomer(c?: CustomerRow) {
    if (c) {
      setCustomerForm({
        id: c.id,
        name: c.name,
        document: c.document ?? "",
        phone: c.phone ?? "",
        email: c.email ?? "",
        address: c.address ?? "",
        notes: c.notes ?? "",
        creditLimit: String(Number(c.credit_limit)),
        active: c.active,
      });
    } else {
      setCustomerForm(emptyCustomer());
    }
    setCustomerModal(true);
  }

  function openSupplier(s?: SupplierRow) {
    if (s) {
      setSupplierForm({
        id: s.id,
        name: s.name,
        document: s.document ?? "",
        phone: s.phone ?? "",
        email: s.email ?? "",
        address: s.address ?? "",
        notes: s.notes ?? "",
        active: s.active,
      });
    } else {
      setSupplierForm(emptySupplier());
    }
    setSupplierModal(true);
  }

  return (
    <div className="pl-64">
      <main className="relative pt-16 bg-surface min-h-screen">
        <div className="p-space-lg flex flex-col gap-space-lg">
          <div className="flex items-center justify-between gap-space-md flex-wrap">
            <div>
              <h1 className="text-headline-lg text-on-surface">Cadastros</h1>
              <p className="text-body-md text-on-surface-variant">
                Gerencie clientes e fornecedores usados no PDV, estoque e contas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => (tab === "clientes" ? openCustomer() : openSupplier())}
              className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold text-label-md"
            >
              {tab === "clientes" ? "Novo cliente" : "Novo fornecedor"}
            </button>
          </div>

          <div className="flex flex-wrap gap-space-xs">
            {(
              [
                { id: "clientes" as const, label: "Clientes" },
                { id: "fornecedores" as const, label: "Fornecedores" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setSearch("");
                }}
                className={
                  "px-space-md py-space-sm rounded-xl text-label-md font-medium " +
                  (tab === t.id
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-low text-on-surface-variant")
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-space-md items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === "clientes"
                  ? "Buscar por nome, documento ou telefone..."
                  : "Buscar por nome, documento ou telefone..."
              }
              className="flex-1 min-w-[240px] bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => void reload()}
              className="px-space-md py-space-sm rounded-xl bg-surface-container-high text-label-md font-medium"
            >
              Atualizar
            </button>
          </div>

          {error ? (
            <div className="rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm">
              {error}
            </div>
          ) : null}
          {ok ? (
            <div className="rounded-xl bg-tertiary-container text-on-tertiary-container px-space-md py-space-sm">
              {ok}
            </div>
          ) : null}

          <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              {tab === "clientes" ? (
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="px-space-md py-space-sm">Nome</th>
                      <th className="px-space-md py-space-sm">Documento</th>
                      <th className="px-space-md py-space-sm">Telefone</th>
                      <th className="px-space-md py-space-sm">E-mail</th>
                      <th className="px-space-md py-space-sm text-right">Limite fiado</th>
                      <th className="px-space-md py-space-sm text-right">Em aberto</th>
                      <th className="px-space-md py-space-sm">Status</th>
                      <th className="px-space-md py-space-sm text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="px-space-md py-space-lg text-center text-on-surface-variant">
                          Carregando...
                        </td>
                      </tr>
                    ) : customers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-space-md py-space-lg text-center text-on-surface-variant">
                          Nenhum cliente cadastrado.
                        </td>
                      </tr>
                    ) : (
                      customers.map((c) => (
                        <tr key={c.id} className="hover:bg-surface-container-low/50">
                          <td className="px-space-md py-space-sm font-semibold">{c.name}</td>
                          <td className="px-space-md py-space-sm text-body-sm">{c.document || "—"}</td>
                          <td className="px-space-md py-space-sm text-body-sm">{c.phone || "—"}</td>
                          <td className="px-space-md py-space-sm text-body-sm">{c.email || "—"}</td>
                          <td className="px-space-md py-space-sm text-right text-numeric-data">
                            {formatBRL(Number(c.credit_limit))}
                          </td>
                          <td className="px-space-md py-space-sm text-right text-numeric-data">
                            {formatBRL(Number(c.open_balance))}
                          </td>
                          <td className="px-space-md py-space-sm text-body-sm">
                            {c.active ? "Ativo" : "Inativo"}
                          </td>
                          <td className="px-space-md py-space-sm text-right">
                            <button
                              type="button"
                              onClick={() => openCustomer(c)}
                              className="px-space-sm py-1 rounded-lg bg-surface-container-high text-label-sm"
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="px-space-md py-space-sm">Nome</th>
                      <th className="px-space-md py-space-sm">Documento</th>
                      <th className="px-space-md py-space-sm">Telefone</th>
                      <th className="px-space-md py-space-sm">E-mail</th>
                      <th className="px-space-md py-space-sm">Endereço</th>
                      <th className="px-space-md py-space-sm">Status</th>
                      <th className="px-space-md py-space-sm text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-space-md py-space-lg text-center text-on-surface-variant">
                          Carregando...
                        </td>
                      </tr>
                    ) : suppliers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-space-md py-space-lg text-center text-on-surface-variant">
                          Nenhum fornecedor cadastrado.
                        </td>
                      </tr>
                    ) : (
                      suppliers.map((s) => (
                        <tr key={s.id} className="hover:bg-surface-container-low/50">
                          <td className="px-space-md py-space-sm font-semibold">{s.name}</td>
                          <td className="px-space-md py-space-sm text-body-sm">{s.document || "—"}</td>
                          <td className="px-space-md py-space-sm text-body-sm">{s.phone || "—"}</td>
                          <td className="px-space-md py-space-sm text-body-sm">{s.email || "—"}</td>
                          <td className="px-space-md py-space-sm text-body-sm max-w-[220px] truncate">
                            {s.address || "—"}
                          </td>
                          <td className="px-space-md py-space-sm text-body-sm">
                            {s.active ? "Ativo" : "Inativo"}
                          </td>
                          <td className="px-space-md py-space-sm text-right">
                            <button
                              type="button"
                              onClick={() => openSupplier(s)}
                              className="px-space-sm py-1 rounded-lg bg-surface-container-high text-label-sm"
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {customerModal ? (
          <Modal title={customerForm.id ? "Editar cliente" : "Novo cliente"} onClose={() => setCustomerModal(false)}>
            <form onSubmit={saveCustomer} className="p-space-lg grid grid-cols-1 md:grid-cols-2 gap-space-md">
              <Field
                label="Nome"
                value={customerForm.name}
                onChange={(v) => setCustomerForm((f) => ({ ...f, name: v }))}
                required
                className="md:col-span-2"
              />
              <Field
                label="CPF / CNPJ"
                value={customerForm.document}
                onChange={(v) => setCustomerForm((f) => ({ ...f, document: v }))}
              />
              <Field
                label="Telefone"
                value={customerForm.phone}
                onChange={(v) => setCustomerForm((f) => ({ ...f, phone: v }))}
              />
              <Field
                label="E-mail"
                type="email"
                value={customerForm.email}
                onChange={(v) => setCustomerForm((f) => ({ ...f, email: v }))}
              />
              <Field
                label="Limite de fiado"
                type="number"
                step="0.01"
                value={customerForm.creditLimit}
                onChange={(v) => setCustomerForm((f) => ({ ...f, creditLimit: v }))}
              />
              <Field
                label="Endereço"
                value={customerForm.address}
                onChange={(v) => setCustomerForm((f) => ({ ...f, address: v }))}
                className="md:col-span-2"
              />
              <Field
                label="Observações"
                value={customerForm.notes}
                onChange={(v) => setCustomerForm((f) => ({ ...f, notes: v }))}
                className="md:col-span-2"
              />
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                  Status
                </span>
                <select
                  value={customerForm.active ? "1" : "0"}
                  onChange={(e) =>
                    setCustomerForm((f) => ({ ...f, active: e.target.value === "1" }))
                  }
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                >
                  <option value="1">Ativo</option>
                  <option value="0">Inativo</option>
                </select>
              </label>
              <div className="md:col-span-2 flex justify-end gap-space-sm pt-space-sm">
                <button type="button" onClick={() => setCustomerModal(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-space-xl py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </Modal>
        ) : null}

        {supplierModal ? (
          <Modal
            title={supplierForm.id ? "Editar fornecedor" : "Novo fornecedor"}
            onClose={() => setSupplierModal(false)}
          >
            <form onSubmit={saveSupplier} className="p-space-lg grid grid-cols-1 md:grid-cols-2 gap-space-md">
              <Field
                label="Nome"
                value={supplierForm.name}
                onChange={(v) => setSupplierForm((f) => ({ ...f, name: v }))}
                required
                className="md:col-span-2"
              />
              <Field
                label="CNPJ / CPF"
                value={supplierForm.document}
                onChange={(v) => setSupplierForm((f) => ({ ...f, document: v }))}
              />
              <Field
                label="Telefone"
                value={supplierForm.phone}
                onChange={(v) => setSupplierForm((f) => ({ ...f, phone: v }))}
              />
              <Field
                label="E-mail"
                type="email"
                value={supplierForm.email}
                onChange={(v) => setSupplierForm((f) => ({ ...f, email: v }))}
                className="md:col-span-2"
              />
              <Field
                label="Endereço"
                value={supplierForm.address}
                onChange={(v) => setSupplierForm((f) => ({ ...f, address: v }))}
                className="md:col-span-2"
              />
              <Field
                label="Observações"
                value={supplierForm.notes}
                onChange={(v) => setSupplierForm((f) => ({ ...f, notes: v }))}
                className="md:col-span-2"
              />
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                  Status
                </span>
                <select
                  value={supplierForm.active ? "1" : "0"}
                  onChange={(e) =>
                    setSupplierForm((f) => ({ ...f, active: e.target.value === "1" }))
                  }
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                >
                  <option value="1">Ativo</option>
                  <option value="0">Inativo</option>
                </select>
              </label>
              <div className="md:col-span-2 flex justify-end gap-space-sm pt-space-sm">
                <button type="button" onClick={() => setSupplierModal(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-space-xl py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </Modal>
        ) : null}
      </main>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-50 flex items-center justify-center p-space-md">
      <div className="bg-surface-container-lowest w-full max-w-2xl rounded-xl shadow-xl overflow-hidden">
        <div className="px-space-lg py-space-md bg-surface-container-low flex items-center justify-between">
          <h3 className="text-headline-md">{title}</h3>
          <button type="button" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  step,
  required,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-space-xs ${className}`}>
      <span className="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider">
        {label}
      </span>
      <input
        type={type}
        step={step}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-container-low px-space-md py-space-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}
