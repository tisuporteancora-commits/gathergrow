import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatBRL, formatQty } from "@/lib/money";
import {
  listCategories,
  listProducts,
  upsertProduct,
  type ProductRow,
} from "@/fn/products";
import {
  stockEntry,
  stockExit,
  listStockMovements,
  reverseMovement,
  listStockAlerts,
  createInventoryCount,
  listInventoryCounts,
  getInventoryCount,
  saveInventoryCounts,
  approveInventoryCount,
  type StockMovementRow,
  type StockAlertRow,
} from "@/fn/stock";
import {
  listSuppliers,
  upsertSupplier,
  listPurchaseOrders,
  createPurchaseOrder,
  getPurchaseOrder,
  receivePurchaseOrder,
  type SupplierRow,
  type PurchaseOrderRow,
} from "@/fn/suppliers";
import {
  listWarehouses,
  upsertWarehouse,
  listWarehouseBalances,
  createTransfer,
  listTransfers,
  getTransfer,
  receiveTransfer,
  type WarehouseRow,
} from "@/fn/warehouses";

export const Route = createFileRoute("/_authenticated/controle-de-estoque")({
  head: () => ({
    meta: [
      { title: "Controle de Estoque | MarketFlow" },
      { name: "description", content: "Produtos, movimentações, inventário e depósitos." },
    ],
  }),
  component: EstoquePage,
});

type Tab =
  | "produtos"
  | "entrada"
  | "saida"
  | "historico"
  | "alertas"
  | "inventario"
  | "compras"
  | "depositos";

const TABS: { id: Tab; label: string }[] = [
  { id: "produtos", label: "Produtos" },
  { id: "entrada", label: "Entradas" },
  { id: "saida", label: "Saídas" },
  { id: "historico", label: "Histórico" },
  { id: "alertas", label: "Alertas" },
  { id: "inventario", label: "Inventário" },
  { id: "compras", label: "Compras" },
  { id: "depositos", label: "Depósitos" },
];

const UNITS = ["un", "cx", "kg", "g", "l", "ml", "pct", "dz"];

const ENTRY_TYPES = [
  { value: "entry_manual", label: "Entrada manual / NF" },
  { value: "entry_purchase", label: "Compra avulsa" },
  { value: "entry_return_customer", label: "Devolução de cliente" },
] as const;

const EXIT_TYPES = [
  { value: "exit_loss", label: "Perda" },
  { value: "exit_damage", label: "Avaria" },
  { value: "exit_internal", label: "Consumo interno" },
  { value: "exit_expiry", label: "Vencimento" },
  { value: "exit_return_supplier", label: "Devolução ao fornecedor" },
] as const;

const MOV_LABEL: Record<string, string> = {
  entry_manual: "Entrada manual",
  entry_purchase: "Entrada compra",
  entry_return_customer: "Dev. cliente",
  entry_transfer: "Entrada transferência",
  entry_inventory: "Entrada inventário",
  exit_sale: "Venda PDV",
  exit_loss: "Perda",
  exit_damage: "Avaria",
  exit_internal: "Consumo interno",
  exit_expiry: "Vencimento",
  exit_return_supplier: "Dev. fornecedor",
  exit_transfer: "Saída transferência",
  exit_inventory: "Saída inventário",
  exit_adjust: "Ajuste / estorno",
};

type Category = { id: number; name: string; parent_id?: number | null };

type ProductForm = {
  id?: number;
  barcode: string;
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  subcategory: string;
  brand: string;
  supplierId: string;
  unit: string;
  costPrice: string;
  sellPrice: string;
  stockQty: string;
  minStock: string;
  maxStock: string;
  expiresAt: string;
  imageUrl: string;
  active: boolean;
};

const emptyProduct = (): ProductForm => ({
  barcode: "",
  sku: "",
  name: "",
  description: "",
  categoryId: "",
  subcategory: "",
  brand: "",
  supplierId: "",
  unit: "un",
  costPrice: "0",
  sellPrice: "0",
  stockQty: "0",
  minStock: "0",
  maxStock: "0",
  expiresAt: "",
  imageUrl: "",
  active: true,
});

function EstoquePage() {
  const listProductsFn = useServerFn(listProducts);
  const listCategoriesFn = useServerFn(listCategories);
  const upsertProductFn = useServerFn(upsertProduct);
  const stockEntryFn = useServerFn(stockEntry);
  const stockExitFn = useServerFn(stockExit);
  const listMovementsFn = useServerFn(listStockMovements);
  const reverseMovementFn = useServerFn(reverseMovement);
  const listAlertsFn = useServerFn(listStockAlerts);
  const listSuppliersFn = useServerFn(listSuppliers);
  const upsertSupplierFn = useServerFn(upsertSupplier);
  const listWarehousesFn = useServerFn(listWarehouses);
  const upsertWarehouseFn = useServerFn(upsertWarehouse);
  const listBalancesFn = useServerFn(listWarehouseBalances);
  const listOrdersFn = useServerFn(listPurchaseOrders);
  const createOrderFn = useServerFn(createPurchaseOrder);
  const getOrderFn = useServerFn(getPurchaseOrder);
  const receiveOrderFn = useServerFn(receivePurchaseOrder);
  const createInvFn = useServerFn(createInventoryCount);
  const listInvFn = useServerFn(listInventoryCounts);
  const getInvFn = useServerFn(getInventoryCount);
  const saveInvFn = useServerFn(saveInventoryCounts);
  const approveInvFn = useServerFn(approveInventoryCount);
  const createTransferFn = useServerFn(createTransfer);
  const listTransfersFn = useServerFn(listTransfers);
  const getTransferFn = useServerFn(getTransfer);
  const receiveTransferFn = useServerFn(receiveTransfer);

  const [tab, setTab] = useState<Tab>("produtos");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [productModal, setProductModal] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyProduct());
  const [saving, setSaving] = useState(false);

  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [movFilters, setMovFilters] = useState({
    productId: "",
    movementType: "",
    from: "",
    to: "",
  });

  const [alerts, setAlerts] = useState<StockAlertRow[]>([]);

  const [entryForm, setEntryForm] = useState({
    productId: "",
    warehouseId: "",
    movementType: "entry_manual",
    qty: "",
    unitCost: "",
    supplierId: "",
    documentNumber: "",
    reason: "",
    occurredAt: "",
  });

  const [exitForm, setExitForm] = useState({
    productId: "",
    warehouseId: "",
    movementType: "exit_loss",
    qty: "",
    reason: "",
    documentNumber: "",
    supplierId: "",
  });

  const [supplierForm, setSupplierForm] = useState({
    id: undefined as number | undefined,
    name: "",
    document: "",
    phone: "",
    email: "",
  });
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [orderDraft, setOrderDraft] = useState({
    supplierId: "",
    warehouseId: "",
    productId: "",
    qty: "",
    unitCost: "",
    items: [] as { productId: number; name: string; qtyOrdered: number; unitCost: number }[],
  });
  const [receiveOrderId, setReceiveOrderId] = useState<number | null>(null);
  const [receiveItems, setReceiveItems] = useState<
    { itemId: number; name: string; pending: number; qtyReceived: string }[]
  >([]);

  const [inventories, setInventories] = useState<
    Awaited<ReturnType<typeof listInventoryCounts>>
  >([]);
  const [activeInv, setActiveInv] = useState<Awaited<ReturnType<typeof getInventoryCount>> | null>(
    null,
  );
  const [invWarehouse, setInvWarehouse] = useState("");
  const [invCategory, setInvCategory] = useState("");

  const [balances, setBalances] = useState<
    Awaited<ReturnType<typeof listWarehouseBalances>>
  >([]);
  const [transfers, setTransfers] = useState<Awaited<ReturnType<typeof listTransfers>>>([]);
  const [whForm, setWhForm] = useState({ code: "", name: "", kind: "deposit" as const });
  const [transferForm, setTransferForm] = useState({
    fromWarehouseId: "",
    toWarehouseId: "",
    productId: "",
    qty: "",
  });
  const [receiveTransferId, setReceiveTransferId] = useState<number | null>(null);
  const [transferReceiveItems, setTransferReceiveItems] = useState<
    { itemId: number; name: string; qtySent: number; qtyReceived: string }[]
  >([]);

  const flash = (msg: string) => {
    setOk(msg);
    setError(null);
    setTimeout(() => setOk(null), 3500);
  };

  const reloadBase = useCallback(async () => {
    const [prods, cats, sups, whs] = await Promise.all([
      listProductsFn({
        data: {
          search: search || undefined,
          categoryId: categoryFilter ? Number(categoryFilter) : undefined,
          activeOnly: false,
        },
      }),
      listCategoriesFn(),
      listSuppliersFn({}),
      listWarehousesFn(),
    ]);
    setProducts(prods);
    setCategories(cats);
    setSuppliers(sups);
    setWarehouses(whs);
    if (!entryForm.warehouseId && whs[0]) {
      setEntryForm((f) => ({ ...f, warehouseId: String(whs[0]!.id) }));
      setExitForm((f) => ({ ...f, warehouseId: String(whs[0]!.id) }));
      setInvWarehouse(String(whs[0]!.id));
      setOrderDraft((o) => ({ ...o, warehouseId: String(whs[0]!.id) }));
    }
  }, [
    categoryFilter,
    entryForm.warehouseId,
    listCategoriesFn,
    listProductsFn,
    listSuppliersFn,
    listWarehousesFn,
    search,
  ]);

  const reloadTab = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await reloadBase();
      if (tab === "historico") {
        setMovements(
          await listMovementsFn({
            data: {
              productId: movFilters.productId ? Number(movFilters.productId) : undefined,
              movementType: movFilters.movementType || undefined,
              from: movFilters.from || undefined,
              to: movFilters.to || undefined,
            },
          }),
        );
      }
      if (tab === "alertas") setAlerts(await listAlertsFn());
      if (tab === "compras") setOrders(await listOrdersFn({}));
      if (tab === "inventario") setInventories(await listInvFn());
      if (tab === "depositos") {
        setBalances(await listBalancesFn({}));
        setTransfers(await listTransfersFn());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [
    listAlertsFn,
    listBalancesFn,
    listInvFn,
    listMovementsFn,
    listOrdersFn,
    listTransfersFn,
    movFilters,
    reloadBase,
    tab,
  ]);

  useEffect(() => {
    void reloadTab();
  }, [reloadTab]);

  const stats = useMemo(() => {
    const active = products.filter((p) => p.active);
    const stockValue = active.reduce(
      (sum, p) => sum + Number(p.stock_qty) * Number(p.cost_price),
      0,
    );
    const low = active.filter((p) => Number(p.stock_qty) <= Number(p.min_stock)).length;
    const zero = active.filter((p) => Number(p.stock_qty) <= 0).length;
    return { total: active.length, stockValue, low, zero };
  }, [products]);

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertProductFn({
        data: {
          id: form.id,
          barcode: form.barcode,
          sku: form.sku || null,
          name: form.name,
          description: form.description || null,
          categoryId: form.categoryId ? Number(form.categoryId) : null,
          subcategory: form.subcategory || null,
          brand: form.brand || null,
          supplierId: form.supplierId ? Number(form.supplierId) : null,
          unit: form.unit,
          costPrice: Number(form.costPrice),
          sellPrice: Number(form.sellPrice),
          stockQty: form.id ? undefined : Number(form.stockQty),
          minStock: Number(form.minStock),
          maxStock: Number(form.maxStock),
          expiresAt: form.expiresAt || null,
          imageUrl: form.imageUrl || null,
          active: form.active,
        },
      });
      setProductModal(false);
      flash(form.id ? "Produto atualizado." : "Produto cadastrado.");
      await reloadTab();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(p: ProductRow) {
    setForm({
      id: p.id,
      barcode: p.barcode,
      sku: p.sku ?? "",
      name: p.name,
      description: p.description ?? "",
      categoryId: p.category_id ? String(p.category_id) : "",
      subcategory: p.subcategory ?? "",
      brand: p.brand ?? "",
      supplierId: p.supplier_id ? String(p.supplier_id) : "",
      unit: p.unit || "un",
      costPrice: String(Number(p.cost_price)),
      sellPrice: String(Number(p.sell_price)),
      stockQty: String(Number(p.stock_qty)),
      minStock: String(Number(p.min_stock)),
      maxStock: String(Number(p.max_stock)),
      expiresAt: p.expires_at ? p.expires_at.slice(0, 10) : "",
      imageUrl: p.image_url ?? "",
      active: p.active,
    });
    setProductModal(true);
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await stockEntryFn({
        data: {
          productId: Number(entryForm.productId),
          warehouseId: entryForm.warehouseId ? Number(entryForm.warehouseId) : undefined,
          movementType: entryForm.movementType as "entry_manual",
          qty: Number(entryForm.qty),
          unitCost: entryForm.unitCost ? Number(entryForm.unitCost) : undefined,
          supplierId: entryForm.supplierId ? Number(entryForm.supplierId) : null,
          documentNumber: entryForm.documentNumber || null,
          reason: entryForm.reason || undefined,
          occurredAt: entryForm.occurredAt || null,
          updateCost: Boolean(entryForm.unitCost),
        },
      });
      flash("Entrada registrada.");
      setEntryForm((f) => ({ ...f, qty: "", documentNumber: "", reason: "" }));
      await reloadTab();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na entrada.");
    } finally {
      setSaving(false);
    }
  }

  async function submitExit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await stockExitFn({
        data: {
          productId: Number(exitForm.productId),
          warehouseId: exitForm.warehouseId ? Number(exitForm.warehouseId) : undefined,
          movementType: exitForm.movementType as "exit_loss",
          qty: Number(exitForm.qty),
          reason: exitForm.reason,
          documentNumber: exitForm.documentNumber || null,
          supplierId: exitForm.supplierId ? Number(exitForm.supplierId) : null,
        },
      });
      flash("Saída registrada.");
      setExitForm((f) => ({ ...f, qty: "", reason: "" }));
      await reloadTab();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na saída.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pl-64">
      <main className="relative pt-16 bg-surface min-h-screen">
        <div className="p-space-lg flex flex-col gap-space-lg">
          <div className="flex items-center justify-between gap-space-md flex-wrap">
            <div>
              <h1 className="text-headline-lg text-on-surface">Controle de Estoque</h1>
              <p className="text-body-md text-on-surface-variant">
                Cadastro, entradas, saídas, alertas, inventário, compras e depósitos.
              </p>
            </div>
            {tab === "produtos" ? (
              <button
                type="button"
                onClick={() => {
                  setForm(emptyProduct());
                  setProductModal(true);
                }}
                className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold text-label-md"
              >
                Novo produto
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
            <Stat label="Produtos ativos" value={String(stats.total)} />
            <Stat label="Valor em estoque" value={formatBRL(stats.stockValue)} />
            <Stat label="Abaixo do mínimo" value={String(stats.low)} />
            <Stat label="Sem saldo" value={String(stats.zero)} />
          </div>

          <div className="flex flex-wrap gap-space-xs border-b border-surface-container-high pb-space-sm">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
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

          {tab === "produtos" ? (
            <ProductsPanel
              products={products}
              categories={categories}
              search={search}
              setSearch={setSearch}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              loading={loading}
              onReload={() => void reloadTab()}
              onEdit={openEdit}
            />
          ) : null}

          {tab === "entrada" ? (
            <form
              onSubmit={submitEntry}
              className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg grid grid-cols-1 md:grid-cols-2 gap-space-md max-w-3xl"
            >
              <ProductSelect
                products={products}
                value={entryForm.productId}
                onChange={(v) => setEntryForm((f) => ({ ...f, productId: v }))}
              />
              <WarehouseSelect
                warehouses={warehouses}
                value={entryForm.warehouseId}
                onChange={(v) => setEntryForm((f) => ({ ...f, warehouseId: v }))}
              />
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                  Tipo
                </span>
                <select
                  value={entryForm.movementType}
                  onChange={(e) => setEntryForm((f) => ({ ...f, movementType: e.target.value }))}
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                >
                  {ENTRY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <FormField
                label="Quantidade"
                type="number"
                step="0.001"
                value={entryForm.qty}
                onChange={(v) => setEntryForm((f) => ({ ...f, qty: v }))}
                required
              />
              <FormField
                label="Custo unitário"
                type="number"
                step="0.01"
                value={entryForm.unitCost}
                onChange={(v) => setEntryForm((f) => ({ ...f, unitCost: v }))}
              />
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                  Fornecedor
                </span>
                <select
                  value={entryForm.supplierId}
                  onChange={(e) => setEntryForm((f) => ({ ...f, supplierId: e.target.value }))}
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                >
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <FormField
                label="Nº documento / NF"
                value={entryForm.documentNumber}
                onChange={(v) => setEntryForm((f) => ({ ...f, documentNumber: v }))}
              />
              <FormField
                label="Data entrada"
                type="datetime-local"
                value={entryForm.occurredAt}
                onChange={(v) => setEntryForm((f) => ({ ...f, occurredAt: v }))}
              />
              <FormField
                label="Motivo / observação"
                value={entryForm.reason}
                onChange={(v) => setEntryForm((f) => ({ ...f, reason: v }))}
                className="md:col-span-2"
              />
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-space-xl py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Registrar entrada"}
                </button>
              </div>
            </form>
          ) : null}

          {tab === "saida" ? (
            <form
              onSubmit={submitExit}
              className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg grid grid-cols-1 md:grid-cols-2 gap-space-md max-w-3xl"
            >
              <ProductSelect
                products={products}
                value={exitForm.productId}
                onChange={(v) => setExitForm((f) => ({ ...f, productId: v }))}
              />
              <WarehouseSelect
                warehouses={warehouses}
                value={exitForm.warehouseId}
                onChange={(v) => setExitForm((f) => ({ ...f, warehouseId: v }))}
              />
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                  Motivo da saída
                </span>
                <select
                  value={exitForm.movementType}
                  onChange={(e) => setExitForm((f) => ({ ...f, movementType: e.target.value }))}
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                >
                  {EXIT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <FormField
                label="Quantidade"
                type="number"
                step="0.001"
                value={exitForm.qty}
                onChange={(v) => setExitForm((f) => ({ ...f, qty: v }))}
                required
              />
              <FormField
                label="Justificativa"
                value={exitForm.reason}
                onChange={(v) => setExitForm((f) => ({ ...f, reason: v }))}
                required
                className="md:col-span-2"
              />
              {exitForm.movementType === "exit_return_supplier" ? (
                <label className="flex flex-col gap-space-xs md:col-span-2">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                    Fornecedor
                  </span>
                  <select
                    value={exitForm.supplierId}
                    onChange={(e) => setExitForm((f) => ({ ...f, supplierId: e.target.value }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    <option value="">—</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="md:col-span-2">
                <p className="text-body-sm text-on-surface-variant mb-space-sm">
                  Vendas no PDV já baixam o estoque automaticamente. Saldo negativo é bloqueado.
                </p>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-space-xl py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Registrar saída"}
                </button>
              </div>
            </form>
          ) : null}

          {tab === "historico" ? (
            <div className="flex flex-col gap-space-md">
              <div className="flex flex-wrap gap-space-sm items-end">
                <ProductSelect
                  products={products}
                  value={movFilters.productId}
                  onChange={(v) => setMovFilters((f) => ({ ...f, productId: v }))}
                  optional
                />
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                    Tipo
                  </span>
                  <select
                    value={movFilters.movementType}
                    onChange={(e) => setMovFilters((f) => ({ ...f, movementType: e.target.value }))}
                    className="bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm"
                  >
                    <option value="">Todos</option>
                    {Object.entries(MOV_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <FormField
                  label="De"
                  type="date"
                  value={movFilters.from}
                  onChange={(v) => setMovFilters((f) => ({ ...f, from: v }))}
                />
                <FormField
                  label="Até"
                  type="date"
                  value={movFilters.to}
                  onChange={(v) => setMovFilters((f) => ({ ...f, to: v }))}
                />
                <button
                  type="button"
                  onClick={() => void reloadTab()}
                  className="px-space-md py-space-sm rounded-xl bg-surface-container-high"
                >
                  Filtrar
                </button>
              </div>
              <DataTable
                loading={loading}
                empty="Nenhuma movimentação."
                headers={[
                  "Data",
                  "Produto",
                  "Tipo",
                  "Qtd",
                  "Antes",
                  "Depois",
                  "Doc",
                  "Usuário",
                  "Motivo",
                  "",
                ]}
                rows={movements.map((m) => [
                  new Date(m.occurred_at).toLocaleString("pt-BR"),
                  m.product_name,
                  MOV_LABEL[m.movement_type] ?? m.movement_type,
                  `${m.direction === "in" ? "+" : "-"}${formatQty(Number(m.qty))}`,
                  formatQty(Number(m.balance_before)),
                  formatQty(Number(m.balance_after)),
                  m.document_number ||
                    (m.source_type && m.source_id ? `${m.source_type}#${m.source_id}` : "—"),
                  m.user_name ?? "—",
                  m.reason ?? "—",
                  m.reversed_by || m.reverses_id ? (
                    <span className="text-outline text-label-sm">Estornado</span>
                  ) : (
                    <button
                      type="button"
                      className="text-label-sm text-error"
                      onClick={() => {
                        const reason = window.prompt("Motivo do estorno:");
                        if (!reason) return;
                        void reverseMovementFn({ data: { movementId: m.id, reason } })
                          .then(() => {
                            flash("Estorno registrado.");
                            return reloadTab();
                          })
                          .catch((err: unknown) =>
                            setError(err instanceof Error ? err.message : "Falha no estorno."),
                          );
                      }}
                    >
                      Estornar
                    </button>
                  ),
                ])}
              />
            </div>
          ) : null}

          {tab === "alertas" ? (
            <DataTable
              loading={loading}
              empty="Nenhum alerta no momento."
              headers={["Alerta", "Produto", "Saldo", "Mín.", "Sugestão", "Validade"]}
              rows={alerts.map((a) => [
                alertLabel(a.alert_kind),
                a.name,
                formatQty(Number(a.stock_qty)),
                formatQty(Number(a.min_stock)),
                formatQty(Number(a.suggestion_qty)),
                a.expires_at ? new Date(a.expires_at).toLocaleDateString("pt-BR") : "—",
              ])}
            />
          ) : null}

          {tab === "inventario" ? (
            <div className="flex flex-col gap-space-md">
              <div className="flex flex-wrap gap-space-sm items-end">
                <WarehouseSelect
                  warehouses={warehouses}
                  value={invWarehouse}
                  onChange={setInvWarehouse}
                />
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                    Categoria (opcional)
                  </span>
                  <select
                    value={invCategory}
                    onChange={(e) => setInvCategory(e.target.value)}
                    className="bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm"
                  >
                    <option value="">Inventário completo</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                  onClick={() => {
                    if (!invWarehouse) return;
                    void createInvFn({
                      data: {
                        warehouseId: Number(invWarehouse),
                        categoryId: invCategory ? Number(invCategory) : null,
                      },
                    })
                      .then(async (r) => {
                        flash(`Inventário ${r.code} criado.`);
                        const detail = await getInvFn({ data: { id: r.id } });
                        setActiveInv(detail);
                        await reloadTab();
                      })
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : "Falha."),
                      );
                  }}
                >
                  Nova contagem
                </button>
              </div>

              {activeInv ? (
                <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md flex flex-col gap-space-md">
                  <div className="flex justify-between items-center">
                    <h3 className="text-headline-md">
                      {activeInv.code} — {activeInv.warehouse_name} ({activeInv.status})
                    </h3>
                    <button type="button" onClick={() => setActiveInv(null)} className="text-label-sm">
                      Fechar
                    </button>
                  </div>
                  <div className="overflow-x-auto max-h-[420px]">
                    <table className="w-full text-left">
                      <thead className="bg-surface-container-low text-label-sm uppercase text-on-surface-variant">
                        <tr>
                          <th className="px-space-sm py-space-xs">Produto</th>
                          <th className="px-space-sm py-space-xs text-right">Sistema</th>
                          <th className="px-space-sm py-space-xs text-right">Contado</th>
                          <th className="px-space-sm py-space-xs text-right">Dif.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeInv.items.map((item, idx) => {
                          const counted =
                            item.counted_qty != null ? Number(item.counted_qty) : Number(item.system_qty);
                          const variance = counted - Number(item.system_qty);
                          return (
                            <tr key={item.id} className="border-t border-surface-container-low">
                              <td className="px-space-sm py-space-xs">{item.product_name}</td>
                              <td className="px-space-sm py-space-xs text-right">
                                {formatQty(Number(item.system_qty))}
                              </td>
                              <td className="px-space-sm py-space-xs text-right">
                                <input
                                  type="number"
                                  step="0.001"
                                  className="w-24 bg-surface-container-low px-space-sm py-1 rounded-lg text-right"
                                  value={
                                    item.counted_qty != null
                                      ? String(Number(item.counted_qty))
                                      : String(Number(item.system_qty))
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setActiveInv((prev) => {
                                      if (!prev) return prev;
                                      const items = [...prev.items];
                                      items[idx] = {
                                        ...items[idx]!,
                                        counted_qty: v,
                                        variance: String(Number(v) - Number(items[idx]!.system_qty)),
                                      };
                                      return { ...prev, items };
                                    });
                                  }}
                                  disabled={activeInv.status === "approved"}
                                />
                              </td>
                              <td
                                className={
                                  "px-space-sm py-space-xs text-right " +
                                  (Math.abs(variance) > 1e-9 ? "text-error font-semibold" : "")
                                }
                              >
                                {formatQty(variance)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {activeInv.status !== "approved" ? (
                    <div className="flex gap-space-sm">
                      <button
                        type="button"
                        className="px-space-lg py-space-sm rounded-xl bg-surface-container-high font-semibold"
                        onClick={() => {
                          void saveInvFn({
                            data: {
                              countId: activeInv.id,
                              items: activeInv.items.map((i) => ({
                                itemId: i.id,
                                countedQty: Number(i.counted_qty ?? i.system_qty),
                              })),
                            },
                          })
                            .then(() => flash("Contagem salva. Aguardando aprovação."))
                            .catch((err: unknown) =>
                              setError(err instanceof Error ? err.message : "Falha."),
                            );
                        }}
                      >
                        Salvar contagem
                      </button>
                      <button
                        type="button"
                        className="px-space-lg py-space-sm rounded-xl bg-primary text-on-primary font-semibold"
                        onClick={() => {
                          const justification = window.prompt("Justificativa da aprovação:");
                          if (!justification) return;
                          void saveInvFn({
                            data: {
                              countId: activeInv.id,
                              items: activeInv.items.map((i) => ({
                                itemId: i.id,
                                countedQty: Number(i.counted_qty ?? i.system_qty),
                              })),
                            },
                          })
                            .then(() =>
                              approveInvFn({
                                data: { countId: activeInv.id, justification },
                              }),
                            )
                            .then(async () => {
                              flash("Inventário aprovado e saldos ajustados.");
                              setActiveInv(await getInvFn({ data: { id: activeInv.id } }));
                              await reloadTab();
                            })
                            .catch((err: unknown) =>
                              setError(err instanceof Error ? err.message : "Falha."),
                            );
                        }}
                      >
                        Aprovar e ajustar
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <DataTable
                  loading={loading}
                  empty="Nenhum inventário."
                  headers={["Código", "Depósito", "Status", "Itens", "Criado por", ""]}
                  rows={inventories.map((inv) => [
                    inv.code,
                    inv.warehouse_name,
                    inv.status,
                    inv.item_count,
                    inv.created_by_name ?? "—",
                    <button
                      key={inv.id}
                      type="button"
                      className="text-primary text-label-sm"
                      onClick={() =>
                        void getInvFn({ data: { id: inv.id } }).then(setActiveInv)
                      }
                    >
                      Abrir
                    </button>,
                  ])}
                />
              )}
            </div>
          ) : null}

          {tab === "compras" ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-lg">
              <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
                <h3 className="text-headline-md">Fornecedores</h3>
                <form
                  className="grid grid-cols-2 gap-space-sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void upsertSupplierFn({
                      data: {
                        id: supplierForm.id,
                        name: supplierForm.name,
                        document: supplierForm.document || null,
                        phone: supplierForm.phone || null,
                        email: supplierForm.email || null,
                      },
                    })
                      .then(() => {
                        flash("Fornecedor salvo.");
                        setSupplierForm({ id: undefined, name: "", document: "", phone: "", email: "" });
                        return reloadTab();
                      })
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : "Falha."),
                      );
                  }}
                >
                  <FormField
                    label="Nome"
                    value={supplierForm.name}
                    onChange={(v) => setSupplierForm((f) => ({ ...f, name: v }))}
                    required
                    className="col-span-2"
                  />
                  <FormField
                    label="Documento"
                    value={supplierForm.document}
                    onChange={(v) => setSupplierForm((f) => ({ ...f, document: v }))}
                  />
                  <FormField
                    label="Telefone"
                    value={supplierForm.phone}
                    onChange={(v) => setSupplierForm((f) => ({ ...f, phone: v }))}
                  />
                  <button
                    type="submit"
                    className="col-span-2 px-space-md py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                  >
                    Salvar fornecedor
                  </button>
                </form>
                <ul className="divide-y divide-surface-container-low max-h-48 overflow-auto">
                  {suppliers.map((s) => (
                    <li key={s.id} className="py-space-xs flex justify-between text-body-sm">
                      <span>{s.name}</span>
                      <button
                        type="button"
                        className="text-primary"
                        onClick={() =>
                          setSupplierForm({
                            id: s.id,
                            name: s.name,
                            document: s.document ?? "",
                            phone: s.phone ?? "",
                            email: s.email ?? "",
                          })
                        }
                      >
                        Editar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
                <h3 className="text-headline-md">Pedido de compra</h3>
                <div className="grid grid-cols-2 gap-space-sm">
                  <label className="flex flex-col gap-space-xs">
                    <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                      Fornecedor
                    </span>
                    <select
                      value={orderDraft.supplierId}
                      onChange={(e) => setOrderDraft((o) => ({ ...o, supplierId: e.target.value }))}
                      className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                    >
                      <option value="">Selecione</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <WarehouseSelect
                    warehouses={warehouses}
                    value={orderDraft.warehouseId}
                    onChange={(v) => setOrderDraft((o) => ({ ...o, warehouseId: v }))}
                  />
                  <ProductSelect
                    products={products}
                    value={orderDraft.productId}
                    onChange={(v) => setOrderDraft((o) => ({ ...o, productId: v }))}
                  />
                  <FormField
                    label="Qtd"
                    type="number"
                    step="0.001"
                    value={orderDraft.qty}
                    onChange={(v) => setOrderDraft((o) => ({ ...o, qty: v }))}
                  />
                  <FormField
                    label="Custo unit."
                    type="number"
                    step="0.01"
                    value={orderDraft.unitCost}
                    onChange={(v) => setOrderDraft((o) => ({ ...o, unitCost: v }))}
                  />
                  <button
                    type="button"
                    className="self-end px-space-md py-space-sm rounded-xl bg-surface-container-high"
                    onClick={() => {
                      const p = products.find((x) => x.id === Number(orderDraft.productId));
                      if (!p || !orderDraft.qty) return;
                      setOrderDraft((o) => ({
                        ...o,
                        items: [
                          ...o.items,
                          {
                            productId: p.id,
                            name: p.name,
                            qtyOrdered: Number(orderDraft.qty),
                            unitCost: Number(orderDraft.unitCost || p.cost_price),
                          },
                        ],
                        productId: "",
                        qty: "",
                        unitCost: "",
                      }));
                    }}
                  >
                    + Item
                  </button>
                </div>
                <ul className="text-body-sm">
                  {orderDraft.items.map((it, i) => (
                    <li key={`${it.productId}-${i}`}>
                      {it.name} — {formatQty(it.qtyOrdered)} × {formatBRL(it.unitCost)}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold self-start"
                  onClick={() => {
                    if (!orderDraft.supplierId || !orderDraft.warehouseId || !orderDraft.items.length)
                      return;
                    void createOrderFn({
                      data: {
                        supplierId: Number(orderDraft.supplierId),
                        warehouseId: Number(orderDraft.warehouseId),
                        items: orderDraft.items.map((i) => ({
                          productId: i.productId,
                          qtyOrdered: i.qtyOrdered,
                          unitCost: i.unitCost,
                        })),
                      },
                    })
                      .then((r) => {
                        flash(`Pedido ${r.code} criado (estoque só sobe no recebimento).`);
                        setOrderDraft((o) => ({ ...o, items: [] }));
                        return reloadTab();
                      })
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : "Falha."),
                      );
                  }}
                >
                  Criar pedido
                </button>
              </div>

              <div className="xl:col-span-2">
                <DataTable
                  loading={loading}
                  empty="Nenhum pedido."
                  headers={["Código", "Fornecedor", "Status", "Itens", "Total", ""]}
                  rows={orders.map((o) => [
                    o.code,
                    o.supplier_name,
                    o.status,
                    o.item_count,
                    formatBRL(Number(o.total_cost)),
                    o.status === "received" ? (
                      "—"
                    ) : (
                      <button
                        key={o.id}
                        type="button"
                        className="text-primary text-label-sm"
                        onClick={() => {
                          void getOrderFn({ data: { id: o.id } }).then((detail) => {
                            setReceiveOrderId(o.id);
                            setReceiveItems(
                              detail.items.map((it) => ({
                                itemId: it.id,
                                name: it.product_name,
                                pending: Number(it.qty_ordered) - Number(it.qty_received),
                                qtyReceived: String(
                                  Math.max(0, Number(it.qty_ordered) - Number(it.qty_received)),
                                ),
                              })),
                            );
                          });
                        }}
                      >
                        Receber
                      </button>
                    ),
                  ])}
                />
              </div>

              {receiveOrderId ? (
                <div className="xl:col-span-2 bg-surface-container-lowest rounded-xl p-space-md shadow-sm">
                  <h4 className="text-headline-md mb-space-sm">Receber mercadoria</h4>
                  {receiveItems.map((it, idx) => (
                    <div key={it.itemId} className="flex gap-space-md items-center mb-space-xs">
                      <span className="flex-1 text-body-sm">
                        {it.name} (pendente {formatQty(it.pending)})
                      </span>
                      <input
                        type="number"
                        step="0.001"
                        className="w-28 bg-surface-container-low px-space-sm py-1 rounded-lg"
                        value={it.qtyReceived}
                        onChange={(e) => {
                          const v = e.target.value;
                          setReceiveItems((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx]!, qtyReceived: v };
                            return next;
                          });
                        }}
                      />
                    </div>
                  ))}
                  <div className="flex gap-space-sm mt-space-md">
                    <button
                      type="button"
                      className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                      onClick={() => {
                        void receiveOrderFn({
                          data: {
                            orderId: receiveOrderId,
                            items: receiveItems.map((i) => ({
                              itemId: i.itemId,
                              qtyReceived: Number(i.qtyReceived || 0),
                            })),
                          },
                        })
                          .then(() => {
                            flash("Recebimento lançado no estoque.");
                            setReceiveOrderId(null);
                            return reloadTab();
                          })
                          .catch((err: unknown) =>
                            setError(err instanceof Error ? err.message : "Falha."),
                          );
                      }}
                    >
                      Confirmar recebimento
                    </button>
                    <button type="button" onClick={() => setReceiveOrderId(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "depositos" ? (
            <div className="flex flex-col gap-space-lg">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-lg">
                <form
                  className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg grid grid-cols-2 gap-space-sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void upsertWarehouseFn({
                      data: {
                        code: whForm.code,
                        name: whForm.name,
                        kind: whForm.kind,
                      },
                    })
                      .then(() => {
                        flash("Depósito cadastrado.");
                        setWhForm({ code: "", name: "", kind: "deposit" });
                        return reloadTab();
                      })
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : "Falha."),
                      );
                  }}
                >
                  <h3 className="text-headline-md col-span-2">Novo depósito / loja</h3>
                  <FormField
                    label="Código"
                    value={whForm.code}
                    onChange={(v) => setWhForm((f) => ({ ...f, code: v }))}
                    required
                  />
                  <FormField
                    label="Nome"
                    value={whForm.name}
                    onChange={(v) => setWhForm((f) => ({ ...f, name: v }))}
                    required
                  />
                  <label className="flex flex-col gap-space-xs col-span-2">
                    <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                      Tipo
                    </span>
                    <select
                      value={whForm.kind}
                      onChange={(e) =>
                        setWhForm((f) => ({
                          ...f,
                          kind: e.target.value as "deposit",
                        }))
                      }
                      className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                    >
                      <option value="deposit">Depósito</option>
                      <option value="store">Loja</option>
                      <option value="branch">Filial</option>
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="col-span-2 px-space-md py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                  >
                    Salvar
                  </button>
                </form>

                <form
                  className="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg grid grid-cols-2 gap-space-sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createTransferFn({
                      data: {
                        fromWarehouseId: Number(transferForm.fromWarehouseId),
                        toWarehouseId: Number(transferForm.toWarehouseId),
                        items: [
                          {
                            productId: Number(transferForm.productId),
                            qty: Number(transferForm.qty),
                          },
                        ],
                      },
                    })
                      .then((r) => {
                        flash(`Transferência ${r.code} enviada.`);
                        setTransferForm((f) => ({ ...f, qty: "" }));
                        return reloadTab();
                      })
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : "Falha."),
                      );
                  }}
                >
                  <h3 className="text-headline-md col-span-2">Transferência</h3>
                  <WarehouseSelect
                    warehouses={warehouses}
                    value={transferForm.fromWarehouseId}
                    onChange={(v) => setTransferForm((f) => ({ ...f, fromWarehouseId: v }))}
                    label="Origem"
                  />
                  <WarehouseSelect
                    warehouses={warehouses}
                    value={transferForm.toWarehouseId}
                    onChange={(v) => setTransferForm((f) => ({ ...f, toWarehouseId: v }))}
                    label="Destino"
                  />
                  <ProductSelect
                    products={products}
                    value={transferForm.productId}
                    onChange={(v) => setTransferForm((f) => ({ ...f, productId: v }))}
                  />
                  <FormField
                    label="Qtd"
                    type="number"
                    step="0.001"
                    value={transferForm.qty}
                    onChange={(v) => setTransferForm((f) => ({ ...f, qty: v }))}
                    required
                  />
                  <button
                    type="submit"
                    className="col-span-2 px-space-md py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                  >
                    Enviar
                  </button>
                </form>
              </div>

              <div>
                <h3 className="text-headline-md mb-space-sm">Saldos por depósito</h3>
                <DataTable
                  loading={loading}
                  empty="Sem saldos."
                  headers={["Depósito", "Produto", "Saldo local", "Saldo total"]}
                  rows={balances.map((b) => [
                    b.warehouse_name,
                    b.product_name,
                    formatQty(Number(b.qty)),
                    formatQty(Number(b.total_qty)),
                  ])}
                />
              </div>

              <div>
                <h3 className="text-headline-md mb-space-sm">Transferências</h3>
                <DataTable
                  loading={loading}
                  empty="Nenhuma transferência."
                  headers={["Código", "De", "Para", "Status", ""]}
                  rows={transfers.map((t) => [
                    t.code,
                    t.from_name,
                    t.to_name,
                    t.status,
                    t.status === "shipped" || t.status === "pending" ? (
                      <button
                        key={t.id}
                        type="button"
                        className="text-primary text-label-sm"
                        onClick={() => {
                          void getTransferFn({ data: { id: t.id } }).then((detail) => {
                            setReceiveTransferId(t.id);
                            setTransferReceiveItems(
                              detail.items.map((it) => ({
                                itemId: it.id,
                                name: it.product_name,
                                qtySent: Number(it.qty_sent),
                                qtyReceived: String(Number(it.qty_sent)),
                              })),
                            );
                          });
                        }}
                      >
                        Receber
                      </button>
                    ) : (
                      "—"
                    ),
                  ])}
                />
              </div>

              {receiveTransferId ? (
                <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm">
                  <h4 className="text-headline-md mb-space-sm">Receber transferência</h4>
                  {transferReceiveItems.map((it, idx) => (
                    <div key={it.itemId} className="flex gap-space-md items-center mb-space-xs">
                      <span className="flex-1 text-body-sm">
                        {it.name} (enviado {formatQty(it.qtySent)})
                      </span>
                      <input
                        type="number"
                        step="0.001"
                        className="w-28 bg-surface-container-low px-space-sm py-1 rounded-lg"
                        value={it.qtyReceived}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTransferReceiveItems((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx]!, qtyReceived: v };
                            return next;
                          });
                        }}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    className="mt-space-md px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                    onClick={() => {
                      void receiveTransferFn({
                        data: {
                          transferId: receiveTransferId,
                          items: transferReceiveItems.map((i) => ({
                            itemId: i.itemId,
                            qtyReceived: Number(i.qtyReceived || 0),
                          })),
                        },
                      })
                        .then((r) => {
                          flash(
                            r.status === "diverged"
                              ? "Recebido com divergência."
                              : "Transferência recebida.",
                          );
                          setReceiveTransferId(null);
                          return reloadTab();
                        })
                        .catch((err: unknown) =>
                          setError(err instanceof Error ? err.message : "Falha."),
                        );
                    }}
                  >
                    Confirmar
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {productModal ? (
          <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-50 flex items-center justify-center p-space-md overflow-y-auto">
            <form
              onSubmit={saveProduct}
              className="bg-surface-container-lowest w-full max-w-3xl rounded-xl shadow-xl overflow-hidden my-space-lg"
            >
              <div className="px-space-lg py-space-md bg-surface-container-low flex items-center justify-between">
                <h3 className="text-headline-md">{form.id ? "Editar produto" : "Novo produto"}</h3>
                <button type="button" onClick={() => setProductModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-space-lg grid grid-cols-1 md:grid-cols-3 gap-space-md max-h-[70vh] overflow-y-auto">
                <FormField
                  label="Código de barras"
                  value={form.barcode}
                  onChange={(v) => setForm((f) => ({ ...f, barcode: v }))}
                  required
                />
                <FormField
                  label="SKU / código interno"
                  value={form.sku}
                  onChange={(v) => setForm((f) => ({ ...f, sku: v }))}
                />
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                    Unidade
                  </span>
                  <select
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <FormField
                  label="Nome"
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  required
                  className="md:col-span-2"
                />
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                    Status
                  </span>
                  <select
                    value={form.active ? "1" : "0"}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "1" }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    <option value="1">Ativo</option>
                    <option value="0">Inativo</option>
                  </select>
                </label>
                <FormField
                  label="Descrição"
                  value={form.description}
                  onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                  className="md:col-span-3"
                />
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                    Categoria
                  </span>
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <FormField
                  label="Subcategoria"
                  value={form.subcategory}
                  onChange={(v) => setForm((f) => ({ ...f, subcategory: v }))}
                />
                <FormField
                  label="Marca"
                  value={form.brand}
                  onChange={(v) => setForm((f) => ({ ...f, brand: v }))}
                />
                <label className="flex flex-col gap-space-xs">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                    Fornecedor
                  </span>
                  <select
                    value={form.supplierId}
                    onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
                    className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                  >
                    <option value="">—</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <FormField
                  label="Custo"
                  type="number"
                  step="0.01"
                  value={form.costPrice}
                  onChange={(v) => setForm((f) => ({ ...f, costPrice: v }))}
                  required
                />
                <FormField
                  label="Preço de venda"
                  type="number"
                  step="0.01"
                  value={form.sellPrice}
                  onChange={(v) => setForm((f) => ({ ...f, sellPrice: v }))}
                  required
                />
                {!form.id ? (
                  <FormField
                    label="Estoque inicial"
                    type="number"
                    step="0.001"
                    value={form.stockQty}
                    onChange={(v) => setForm((f) => ({ ...f, stockQty: v }))}
                  />
                ) : (
                  <div className="flex flex-col gap-space-xs">
                    <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                      Estoque atual
                    </span>
                    <p className="px-space-md py-space-sm rounded-xl bg-surface-container-low">
                      {formatQty(Number(form.stockQty))} (use Entradas/Saídas para alterar)
                    </p>
                  </div>
                )}
                <FormField
                  label="Estoque mínimo"
                  type="number"
                  step="0.001"
                  value={form.minStock}
                  onChange={(v) => setForm((f) => ({ ...f, minStock: v }))}
                />
                <FormField
                  label="Estoque máximo"
                  type="number"
                  step="0.001"
                  value={form.maxStock}
                  onChange={(v) => setForm((f) => ({ ...f, maxStock: v }))}
                />
                <FormField
                  label="Validade"
                  type="date"
                  value={form.expiresAt}
                  onChange={(v) => setForm((f) => ({ ...f, expiresAt: v }))}
                />
                <FormField
                  label="URL da foto"
                  value={form.imageUrl}
                  onChange={(v) => setForm((f) => ({ ...f, imageUrl: v }))}
                  className="md:col-span-2"
                />
              </div>
              <div className="px-space-lg py-space-md bg-surface-container-low flex justify-end gap-space-sm">
                <button type="button" onClick={() => setProductModal(false)}>
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
          </div>
        ) : null}
      </main>
    </div>
  );
}

function ProductsPanel({
  products,
  categories,
  search,
  setSearch,
  categoryFilter,
  setCategoryFilter,
  loading,
  onReload,
  onEdit,
}: {
  products: ProductRow[];
  categories: Category[];
  search: string;
  setSearch: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  loading: boolean;
  onReload: () => void;
  onEdit: (p: ProductRow) => void;
}) {
  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex flex-wrap gap-space-md items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nome, barras ou SKU..."
          className="flex-1 min-w-[220px] bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm"
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onReload}
          className="px-space-md py-space-sm rounded-xl bg-surface-container-high text-label-md font-medium"
        >
          Atualizar
        </button>
      </div>
      <DataTable
        loading={loading}
        empty="Nenhum produto."
        headers={["Código", "SKU", "Produto", "Un.", "Custo", "Venda", "Estoque", "Mín.", "Status", ""]}
        rows={products.map((p) => {
          const low = Number(p.stock_qty) <= Number(p.min_stock);
          return [
            p.barcode,
            p.sku || "—",
            <span key={`n-${p.id}`}>
              {p.name}
              {p.brand ? (
                <span className="block text-label-sm text-outline">{p.brand}</span>
              ) : null}
            </span>,
            p.unit,
            formatBRL(Number(p.cost_price)),
            formatBRL(Number(p.sell_price)),
            <span key={`q-${p.id}`} className={low ? "text-error font-bold" : ""}>
              {formatQty(Number(p.stock_qty))}
            </span>,
            formatQty(Number(p.min_stock)),
            p.active ? "Ativo" : "Inativo",
            <button
              key={`e-${p.id}`}
              type="button"
              onClick={() => onEdit(p)}
              className="px-space-sm py-1 rounded-lg bg-surface-container-high text-label-sm"
            >
              Editar
            </button>,
          ];
        })}
      />
    </div>
  );
}

function alertLabel(kind: StockAlertRow["alert_kind"]) {
  const map = {
    zero: "Sem saldo",
    below_min: "Abaixo do mínimo",
    near_expiry: "Perto do vencimento",
    stagnant: "Parado",
    reorder: "Sugestão reposição",
  };
  return map[kind];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md">
      <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className="text-headline-lg text-on-surface mt-space-xs">{value}</p>
    </div>
  );
}

function FormField({
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

function ProductSelect({
  products,
  value,
  onChange,
  optional,
}: {
  products: ProductRow[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <label className="flex flex-col gap-space-xs">
      <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
        Produto
      </span>
      <select
        required={!optional}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-container-low px-space-md py-space-sm rounded-xl min-w-[200px]"
      >
        <option value="">{optional ? "Todos" : "Selecione"}</option>
        {products.filter((p) => p.active).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({formatQty(Number(p.stock_qty))} {p.unit})
          </option>
        ))}
      </select>
    </label>
  );
}

function WarehouseSelect({
  warehouses,
  value,
  onChange,
  label = "Depósito",
}: {
  warehouses: WarehouseRow[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <label className="flex flex-col gap-space-xs">
      <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <select
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
      >
        <option value="">Selecione</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.is_default ? " (padrão)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function DataTable({
  headers,
  rows,
  loading,
  empty,
}: {
  headers: string[];
  rows: ReactNode[][];
  loading?: boolean;
  empty: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-space-md py-space-sm">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-low">
            {loading ? (
              <tr>
                <td colSpan={headers.length} className="px-space-md py-space-lg text-center text-on-surface-variant">
                  Carregando...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="px-space-md py-space-lg text-center text-on-surface-variant">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-surface-container-low/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-space-md py-space-sm text-body-sm">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
