import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthPrompt } from "@/components/pdv/AuthPrompt";
import { formatBRL, formatQty, parseBRL } from "@/lib/money";
import {
  closeCashSession,
  createCashMovement,
  getCashSessionPreview,
  getCurrentCashSession,
  openCashSession,
} from "@/fn/cash-session";
import { createCustomer, searchCustomers, type CustomerRow } from "@/fn/customers";
import {
  canApplySaleDiscount,
  canCancelSale,
  canDoCashMovement,
  roleLabel,
} from "@/fn/permissions";
import { searchProducts, type ProductRow } from "@/fn/products";
import { cancelSale, completeSale, getSaleDetail, listSales } from "@/fn/sales";

export const Route = createFileRoute("/_authenticated/caixa-pdv")({
  head: () => ({
    meta: [{ title: "Caixa PDV | MarketFlow" }],
  }),
  component: CaixaPdvPage,
});

type CartItem = {
  productId: number;
  barcode: string;
  name: string;
  unitPrice: number;
  qty: number;
  discount: number;
};

type PaymentMethod = "cash" | "pix" | "credit" | "debit" | "fiado";
type PaymentLine = { id: string; method: PaymentMethod; amount: string; received: string };

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  credit: "Crédito",
  debit: "Débito",
  fiado: "Fiado",
};

function lineTotal(item: CartItem) {
  return Math.max(0, item.qty * item.unitPrice - item.discount);
}

function CaixaPdvPage() {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const getSessionFn = useServerFn(getCurrentCashSession);
  const openSessionFn = useServerFn(openCashSession);
  const closeSessionFn = useServerFn(closeCashSession);
  const previewFn = useServerFn(getCashSessionPreview);
  const movementFn = useServerFn(createCashMovement);
  const searchProductsFn = useServerFn(searchProducts);
  const searchCustomersFn = useServerFn(searchCustomers);
  const createCustomerFn = useServerFn(createCustomer);
  const completeSaleFn = useServerFn(completeSale);
  const listSalesFn = useServerFn(listSales);
  const getSaleFn = useServerFn(getSaleDetail);
  const cancelSaleFn = useServerFn(cancelSale);

  const searchRef = useRef<HTMLInputElement>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [cashSession, setCashSession] = useState<Awaited<
    ReturnType<typeof getCurrentCashSession>
  >["session"]>(null);
  const [openingCash, setOpeningCash] = useState("100");
  const [openingNotes, setOpeningNotes] = useState("");
  const [opening, setOpening] = useState(false);

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [saleDiscount, setSaleDiscount] = useState(0);
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [customerQ, setCustomerQ] = useState("");
  const [customerHits, setCustomerHits] = useState<CustomerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [draftMethod, setDraftMethod] = useState<PaymentMethod>("cash");
  const [draftAmount, setDraftAmount] = useState("");
  const [draftReceived, setDraftReceived] = useState("");
  const [saving, setSaving] = useState(false);

  const [receipt, setReceipt] = useState<null | {
    code: string;
    total: number;
    change: number;
    items: CartItem[];
    payments: PaymentLine[];
    customerName?: string;
    saleDiscount: number;
  }>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQ, setHistoryQ] = useState("");
  const [historyRows, setHistoryRows] = useState<Awaited<ReturnType<typeof listSales>>>([]);
  const [historyDetail, setHistoryDetail] = useState<Awaited<
    ReturnType<typeof getSaleDetail>
  > | null>(null);

  const [moveOpen, setMoveOpen] = useState<null | "sangria" | "suprimento">(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closePreview, setClosePreview] = useState<Awaited<
    ReturnType<typeof getCashSessionPreview>
  > | null>(null);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const [authOpen, setAuthOpen] = useState<null | {
    title: string;
    onConfirm: (u: string, p: string) => Promise<void>;
  }>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const reloadSession = useCallback(async () => {
    const res = await getSessionFn();
    setCashSession(res.session);
    return res.session;
  }, [getSessionFn]);

  useEffect(() => {
    void reloadSession()
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar caixa."))
      .finally(() => setBootLoading(false));
  }, [reloadSession]);

  const grossSubtotal = useMemo(
    () => cart.reduce((s, i) => s + i.qty * i.unitPrice, 0),
    [cart],
  );
  const itemDiscounts = useMemo(() => cart.reduce((s, i) => s + i.discount, 0), [cart]);
  const total = Math.max(0, grossSubtotal - itemDiscounts - saleDiscount);
  const paidSum = payments.reduce((s, p) => s + parseBRL(p.amount || "0"), 0);
  const remaining = Math.max(0, total - paidSum);
  const cashChange = payments.reduce((s, p) => {
    if (p.method !== "cash") return s;
    return s + Math.max(0, parseBRL(p.received || "0") - parseBRL(p.amount || "0"));
  }, 0);

  async function handleOpenCash(e: React.FormEvent) {
    e.preventDefault();
    setOpening(true);
    setError(null);
    try {
      await openSessionFn({
        data: {
          openingCash: parseBRL(openingCash || "0"),
          notes: openingNotes || undefined,
        },
      });
      await reloadSession();
      setMessage("Caixa aberto com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao abrir caixa.");
    } finally {
      setOpening(false);
    }
  }

  function addProduct(product: ProductRow, qty = 1) {
    const unitPrice = Number(product.sell_price);
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === product.id && i.discount === 0);
      if (idx >= 0) {
        return prev.map((i, n) => (n === idx ? { ...i, qty: i.qty + qty } : i));
      }
      return [
        ...prev,
        {
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          unitPrice,
          qty,
          discount: 0,
        },
      ];
    });
    setSelectedIndex(0);
    setMessage(`Adicionado: ${product.name}`);
    setError(null);
  }

  async function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    try {
      const results = await searchProductsFn({ data: { q } });
      if (!results[0]) {
        setError("Produto não encontrado.");
        return;
      }
      addProduct(results.find((p) => p.barcode === q) ?? results[0]);
      setQuery("");
      searchRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na busca.");
    }
  }

  function changeQty(delta: number) {
    if (!cart.length) return;
    const idx = Math.min(selectedIndex, cart.length - 1);
    setCart((prev) =>
      prev
        .map((item, i) => {
          if (i !== idx) return item;
          const qty = Math.max(0, item.qty + delta);
          const maxDisc = qty * item.unitPrice;
          return { ...item, qty, discount: Math.min(item.discount, maxDisc) };
        })
        .filter((i) => i.qty > 0),
    );
  }

  function setQtyPrompt() {
    if (!cart.length) return;
    const idx = Math.min(selectedIndex, cart.length - 1);
    const item = cart[idx]!;
    const raw = window.prompt(`Quantidade de "${item.name}":`, String(item.qty));
    if (raw == null) return;
    const qty = Number(raw.replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantidade inválida.");
      return;
    }
    setCart((prev) =>
      prev.map((it, i) =>
        i === idx
          ? { ...it, qty, discount: Math.min(it.discount, qty * it.unitPrice) }
          : it,
      ),
    );
  }

  function applyItemDiscount() {
    if (!cart.length) return;
    const idx = Math.min(selectedIndex, cart.length - 1);
    const item = cart[idx]!;
    const max = item.qty * item.unitPrice;
    const raw = window.prompt(
      `Desconto em R$ no item "${item.name}" (máx ${formatBRL(max)}):`,
      String(item.discount || 0).replace(".", ","),
    );
    if (raw == null) return;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return setError("Desconto inválido.");
    setCart((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, discount: Math.min(value, max) } : it)),
    );
    setMessage(`Desconto no item: ${formatBRL(Math.min(value, max))}`);
  }

  function applySaleDiscount() {
    if (!canApplySaleDiscount(user)) {
      setError("Desconto geral exige supervisor/admin.");
      return;
    }
    const raw = window.prompt(
      "Desconto geral em R$:",
      String(saleDiscount || 0).replace(".", ","),
    );
    if (raw == null) return;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return setError("Desconto inválido.");
    const net = Math.max(0, grossSubtotal - itemDiscounts);
    setSaleDiscount(Math.min(value, net));
  }

  async function searchCustomer() {
    if (!customerQ.trim()) return;
    try {
      setCustomerHits(await searchCustomersFn({ data: { q: customerQ.trim() } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar cliente.");
    }
  }

  async function quickCreateCustomer() {
    const name = customerQ.trim();
    if (name.length < 2) return;
    try {
      const created = await createCustomerFn({
        data: { name, creditLimit: 500 },
      });
      const hits = await searchCustomersFn({ data: { q: name } });
      const found = hits.find((c) => c.id === created.id) ?? hits[0] ?? null;
      setCustomer(found);
      setCustomerHits([]);
      setMessage(`Cliente "${name}" selecionado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar cliente.");
    }
  }

  function fillDraftForRemaining(left: number) {
    const formatted = left > 0.009 ? left.toFixed(2).replace(".", ",") : "";
    setDraftAmount(formatted);
    setDraftReceived(formatted);
  }

  function openPayment() {
    if (!cart.length) return setError("Adicione itens antes de finalizar.");
    setPayments([]);
    setDraftMethod("cash");
    fillDraftForRemaining(total);
    setPaymentOpen(true);
    setPaymentError(null);
    setError(null);
  }

  function addPaymentLine() {
    const amount = parseBRL(draftAmount || "0");
    if (amount <= 0) {
      setPaymentError("Informe um valor válido para esta forma.");
      return;
    }
    if (amount - remaining > 0.02) {
      setPaymentError(
        `Valor maior que o restante (${formatBRL(remaining)}). Reduza o valor para combinar formas.`,
      );
      return;
    }
    if (draftMethod === "fiado" && !customer) {
      setPaymentError("Selecione um cliente na venda antes de usar fiado.");
      return;
    }
    if (draftMethod === "cash") {
      const received = parseBRL(draftReceived || draftAmount || "0");
      if (received + 0.001 < amount) {
        setPaymentError("Valor recebido em dinheiro insuficiente.");
        return;
      }
    }

    const left = Math.max(0, Number((remaining - amount).toFixed(2)));
    setPayments((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        method: draftMethod,
        amount: amount.toFixed(2).replace(".", ","),
        received:
          draftMethod === "cash"
            ? draftReceived || draftAmount
            : amount.toFixed(2).replace(".", ","),
      },
    ]);
    fillDraftForRemaining(left);
    setPaymentError(
      left > 0.02
        ? `Forma incluída. Ainda falta ${formatBRL(left)} — escolha outra forma.`
        : null,
    );
  }

  async function confirmPayment() {
    if (!payments.length || remaining > 0.02) {
      setPaymentError(remaining > 0.02 ? `Falta ${formatBRL(remaining)}.` : "Inclua pagamentos.");
      return;
    }
    setSaving(true);
    setError(null);
    setPaymentError(null);
    try {
      const snapshot = {
        items: [...cart],
        payments: [...payments],
        customerName: customer?.name,
        saleDiscount,
      };
      const result = await completeSaleFn({
        data: {
          items: cart.map((i) => ({
            productId: i.productId,
            qty: i.qty,
            unitPrice: i.unitPrice,
            discount: i.discount,
          })),
          saleDiscount,
          surcharge: 0,
          customerId: customer?.id ?? null,
          payments: payments.map((p) => ({
            method: p.method,
            amount: parseBRL(p.amount),
            receivedAmount: p.method === "cash" ? parseBRL(p.received || p.amount) : undefined,
          })),
        },
      });
      setPaymentOpen(false);
      setCart([]);
      setSaleDiscount(0);
      setPayments([]);
      setCustomer(null);
      setReceipt({
        code: result.code,
        total: result.total,
        change: result.change,
        items: snapshot.items,
        payments: snapshot.payments,
        saleDiscount: snapshot.saleDiscount,
        ...(snapshot.customerName ? { customerName: snapshot.customerName } : {}),
      });
      setMessage(`Venda ${result.code} concluída.`);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "Falha ao finalizar.");
    } finally {
      setSaving(false);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryDetail(null);
    try {
      setHistoryRows(await listSalesFn({ data: { q: historyQ || undefined } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no histórico.");
    }
  }

  async function doCancelSale(id: number, reason: string, auth?: { u: string; p: string }) {
    await cancelSaleFn({
      data: {
        id,
        reason,
        authUsername: auth?.u,
        authPassword: auth?.p,
      },
    });
    setMessage("Venda cancelada (estoque estornado; histórico mantido).");
    await openHistory();
  }

  function requestCancel(id: number) {
    const reason = window.prompt("Motivo do cancelamento:");
    if (!reason || reason.trim().length < 3) return;
    if (canCancelSale(user)) {
      void doCancelSale(id, reason.trim()).catch((e) =>
        setError(e instanceof Error ? e.message : "Falha no cancelamento."),
      );
      return;
    }
    setAuthOpen({
      title: "Autorizar cancelamento",
      onConfirm: async (u, p) => {
        await doCancelSale(id, reason.trim(), { u, p });
      },
    });
  }

  async function submitMovement(auth?: { u: string; p: string }) {
    if (!moveOpen) return;
    await movementFn({
      data: {
        type: moveOpen,
        amount: parseBRL(moveAmount || "0"),
        reason: moveReason,
        authUsername: auth?.u,
        authPassword: auth?.p,
      },
    });
    setMoveOpen(null);
    setMoveAmount("");
    setMoveReason("");
    setMessage(`${moveOpen === "sangria" ? "Sangria" : "Suprimento"} registrado.`);
  }

  function requestMovement() {
    if (!moveOpen) return;
    if (parseBRL(moveAmount || "0") <= 0 || moveReason.trim().length < 2) {
      setError("Informe valor e motivo.");
      return;
    }
    if (canDoCashMovement(user)) {
      void submitMovement().catch((e) =>
        setError(e instanceof Error ? e.message : "Falha no movimento."),
      );
      return;
    }
    setAuthOpen({
      title: `Autorizar ${moveOpen}`,
      onConfirm: async (u, p) => {
        await submitMovement({ u, p });
      },
    });
  }

  async function openClose() {
    try {
      const preview = await previewFn();
      setClosePreview(preview);
      setCountedCash(preview.expectedCash.toFixed(2).replace(".", ","));
      setCloseOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao preparar fechamento.");
    }
  }

  async function confirmClose() {
    try {
      const res = await closeSessionFn({
        data: {
          countedCash: parseBRL(countedCash || "0"),
          notes: closeNotes || undefined,
        },
      });
      setCloseOpen(false);
      setCart([]);
      await reloadSession();
      setMessage(
        `Caixa fechado. Esperado ${formatBRL(res.expectedCash)} · Contado ${formatBRL(res.countedCash)} · Diferença ${formatBRL(res.variance)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no fechamento.");
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!cashSession) return;
      if (e.key === "F1") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F2") {
        e.preventDefault();
        applyItemDiscount();
      } else if (e.key === "F3") {
        e.preventDefault();
        openPayment();
      } else if (e.key === "F4") {
        e.preventDefault();
        setCart((prev) => prev.filter((_, i) => i !== Math.min(selectedIndex, prev.length - 1)));
      } else if (e.key === "F6") {
        e.preventDefault();
        applySaleDiscount();
      } else if (e.key === "+" || e.key === "=") {
        if (!(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          changeQty(1);
        }
      } else if (e.key === "-") {
        if (!(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          changeQty(-1);
        }
      } else if (e.key === "Escape") {
        if (paymentOpen) setPaymentOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashSession, cart, selectedIndex, paymentOpen, total, remaining, saleDiscount, customer]);

  if (bootLoading) {
    return (
      <div className="pl-64 pt-16 p-space-lg">
        <p className="text-on-surface-variant">Carregando caixa...</p>
      </div>
    );
  }

  if (!cashSession) {
    return (
      <div className="pl-64">
        <main className="pt-16 min-h-screen bg-surface flex items-center justify-center p-space-lg">
          <form
            onSubmit={handleOpenCash}
            className="w-full max-w-lg bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden"
          >
            <div className="px-space-lg py-space-md bg-surface-container-low">
              <h1 className="text-headline-lg">Abertura de caixa</h1>
              <p className="text-body-md text-on-surface-variant mt-space-xs">
                Operador: <strong>{user.name}</strong> ({roleLabel(user.role)}) · PDV-01
              </p>
            </div>
            <div className="p-space-lg flex flex-col gap-space-md">
              {error ? (
                <div className="rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm">
                  {error}
                </div>
              ) : null}
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm uppercase text-on-surface-variant">
                  Fundo de troco (R$)
                </span>
                <input
                  required
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl text-headline-md font-bold"
                />
              </label>
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm uppercase text-on-surface-variant">Observações</span>
                <textarea
                  value={openingNotes}
                  onChange={(e) => setOpeningNotes(e.target.value)}
                  rows={3}
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                />
              </label>
              <p className="text-body-sm text-on-surface-variant">
                Data/hora registrada automaticamente. Não é permitido abrir dois caixas para o mesmo
                operador ou o mesmo PDV.
              </p>
              <button
                type="submit"
                disabled={opening}
                className="w-full py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
              >
                {opening ? "Abrindo..." : "Abrir caixa"}
              </button>
            </div>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="pl-64">
      <main className="relative pt-16 bg-surface min-h-screen">
        <div className="flex flex-col w-full h-[calc(100vh-4rem)] overflow-hidden">
          <div className="flex items-center justify-between px-space-lg py-space-sm bg-surface-container-low gap-space-md flex-wrap">
            <div className="flex items-center gap-space-md flex-wrap">
              <div className="flex items-center gap-space-xs bg-primary-container/30 px-space-md py-space-xs rounded-xl text-primary font-semibold text-label-md">
                <span className="material-symbols-outlined text-[18px]">point_of_sale</span>
                <span>
                  {cashSession.register_code} aberto ·{" "}
                  {new Date(cashSession.opened_at).toLocaleString("pt-BR")}
                </span>
              </div>
              <span className="text-body-sm text-on-surface-variant">
                Operador: {cashSession.operator_name} · Fundo {formatBRL(Number(cashSession.opening_cash))}
              </span>
            </div>
            <div className="flex items-center gap-space-xs flex-wrap">
              <HeaderBtn onClick={() => void openHistory()}>Histórico</HeaderBtn>
              <HeaderBtn onClick={() => setMoveOpen("sangria")}>Sangria</HeaderBtn>
              <HeaderBtn onClick={() => setMoveOpen("suprimento")}>Suprimento</HeaderBtn>
              <HeaderBtn onClick={() => void openClose()}>Fechar caixa</HeaderBtn>
            </div>
          </div>

          {(message || error) && (
            <div
              className={
                "mx-space-lg mt-space-sm px-space-md py-space-sm rounded-xl " +
                (error
                  ? "bg-error-container text-on-error-container"
                  : "bg-primary/10 text-primary")
              }
            >
              {error ?? message}
            </div>
          )}

          <div className="flex-1 grid grid-cols-12 gap-space-md p-space-lg overflow-hidden">
            <div className="col-span-8 flex flex-col gap-space-md h-full overflow-hidden">
              <form
                onSubmit={onSearch}
                className="relative flex items-center bg-surface-container-lowest shadow-sm rounded-xl px-space-md py-space-sm"
              >
                <span className="material-symbols-outlined text-primary text-[24px] mr-space-md">
                  barcode_scanner
                </span>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-transparent text-body-lg focus:outline-none font-medium"
                  placeholder="Código de barras ou nome (F1)..."
                />
              </form>

              <div className="flex gap-space-sm items-center">
                <input
                  value={customerQ}
                  onChange={(e) => setCustomerQ(e.target.value)}
                  placeholder="Cliente (nome/documento)"
                  className="flex-1 bg-surface-container-lowest px-space-md py-space-sm rounded-xl shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => void searchCustomer()}
                  className="px-space-md py-space-sm rounded-xl bg-surface-container-high"
                >
                  Buscar
                </button>
                <button
                  type="button"
                  onClick={() => void quickCreateCustomer()}
                  className="px-space-md py-space-sm rounded-xl bg-surface-container-high"
                >
                  Novo
                </button>
                {customer ? (
                  <button
                    type="button"
                    onClick={() => setCustomer(null)}
                    className="px-space-md py-space-sm rounded-xl bg-primary/10 text-primary text-label-sm"
                  >
                    {customer.name} ✕
                  </button>
                ) : null}
              </div>
              {customerHits.length > 0 ? (
                <div className="bg-surface-container-lowest rounded-xl shadow-sm divide-y">
                  {customerHits.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-space-md py-space-sm hover:bg-surface-container-low"
                      onClick={() => {
                        setCustomer(c);
                        setCustomerHits([]);
                      }}
                    >
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-body-sm text-on-surface-variant ml-space-sm">
                        limite {formatBRL(Number(c.credit_limit))} · em aberto{" "}
                        {formatBRL(Number(c.open_balance))}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex-1 bg-surface-container-lowest shadow-sm rounded-xl flex flex-col overflow-hidden">
                <div className="grid grid-cols-12 gap-space-md px-space-lg py-space-sm bg-surface-container-low text-label-sm uppercase text-on-surface-variant font-semibold">
                  <div className="col-span-1">#</div>
                  <div className="col-span-4">Produto</div>
                  <div className="col-span-2 text-center">Qtd</div>
                  <div className="col-span-2 text-right">Preço</div>
                  <div className="col-span-1 text-right">Desc.</div>
                  <div className="col-span-2 text-right">Total</div>
                </div>
                <div className="flex-1 overflow-y-auto divide-y">
                  {cart.length === 0 ? (
                    <p className="p-space-lg text-center text-on-surface-variant">Carrinho vazio.</p>
                  ) : (
                    cart.map((item, index) => (
                      <button
                        key={`${item.productId}-${index}`}
                        type="button"
                        onClick={() => setSelectedIndex(index)}
                        className={
                          "w-full grid grid-cols-12 gap-space-md px-space-lg py-space-md text-left " +
                          (selectedIndex === index ? "bg-primary/10" : "hover:bg-surface-container-low/50")
                        }
                      >
                        <div className="col-span-1 text-outline text-label-sm">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="col-span-4">
                          <p className="font-semibold">{item.name}</p>
                          <p className="text-body-sm text-outline">{item.barcode}</p>
                        </div>
                        <div className="col-span-2 text-center">{formatQty(item.qty)}</div>
                        <div className="col-span-2 text-right">{formatBRL(item.unitPrice)}</div>
                        <div className="col-span-1 text-right text-primary">
                          {item.discount > 0 ? `-${formatBRL(item.discount)}` : "—"}
                        </div>
                        <div className="col-span-2 text-right font-semibold text-primary">
                          {formatBRL(lineTotal(item))}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="col-span-4 flex flex-col gap-space-md h-full">
              <div className="bg-surface-container-lowest shadow-sm rounded-xl p-space-lg flex flex-col gap-space-sm">
                <h2 className="text-headline-sm border-b border-surface-container pb-space-xs">
                  Resumo
                </h2>
                <Row label="Subtotal" value={formatBRL(grossSubtotal)} />
                <Row label="Desc. itens" value={formatBRL(itemDiscounts)} accent />
                <Row label="Desc. geral" value={formatBRL(saleDiscount)} accent />
                <div className="bg-primary/5 p-space-md rounded-xl mt-space-xs">
                  <p className="text-label-sm text-primary uppercase font-semibold">Total</p>
                  <p className="text-display-lg text-primary font-bold">{formatBRL(total)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-space-sm flex-1 content-start">
                <Action label="Qtd +" onClick={() => changeQty(1)} />
                <Action label="Qtd -" onClick={() => changeQty(-1)} />
                <Action label="Qtd..." onClick={setQtyPrompt} />
                <Action label="Desc. item F2" onClick={applyItemDiscount} />
                <Action label="Desc. geral F6" onClick={applySaleDiscount} />
                <Action
                  label="Remover item F4"
                  danger
                  onClick={() =>
                    setCart((prev) =>
                      prev.filter((_, i) => i !== Math.min(selectedIndex, prev.length - 1)),
                    )
                  }
                />
              </div>

              <button
                type="button"
                onClick={openPayment}
                className="w-full py-space-md bg-primary text-on-primary rounded-xl font-semibold"
              >
                Finalizar {formatBRL(total)} [F3]
              </button>
            </div>
          </div>
        </div>

        {paymentOpen ? (
          <Modal
            title="Pagamento (formas combinadas)"
            onClose={() => setPaymentOpen(false)}
            wide
            footer={
              <>
                <button type="button" onClick={() => setPaymentOpen(false)}>
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={saving || remaining > 0.02 || !payments.length}
                  onClick={() => void confirmPayment()}
                  className="px-space-xl py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
                >
                  {saving ? "Processando..." : "Confirmar"}
                </button>
              </>
            }
          >
            <div className="grid grid-cols-3 gap-space-md bg-primary/5 p-space-md rounded-xl">
              <Stat label="Total" value={formatBRL(total)} />
              <Stat label="Pago" value={formatBRL(paidSum)} />
              <Stat
                label={remaining > 0.02 ? "Restante" : "Troco"}
                value={formatBRL(remaining > 0.02 ? remaining : cashChange)}
              />
            </div>

            <p className="text-body-sm text-on-surface-variant mt-space-md">
              Para combinar formas (ex.: PIX + dinheiro), informe um valor parcial, clique em{" "}
              <strong>Incluir forma</strong> e repita com o restante.
            </p>

            {paymentError ? (
              <div className="mt-space-md rounded-xl bg-error-container text-on-error-container px-space-md py-space-sm text-body-md">
                {paymentError}
              </div>
            ) : null}

            {payments.length > 0 ? (
              <div className="mt-space-md divide-y border border-surface-container-high rounded-xl overflow-hidden">
                {payments.map((p) => (
                  <div key={p.id} className="flex justify-between items-center px-space-md py-space-sm">
                    <span>
                      {METHOD_LABEL[p.method]} · {formatBRL(parseBRL(p.amount))}
                    </span>
                    <button
                      type="button"
                      className="text-error text-label-sm font-semibold"
                      onClick={() => {
                        setPayments((prev) => {
                          const next = prev.filter((x) => x.id !== p.id);
                          const paid = next.reduce((s, x) => s + parseBRL(x.amount || "0"), 0);
                          fillDraftForRemaining(Math.max(0, total - paid));
                          return next;
                        });
                        setPaymentError(null);
                      }}
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {remaining > 0.02 ? (
              <div className="flex flex-col gap-space-md pt-space-md">
                <label className="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider">
                  {payments.length === 0 ? "1ª forma de pagamento" : "Próxima forma de pagamento"}
                </label>
                <div className="grid grid-cols-5 gap-space-sm">
                  {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setDraftMethod(m);
                        if (!draftAmount.trim()) fillDraftForRemaining(remaining);
                      }}
                      className={
                        "p-space-sm rounded-xl border text-label-sm " +
                        (draftMethod === m
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "")
                      }
                    >
                      {METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-space-sm">
                  <button
                    type="button"
                    className="px-space-sm py-1 rounded-lg bg-surface-container-high text-label-sm"
                    onClick={() => fillDraftForRemaining(remaining)}
                  >
                    Usar restante ({formatBRL(remaining)})
                  </button>
                  <button
                    type="button"
                    className="px-space-sm py-1 rounded-lg bg-surface-container-high text-label-sm"
                    onClick={() => fillDraftForRemaining(Number((remaining / 2).toFixed(2)))}
                  >
                    Metade ({formatBRL(remaining / 2)})
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-space-md">
                  <MoneyInput label="Valor desta forma" value={draftAmount} onChange={setDraftAmount} />
                  {draftMethod === "cash" ? (
                    <MoneyInput
                      label="Recebido em dinheiro"
                      value={draftReceived}
                      onChange={setDraftReceived}
                    />
                  ) : (
                    <p className="text-body-sm text-on-surface-variant self-end pb-space-sm">
                      Restante a cobrir: {formatBRL(remaining)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={addPaymentLine}
                  className="self-start px-space-lg py-space-sm rounded-xl bg-primary text-on-primary font-semibold"
                >
                  + Incluir forma
                </button>
              </div>
            ) : (
              <p className="text-body-md text-primary mt-space-md font-medium">
                Total coberto. Pode confirmar o pagamento.
              </p>
            )}
          </Modal>
        ) : null}

        {receipt ? (
          <Modal
            title={`Comprovante ${receipt.code}`}
            onClose={() => setReceipt(null)}
            footer={
              <>
                <button type="button" onClick={() => setReceipt(null)}>
                  Fechar
                </button>
                <button
                  type="button"
                  className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                  onClick={() => window.print()}
                >
                  Imprimir
                </button>
              </>
            }
          >
            <div id="receipt-print" className="text-body-md space-y-space-sm">
              <p className="font-semibold">MarketFlow · Comprovante não fiscal</p>
              <p>
                {receipt.code} · {new Date().toLocaleString("pt-BR")}
              </p>
              <p>Operador: {user.name}</p>
              {receipt.customerName ? <p>Cliente: {receipt.customerName}</p> : null}
              <hr />
              {receipt.items.map((i, idx) => (
                <div key={idx} className="flex justify-between gap-space-md">
                  <span>
                    {formatQty(i.qty)}x {i.name}
                    {i.discount > 0 ? ` (−${formatBRL(i.discount)})` : ""}
                  </span>
                  <span>{formatBRL(lineTotal(i))}</span>
                </div>
              ))}
              <hr />
              {receipt.saleDiscount > 0 ? (
                <div className="flex justify-between">
                  <span>Desconto geral</span>
                  <span>−{formatBRL(receipt.saleDiscount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>{formatBRL(receipt.total)}</span>
              </div>
              {receipt.payments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span>{METHOD_LABEL[p.method]}</span>
                  <span>{formatBRL(parseBRL(p.amount))}</span>
                </div>
              ))}
              {receipt.change > 0 ? (
                <div className="flex justify-between">
                  <span>Troco</span>
                  <span>{formatBRL(receipt.change)}</span>
                </div>
              ) : null}
            </div>
          </Modal>
        ) : null}

        {historyOpen ? (
          <Modal
            title="Histórico de vendas"
            onClose={() => setHistoryOpen(false)}
            wide
            footer={
              <button type="button" onClick={() => setHistoryOpen(false)}>
                Fechar
              </button>
            }
          >
            <div className="flex gap-space-sm mb-space-md">
              <input
                value={historyQ}
                onChange={(e) => setHistoryQ(e.target.value)}
                placeholder="Código / cliente"
                className="flex-1 bg-surface-container-low px-space-md py-space-sm rounded-xl"
              />
              <button
                type="button"
                className="px-space-md py-space-sm rounded-xl bg-surface-container-high"
                onClick={() => void openHistory()}
              >
                Filtrar
              </button>
            </div>
            {historyDetail ? (
              <div className="space-y-space-sm">
                <button
                  type="button"
                  className="text-primary text-label-sm"
                  onClick={() => setHistoryDetail(null)}
                >
                  ← Voltar à lista
                </button>
                <p className="font-semibold">
                  {historyDetail.sale.code} · {historyDetail.sale.status}
                </p>
                <p className="text-body-sm">
                  {new Date(historyDetail.sale.created_at).toLocaleString("pt-BR")} ·{" "}
                  {historyDetail.sale.operator_name}
                  {historyDetail.sale.customer_name
                    ? ` · ${historyDetail.sale.customer_name}`
                    : ""}
                </p>
                {historyDetail.items.map((it, i) => (
                  <div key={i} className="flex justify-between text-body-sm">
                    <span>
                      {formatQty(Number(it.qty))}x {it.name}
                    </span>
                    <span>{formatBRL(Number(it.line_total))}</span>
                  </div>
                ))}
                <p className="font-bold">Total {formatBRL(Number(historyDetail.sale.total))}</p>
                {historyDetail.sale.status === "completed" ? (
                  <button
                    type="button"
                    className="px-space-md py-space-sm rounded-xl bg-error text-on-error font-semibold"
                    onClick={() => requestCancel(historyDetail.sale.id)}
                  >
                    Cancelar venda
                  </button>
                ) : historyDetail.sale.cancel_reason ? (
                  <p className="text-body-sm text-error">
                    Motivo: {historyDetail.sale.cancel_reason}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="divide-y max-h-[50vh] overflow-y-auto">
                {historyRows.length === 0 ? (
                  <p className="text-on-surface-variant py-space-md text-center">
                    Nenhuma venda encontrada.
                  </p>
                ) : (
                  historyRows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="w-full text-left py-space-sm flex justify-between gap-space-md hover:bg-surface-container-low"
                      onClick={() =>
                        void getSaleFn({ data: { id: r.id } })
                          .then(setHistoryDetail)
                          .catch((e) =>
                            setError(e instanceof Error ? e.message : "Erro ao abrir venda."),
                          )
                      }
                    >
                      <span>
                        <strong>{r.code}</strong> · {r.status}
                        <br />
                        <span className="text-body-sm text-on-surface-variant">
                          {new Date(r.created_at).toLocaleString("pt-BR")} · {r.operator_name}
                        </span>
                      </span>
                      <span className="font-semibold">{formatBRL(Number(r.total))}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </Modal>
        ) : null}

        {moveOpen ? (
          <Modal
            title={moveOpen === "sangria" ? "Sangria" : "Suprimento"}
            onClose={() => setMoveOpen(null)}
            footer={
              <>
                <button type="button" onClick={() => setMoveOpen(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={requestMovement}
                  className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                >
                  Confirmar
                </button>
              </>
            }
          >
            <div className="flex flex-col gap-space-md">
              <MoneyInput label="Valor" value={moveAmount} onChange={setMoveAmount} />
              <label className="flex flex-col gap-space-xs">
                <span className="text-label-sm uppercase text-on-surface-variant">Motivo</span>
                <textarea
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  rows={3}
                  className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
                />
              </label>
              {!canDoCashMovement(user) ? (
                <p className="text-body-sm text-on-surface-variant">
                  Será solicitada autorização de supervisor.
                </p>
              ) : null}
            </div>
          </Modal>
        ) : null}

        {closeOpen && closePreview ? (
          <Modal
            title="Fechamento de caixa"
            onClose={() => setCloseOpen(false)}
            wide
            footer={
              <>
                <button type="button" onClick={() => setCloseOpen(false)}>
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmClose()}
                  className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold"
                >
                  Confirmar fechamento
                </button>
              </>
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-3 gap-space-md mb-space-md">
              <Stat label="Vendas" value={String(closePreview.salesCount)} />
              <Stat label="Dinheiro" value={formatBRL(closePreview.byMethod.cash)} />
              <Stat label="PIX" value={formatBRL(closePreview.byMethod.pix)} />
              <Stat label="Crédito" value={formatBRL(closePreview.byMethod.credit)} />
              <Stat label="Débito" value={formatBRL(closePreview.byMethod.debit)} />
              <Stat label="Fiado" value={formatBRL(closePreview.byMethod.fiado)} />
              <Stat label="Sangrias" value={formatBRL(closePreview.sangrias)} />
              <Stat label="Suprimentos" value={formatBRL(closePreview.suprimentos)} />
              <Stat label="Esperado em dinheiro" value={formatBRL(closePreview.expectedCash)} />
            </div>
            <MoneyInput
              label="Dinheiro contado no caixa"
              value={countedCash}
              onChange={setCountedCash}
            />
            <label className="flex flex-col gap-space-xs mt-space-md">
              <span className="text-label-sm uppercase text-on-surface-variant">Observações</span>
              <textarea
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                rows={2}
                className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
              />
            </label>
            <p className="text-body-sm text-on-surface-variant mt-space-md">
              Diferença:{" "}
              {formatBRL(parseBRL(countedCash || "0") - closePreview.expectedCash)}. Após o
              fechamento, novas vendas neste caixa ficam bloqueadas até nova abertura.
            </p>
          </Modal>
        ) : null}

        {authOpen ? (
          <AuthPrompt
            title={authOpen.title}
            loading={authLoading}
            onCancel={() => setAuthOpen(null)}
            onConfirm={(u, p) => {
              setAuthLoading(true);
              void authOpen
                .onConfirm(u, p)
                .then(() => setAuthOpen(null))
                .catch((e) => setError(e instanceof Error ? e.message : "Autorização falhou."))
                .finally(() => setAuthLoading(false));
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

function HeaderBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-space-md py-space-xs rounded-xl bg-surface-container-high text-label-md font-medium"
    >
      {children}
    </button>
  );
}

function Action({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "p-space-md rounded-xl shadow-sm bg-surface-container-lowest text-label-md font-semibold " +
        (danger ? "text-error" : "")
      }
    >
      {label}
    </button>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between text-body-md text-on-surface-variant">
      <span>{label}</span>
      <span className={accent ? "text-primary font-semibold" : "text-on-surface"}>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-label-sm text-on-surface-variant uppercase">{label}</p>
      <p className="text-headline-sm font-semibold">{value}</p>
    </div>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-space-xs">
      <span className="text-label-sm uppercase text-on-surface-variant">{label}</span>
      <div className="relative">
        <span className="absolute left-space-md top-1/2 -translate-y-1/2 text-outline">R$</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-surface-container-low pl-10 pr-space-md py-space-sm rounded-xl font-bold"
        />
      </div>
    </label>
  );
}

function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-sm flex items-center justify-center p-space-md">
      <div
        className={
          "bg-surface-container-lowest rounded-xl shadow-xl flex flex-col overflow-hidden max-h-[90vh] " +
          (wide ? "w-[760px] max-w-[95vw]" : "w-[520px] max-w-[95vw]")
        }
      >
        <div className="px-space-lg py-space-md bg-surface-container-low flex justify-between items-center">
          <h3 className="text-headline-md">{title}</h3>
          <button type="button" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-space-lg overflow-y-auto">{children}</div>
        {footer ? (
          <div className="px-space-lg py-space-md bg-surface-container-low flex justify-end gap-space-sm">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
