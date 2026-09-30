"use client";
import { useEffect, useRef, useState, FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Wallet,
  LayoutDashboard,
  Users,
  HandCoins,
  Landmark,
  MoreHorizontal,
  Search,
  X,
  ChevronRight,
  ShieldCheck,
  LogOut,
  BookOpen,
  Check,
  Info,
  Clock,
  LockKeyhole,
  RotateCcw,
  Sparkles,
  FileText,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  FileSpreadsheet,
} from "lucide-react";
import { D, interest, payable, businessDate } from "@/domain/finance";
import { Snapshot, empty, sample, rupees, dateLabel, todayLabel } from "./data";
import type {
  SettlementPreviewResult,
  SettlementDecision,
} from "@/application/settle";
import type { ReconciliationResult } from "@/domain/reconciliation";
import type {
  AgreementStatement,
  PoolStatement,
  FinancialPositionSummary,
  ActivityEntry,
} from "@/application/reports";

type Tab =
  | "Overview"
  | "Loans"
  | "Borrowings"
  | "Activity"
  | "Reconciliation"
  | "People"
  | "More";

type Modal =
  | "DISBURSE"
  | "BORROW"
  | "CAPITAL"
  | "PERSON"
  | "REPAY"
  | "REPAY_LENDER"
  | "CHOOSE_REPAY_LOAN"
  | "CHOOSE_REPAY_BORROWING"
  | "EARLY_SETTLE"
  | "REVERSE_PAYMENT"
  | "AGREEMENT_STATEMENT"
  | "POOL_STATEMENT"
  | null;

const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Loans", icon: HandCoins },
  { name: "Borrowings", icon: Landmark },
  { name: "Activity", icon: FileText },
  { name: "Reconciliation", icon: ShieldCheck },
  { name: "People", icon: Users },
  { name: "More", icon: MoreHorizontal },
] as const;
const today = businessDate;
const label = (s: string) =>
  s
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
export default function LedgerApp() {
  const [tab, setTab] = useState<Tab>("Overview"),
    [data, setData] = useState<Snapshot>(empty),
    [demo, setDemo] = useState(false),
    [authenticated, setAuthenticated] = useState(false),
    [configured, setConfigured] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [password, setPassword] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState<Snapshot["loans"][number] | Snapshot["borrowings"][number] | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All loans"),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [quote, setQuote] = useState(""),
    [repayPreview, setRepayPreview] = useState<{
      interest: string;
      principal: string;
      remInterest: string;
      remPrincipal: string;
      settled: boolean;
      overpayment: boolean;
      insufficientCash?: boolean;
    } | null>(null),
    [settlePreview, setSettlePreview] = useState<SettlementPreviewResult | null>(null),
    [settleLoading, setSettleLoading] = useState(false),
    [settleDecision, setSettleDecision] = useState<SettlementDecision>("SUGGESTED"),
    [manualInterest, setManualInterest] = useState(""),
    [settleReason, setSettleReason] = useState(""),
    [settleConfirmed, setSettleConfirmed] = useState(false),
    [settleDate, setSettleDate] = useState(today()),
    [personId, setPersonId] = useState(""),
    // Phase 6 State
    [activityList, setActivityList] = useState<ActivityEntry[]>([]),
    [activityLoading, setActivityLoading] = useState(false),
    [activitySearch, setActivitySearch] = useState(""),
    [activityFrom, setActivityFrom] = useState(""),
    [activityTo, setActivityTo] = useState(""),
    [activityDirection, setActivityDirection] = useState<"ALL" | "IN" | "OUT">("ALL"),
    [activityEntityType, setActivityEntityType] = useState<"ALL" | "LOAN" | "BORROWING" | "EQUITY">("ALL"),
    [financialPosition, setFinancialPosition] = useState<FinancialPositionSummary | null>(null),
    [reconcileReport, setReconcileReport] = useState<ReconciliationResult | null>(null),
    [reconcileLoading, setReconcileLoading] = useState(false),
    [statementData, setStatementData] = useState<AgreementStatement | null>(null),
    [poolStatementData, setPoolStatementData] = useState<PoolStatement | null>(null),
    [statementLoading, setStatementLoading] = useState(false),
    [reversalPayment, setReversalPayment] = useState<{
      id: string;
      amount: string;
      principal: string;
      interest: string;
      date: string;
      reference?: string | null;
      agreementId: string;
      agreementName: string;
      agreementType: "LOAN" | "BORROWING";
    } | null>(null),
    [reversalReason, setReversalReason] = useState(""),
    [reversalDate, setReversalDate] = useState(today()),
    [reversalConfirmed, setReversalConfirmed] = useState(false),
    [reversalLoading, setReversalLoading] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null),
    form = useRef<HTMLFormElement>(null),
    submission = useRef<{ key: string; input: Record<string, unknown> | null }>(
      { key: "", input: null },
    ),
    reversalSubmission = useRef<{
      key: string;
      input: Record<string, unknown> | null;
    }>({ key: "", input: null });

  async function loadActivity() {
    if (!authenticated || demo) return;
    setActivityLoading(true);
    try {
      const params = new URLSearchParams();
      if (activityFrom) params.set("from", activityFrom);
      if (activityTo) params.set("to", activityTo);
      if (activityDirection !== "ALL") params.set("direction", activityDirection);
      if (activityEntityType !== "ALL") params.set("entityType", activityEntityType);
      if (activitySearch) params.set("search", activitySearch);

      const res = await fetch(`/api/statements?type=activity&${params.toString()}`);
      if (res.ok) {
        const d = await res.json();
        setActivityList(d);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActivityLoading(false);
    }
  }

  async function loadFinancialPosition() {
    if (!authenticated || demo) return;
    try {
      const res = await fetch("/api/statements?type=position");
      if (res.ok) {
        const d = await res.json();
        setFinancialPosition(d);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function loadReconciliation() {
    if (!authenticated || demo) return;
    setReconcileLoading(true);
    try {
      const res = await fetch("/api/reconciliation");
      if (res.ok) {
        const d = await res.json();
        setReconcileReport(d);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReconcileLoading(false);
    }
  }

  async function openAgreementStatement(agreementId: string, agreementType: "LOAN" | "BORROWING") {
    setStatementLoading(true);
    setStatementData(null);
    setModal("AGREEMENT_STATEMENT");
    try {
      const paramType = agreementType === "LOAN" ? "loan" : "borrowing";
      const res = await fetch(`/api/statements?type=${paramType}&id=${agreementId}`);
      if (res.ok) {
        const d = await res.json();
        setStatementData(d);
      } else {
        const err = await res.json();
        setError(err.error || "Failed to load statement");
      }
    } catch (e: any) {
      setError(e.message || "Failed to load statement");
    } finally {
      setStatementLoading(false);
    }
  }

  async function openPoolStatement() {
    setStatementLoading(true);
    setPoolStatementData(null);
    setModal("POOL_STATEMENT");
    try {
      const res = await fetch("/api/statements?type=pool");
      if (res.ok) {
        const d = await res.json();
        setPoolStatementData(d);
      } else {
        const err = await res.json();
        setError(err.error || "Failed to load pool statement");
      }
    } catch (e: any) {
      setError(e.message || "Failed to load pool statement");
    } finally {
      setStatementLoading(false);
    }
  }

  function openReversal(
    payment: {
      id: string;
      amount: string;
      principal: string;
      interest: string;
      date: string;
      reference?: string | null;
    },
    agreement: { id: string; name: string },
    agreementType: "LOAN" | "BORROWING",
  ) {
    setReversalPayment({
      ...payment,
      agreementId: agreement.id,
      agreementName: agreement.name,
      agreementType,
    });
    setReversalReason("");
    setReversalDate(today());
    setReversalConfirmed(false);
    setFormError("");
    setUncertain(false);
    reversalSubmission.current = { key: crypto.randomUUID(), input: null };
    setModal("REVERSE_PAYMENT");
  }

  async function handleReverseSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reversalPayment) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setFormError("You are offline. A live connection is required for financial operations.");
      return;
    }
    if (!reversalConfirmed) {
      setFormError("Please confirm this reversal before proceeding.");
      return;
    }
    if (reversalReason.trim().length < 5) {
      setFormError("An explanatory reason of at least 5 characters is required.");
      return;
    }

    setReversalLoading(true);
    setFormError("");

    if (!reversalSubmission.current.key) {
      reversalSubmission.current.key = crypto.randomUUID();
    }
    const input = reversalSubmission.current.input || {
      paymentId: reversalPayment.id,
      reversalDate,
      reason: reversalReason.trim(),
      idempotencyKey: reversalSubmission.current.key,
    };
    reversalSubmission.current.input = input;

    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "REVERSE_PAYMENT",
          input,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        if (res.status < 500) {
          reversalSubmission.current = { key: crypto.randomUUID(), input: null };
          setUncertain(false);
        } else {
          setUncertain(true);
        }
        throw new Error(result.error || "Failed to reverse payment.");
      }

      reversalSubmission.current = { key: "", input: null };
      setUncertain(false);
      setNotice(
        `Payment of ${rupees(result.amountReversed)} reversed successfully. Balances and audit log updated.`,
      );
      setModal(null);
      setSelected(null);
      await refresh();
      if (tab === "Activity") await loadActivity();
      if (tab === "Reconciliation") await loadReconciliation();
    } catch (err: any) {
      if (reversalSubmission.current.input) {
        setUncertain(true);
      }
      setFormError(err.message || "Failed to reverse payment.");
    } finally {
      setReversalLoading(false);
    }
  }

  async function downloadCsv(url: string, filename: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        setError(err.error || "Failed to download CSV");
        return;
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
      setNotice(`Exported ${filename} successfully.`);
    } catch (e: any) {
      setError(e.message || "Failed to export CSV");
    }
  }

  async function refresh() {
    const r = await fetch("/api/snapshot", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) {
      if (r.status === 401) setAuthenticated(false);
      throw new Error(d.error);
    }
    setData(d);
    setError("");
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/session");
        const s = await r.json();
        if (!active) return;
        setConfigured(s.configured);
        setAuthenticated(s.authenticated);
        if (s.authenticated) await refresh();
      } catch {
        if (active) setError("Unable to connect. Please reload.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (modal || selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal, selected]);
  useEffect(() => {
    if (!selected) return;
    const updatedLoan = data.loans.find((l) => l.id === selected.id);
    if (updatedLoan) {
      setSelected(updatedLoan);
      return;
    }
    const updatedBorrowing = data.borrowings.find((b) => b.id === selected.id);
    if (updatedBorrowing) {
      setSelected(updatedBorrowing);
      return;
    }
  }, [data]);
  useEffect(() => {
    if (!authenticated || demo) return;
    if (tab === "Activity") {
      loadActivity();
      loadFinancialPosition();
    } else if (tab === "Reconciliation") {
      loadReconciliation();
    }
  }, [tab, authenticated, activityFrom, activityTo, activityDirection, activityEntityType, activitySearch]);
  function open(m: Modal) {
    if (demo) {
      setNotice(
        "Sample ledger is read-only. Exit sample mode to use your own ledger.",
      );
      return;
    }
    if (!authenticated) {
      setNotice("Sign in to record financial activity.");
      return;
    }
    setModal(m);
    setSelected(null);
    setFormError("");
    setUncertain(false);
    setQuote("");
    setRepayPreview(null);
    setSettlePreview(null);
    setSettleConfirmed(false);
    setPersonId("");
    submission.current = { key: crypto.randomUUID(), input: null };
  }
  function openRepay(l: Snapshot["loans"][number]) {
    if (demo) {
      setNotice(
        "Sample ledger is read-only. Exit sample mode to use your own ledger.",
      );
      return;
    }
    if (!authenticated) {
      setNotice("Sign in to record financial activity.");
      return;
    }
    setSelected(l);
    setModal("REPAY");
    setFormError("");
    setUncertain(false);
    setQuote("");
    setRepayPreview(null);
    setSettlePreview(null);
    setSettleConfirmed(false);
    submission.current = { key: crypto.randomUUID(), input: null };
  }
  function openRepayLender(b: Snapshot["borrowings"][number]) {
    if (demo) {
      setNotice(
        "Sample ledger is read-only. Exit sample mode to use your own ledger.",
      );
      return;
    }
    if (!authenticated) {
      setNotice("Sign in to record financial activity.");
      return;
    }
    setSelected(b);
    setModal("REPAY_LENDER");
    setFormError("");
    setUncertain(false);
    setQuote("");
    setRepayPreview(null);
    setSettlePreview(null);
    setSettleConfirmed(false);
    submission.current = { key: crypto.randomUUID(), input: null };
  }
  function openEarlySettle(
    agreement: Snapshot["loans"][number] | Snapshot["borrowings"][number],
  ) {
    if (demo) {
      setNotice(
        "Sample ledger is read-only. Exit sample mode to use your own ledger.",
      );
      return;
    }
    if (!authenticated) {
      setNotice("Sign in to record financial activity.");
      return;
    }
    setSelected(agreement);
    setModal("EARLY_SETTLE");
    setFormError("");
    setUncertain(false);
    setQuote("");
    setRepayPreview(null);
    setSettlePreview(null);
    setSettleDecision("SUGGESTED");
    setManualInterest("");
    setSettleReason("");
    setSettleConfirmed(false);
    setSettleDate(today());
    submission.current = { key: crypto.randomUUID(), input: null };
  }
  function promptRepay() {
    if (demo) {
      setNotice(
        "Sample ledger is read-only. Exit sample mode to use your own ledger.",
      );
      return;
    }
    if (!authenticated) {
      setNotice("Sign in to record financial activity.");
      return;
    }
    const active = data.loans.filter((l) => l.status === "ACTIVE");
    if (active.length === 0) {
      setNotice("No active loans require repayment.");
      return;
    }
    if (active.length === 1) {
      openRepay(active[0]);
      return;
    }
    setModal("CHOOSE_REPAY_LOAN");
    setSelected(null);
  }
  function promptRepayLender() {
    if (demo) {
      setNotice(
        "Sample ledger is read-only. Exit sample mode to use your own ledger.",
      );
      return;
    }
    if (!authenticated) {
      setNotice("Sign in to record financial activity.");
      return;
    }
    const active = (data.borrowings || []).filter((b) => b.status === "ACTIVE");
    if (active.length === 0) {
      setNotice("No active borrowings require repayment.");
      return;
    }
    if (active.length === 1) {
      openRepayLender(active[0]);
      return;
    }
    setModal("CHOOSE_REPAY_BORROWING");
    setSelected(null);
  }
  function close() {
    if (busy || uncertain || reversalLoading) return;
    setModal(null);
    setSelected(null);
    setRepayPreview(null);
    setSettlePreview(null);
    setSettleConfirmed(false);
    setReversalPayment(null);
    setReversalConfirmed(false);
    setStatementData(null);
    setPoolStatementData(null);
  }
  useEffect(() => {
    if (modal !== "EARLY_SETTLE" || !selected) {
      return;
    }
    let active = true;
    setSettleLoading(true);
    setFormError("");
    const isBorrowingAgreement = Boolean(
      selected && data.borrowings.some((b) => b.id === selected.id),
    );
    const agreementType = isBorrowingAgreement ? "BORROWING" : "LOAN";
    fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "PREVIEW_SETTLE",
        input: {
          agreementId: selected.id,
          agreementType,
          settlementDate: settleDate,
        },
      }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!active) return;
        if (!r.ok) {
          setFormError(d.error || "Unable to fetch early settlement preview.");
          setSettlePreview(null);
        } else {
          setSettlePreview(d);
          setFormError("");
        }
      })
      .catch((err) => {
        if (!active) return;
        setFormError(err.message || "Failed to load settlement preview.");
        setSettlePreview(null);
      })
      .finally(() => {
        if (active) setSettleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [modal, selected?.id, settleDate, data.borrowings]);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const s = await r.json();
      if (!r.ok) throw new Error(s.error);
      setAuthenticated(true);
      setPassword("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    setAuthenticated(false);
    setData(empty);
    setTab("Overview");
  }
  function enterDemo() {
    setDemo(true);
    setData(sample());
    setError("");
    setNotice("Sample data only. No money is moved and no records are saved.");
  }
  async function exitDemo() {
    setDemo(false);
    setData(empty);
    setNotice("");
    if (authenticated)
      try {
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
  }
  function updateQuote() {
    if (!form.current) return;
    if (modal === "DISBURSE" || modal === "BORROW") {
      const f = Object.fromEntries(new FormData(form.current));
      try {
        setQuote(
          payable(
            interest(
              String(f.principal),
              String(f.rate),
              f.interestMethod as "ANNUAL_ACTUAL_365",
              String(f.startDate),
              String(f.dueDate),
            ),
          ).toFixed(0),
        );
      } catch {
        setQuote("");
      }
    } else if (
      (modal === "REPAY" || modal === "REPAY_LENDER") &&
      selected &&
      "remainingPrincipal" in selected
    ) {
      const f = Object.fromEntries(new FormData(form.current));
      try {
        const amtStr = String(f.amount || "").trim();
        if (!amtStr) {
          setRepayPreview(null);
          return;
        }
        const amt = new D(amtStr);
        const remInt = new D(selected.remainingInterest);
        const remPrin = new D(selected.remainingPrincipal);
        const intPart = D.min(remInt, amt);
        const prinPart = D.min(remPrin, D.max(new D(0), amt.minus(intPart)));
        const newRemInt = remInt.minus(intPart);
        const newRemPrin = remPrin.minus(prinPart);
        const availPool = new D(data.available);
        setRepayPreview({
          interest: intPart.toFixed(0),
          principal: prinPart.toFixed(0),
          remInterest: newRemInt.toFixed(0),
          remPrincipal: newRemPrin.toFixed(0),
          settled: newRemInt.isZero() && newRemPrin.isZero(),
          overpayment: amt.gt(remInt.plus(remPrin)),
          insufficientCash: modal === "REPAY_LENDER" && amt.gt(availPool),
        });
      } catch {
        setRepayPreview(null);
      }
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (demo || !modal) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setFormError("You are offline. A live connection is required for financial operations.");
      return;
    }
    setBusy(true);
    setFormError("");
    let input = submission.current.input;
    if (!input) {
      if (modal === "EARLY_SETTLE") {
        if (!settlePreview) {
          setBusy(false);
          setFormError("Settlement preview quote is required.");
          return;
        }
        if (!settleReason.trim()) {
          setBusy(false);
          setFormError(
            "An explanatory reason is mandatory for early settlement.",
          );
          return;
        }
        if (!settleConfirmed) {
          setBusy(false);
          setFormError("Please confirm the early settlement terms.");
          return;
        }
        let manualVal: string | undefined;
        if (settleDecision === "MANUAL") {
          if (!manualInterest.trim()) {
            setBusy(false);
            setFormError("Manual final total interest must be entered.");
            return;
          }
          manualVal = manualInterest.trim();
        }
        const isBorrowingAgreement = Boolean(
          selected && data.borrowings.some((b) => b.id === selected.id),
        );
        const agreementType = isBorrowingAgreement ? "BORROWING" : "LOAN";
        input = {
          agreementId: selected!.id,
          agreementType,
          settlementDate: settleDate,
          decision: settleDecision,
          ...(manualVal !== undefined
            ? { manualFinalTotalInterest: manualVal }
            : {}),
          reason: settleReason.trim(),
          quoteBalanceHash: settlePreview.quoteBalanceHash,
          idempotencyKey: submission.current.key,
        };
      } else {
        input = Object.fromEntries(new FormData(form.current!));
        if (modal === "PERSON" && !input.personId) delete input.personId;
        input.idempotencyKey = submission.current.key;
      }
      submission.current.input = input;
    }
    try {
      const commandType = modal === "EARLY_SETTLE" ? "SETTLE" : modal;
      const r = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: commandType, input }),
      });
      const result = await r.json();
      if (!r.ok) {
        if (r.status < 500) {
          submission.current = { key: crypto.randomUUID(), input: null };
          setUncertain(false);
        } else setUncertain(true);
        throw new Error(result.error);
      }
      setUncertain(false);
      submission.current = { key: crypto.randomUUID(), input: null };
      setModal(null);
      setNotice(
        `${modal === "EARLY_SETTLE"
          ? `${selected && data.borrowings.some((b) => b.id === selected.id) ? "Borrowing" : "Loan"} settled early and closed!`
          : modal === "DISBURSE"
            ? "Loan disbursed"
            : modal === "BORROW"
              ? "Borrowing recorded"
              : modal === "REPAY"
                ? (result.settled
                  ? "Repayment recorded. Loan settled!"
                  : "Repayment recorded")
                : modal === "REPAY_LENDER"
                  ? (result.settled
                    ? "Lender repayment recorded. Borrowing settled!"
                    : "Lender repayment recorded")
                  : modal === "CAPITAL"
                    ? "Capital added"
                    : "Person saved"
        }. ${result.warnings?.join(" ") ?? ""}`,
      );
      try {
        await refresh();
      } catch {
        setError(
          "Saved successfully, but the latest ledger could not load. Refresh to see it.",
        );
      }
    } catch (e) {
      if (submission.current.input) setUncertain(true);
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const overdue = data.loans.filter(
    (l) => l.status === "ACTIVE" && l.due < today(),
  );
  const due = data.loans
    .filter((l) => l.status === "ACTIVE")
    .sort((a, b) => a.due.localeCompare(b.due));
  const loans = data.loans.filter(
    (l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "All loans" ||
        (filter === "Overdue" && l.status === "ACTIVE" && l.due < today()) ||
        (filter === "Active" && l.status === "ACTIVE") ||
        (filter === "Settled" && l.status === "CLOSED")),
  );
  const isWelcome = !authenticated && !demo;
  const balanceDisplay = (amount: string) => {
    if (error || (!authenticated && !demo)) return "Unavailable";
    return rupees(amount);
  };
  const borrowings = (data.borrowings || []).filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );
  const isBorrowing = Boolean(
    selected && data.borrowings.some((b) => b.id === selected.id),
  );
  function borrowingRows(list: Snapshot["borrowings"]) {
    return list.map((b) => (
      <button
        className="loan-row"
        key={b.id}
        onClick={() => {
          setSelected(b);
          setModal(null);
        }}
      >
        <span className="avatar">
          {b.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </span>
        <span className="row-main">
          <strong>{b.name}</strong>
          <span>Due {dateLabel(b.due)}</span>
        </span>
        <span className="row-end">
          <strong>{rupees(b.remainingPrincipal ?? b.principal)}</strong>
          <span
            className={
              b.status === "CLOSED"
                ? "badge settled"
                : b.due < today()
                  ? "badge overdue"
                  : "badge"
            }
          >
            {b.status === "CLOSED"
              ? "Settled"
              : b.due < today()
                ? "Overdue"
                : "Active"}
          </span>
        </span>
        <ChevronRight size={17} />
      </button>
    ));
  }
  function loanRows(list: Snapshot["loans"]) {
    return list.map((l) => (
      <button
        className="loan-row"
        key={l.id}
        onClick={() => {
          setSelected(l);
          setModal(null);
        }}
      >
        <span className="avatar">
          {l.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </span>
        <span className="row-main">
          <strong>{l.name}</strong>
          <span>Due {dateLabel(l.due)}</span>
        </span>
        <span className="row-end">
          <strong>{rupees(l.remainingPrincipal ?? l.principal)}</strong>
          <span
            className={
              l.status === "CLOSED"
                ? "badge settled"
                : l.due < today()
                  ? "badge overdue"
                  : "badge"
            }
          >
            {l.status === "CLOSED"
              ? "Settled"
              : l.due < today()
                ? "Overdue"
                : "Active"}
          </span>
        </span>
        <ChevronRight size={17} />
      </button>
    ));
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-symbol">
            <Landmark size={23} />
          </span>
          <span>
            aure<span className="brand-sub">PERSONAL LEDGER</span>
          </span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.name}
              className={tab === n.name ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(n.name);
                setSearch("");
              }}
            >
              <n.icon size={20} />
              <span>{n.name}</span>
              {n.name === "Loans" && data.loans.length > 0 && (
                <small>{data.loans.length}</small>
              )}
              {n.name === "Borrowings" && (data.borrowings || []).length > 0 && (
                <small>{data.borrowings.length}</small>
              )}
              {n.name === "Reconciliation" && reconcileReport && (
                <small style={{ color: reconcileReport.healthy ? "#6ee7b7" : "#fca5a5" }}>
                  {reconcileReport.healthy ? "✓" : "!"}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={21} />
          <strong>Every rupee, accounted for.</strong>
          <p>
            One capital pool.
            <br />A clear trail of every movement.
          </p>
        </div>
        <div className="profile">
          <span className="profile-icon">A</span>
          <div>
            <strong>Personal workspace</strong>
            <span>
              {demo
                ? "Sample ledger"
                : authenticated
                  ? "Owner access"
                  : "Private ledger"}
            </span>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span className="mobile-brand">
            <Landmark size={20} /> aure
          </span>
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{tab}</strong>
          </span>
          <div className="topbar-right">
            <span className="date-top" suppressHydrationWarning>
              {todayLabel()}
            </span>
            <span className="privacy">
              <LockKeyhole size={13} />
              {demo ? "Sample" : "Private"}
            </span>
          </div>
        </header>
        <main>
          {demo && (
            <div className="demo-bar">
              <span>
                <Info size={16} /> You’re exploring a sample ledger. All data is
                illustrative.
              </span>
              <button onClick={exitDemo}>
                Exit sample <X size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
              {authenticated && (
                <button
                  onClick={() => refresh().catch((e) => setError(e.message))}
                >
                  Refresh
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="message" role="status">
              {notice}
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR MONEY, IN PERSPECTIVE</div>
              <h1>{tab === "Overview" ? "Capital overview" : tab}</h1>
              <p>
                {tab === "Overview"
                  ? "A clear view of what’s available, lent and owed."
                  : tab === "Loans"
                    ? "Your borrower ledger, from disbursement to due date."
                    : tab === "Borrowings"
                      ? "Money you borrow stays in its own ledger."
                      : tab === "Activity"
                        ? "Dated, searchable activity ledger, statements & reports."
                        : tab === "Reconciliation"
                          ? "Read-only mathematical audit of financial integrity."
                          : tab === "People"
                            ? "One person. Every financial relationship."
                            : "Your workspace and accounting conventions."}
              </p>
            </div>
            {!isWelcome && tab !== "More" && tab !== "Reconciliation" && (
              <button
                className="primary"
                onClick={() =>
                  tab === "Activity"
                    ? openPoolStatement()
                    : open(
                      tab === "People"
                        ? "PERSON"
                        : tab === "Borrowings"
                          ? "BORROW"
                          : "DISBURSE",
                    )
                }
              >
                {tab === "Activity" ? (
                  <>
                    <Wallet size={18} />
                    Pool statement
                  </>
                ) : (
                  <>
                    <Plus size={18} />
                    {tab === "People"
                      ? "Add person"
                      : tab === "Borrowings"
                        ? "Record borrowing"
                        : "Disburse loan"}
                  </>
                )}
              </button>
            )}
            {!isWelcome && tab === "Reconciliation" && (
              <button
                className="secondary"
                onClick={loadReconciliation}
                disabled={reconcileLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
              >
                <RefreshCw size={17} className={reconcileLoading ? "spin" : ""} />
                Re-verify now
              </button>
            )}
          </div>
          {loading ? (
            <div className="panel empty-state">Loading your workspace…</div>
          ) : isWelcome ? (
            <div className="welcome-grid">
              <section className="welcome-card">
                <div className="eyebrow">A PRIVATE SPACE FOR YOUR CAPITAL</div>
                <h2>
                  Clarity starts
                  <br />
                  with your ledger.
                </h2>
                <p>
                  Track what you lend, what you borrow, and every rupee in
                  between.
                </p>
                <div className="welcome-features">
                  <span>
                    <Wallet size={19} /> One shared capital pool
                  </span>
                  <span>
                    <BookOpen size={19} /> Separate lending & borrowing
                  </span>
                  <span>
                    <ShieldCheck size={19} /> Traceable financial history
                  </span>
                </div>
                <button className="sample-link" onClick={enterDemo}>
                  Explore the sample ledger <ArrowRight size={18} />
                </button>
              </section>
              <section className="panel signin">
                <div className="icon-tile">
                  <LockKeyhole size={24} />
                </div>
                <h2>
                  {configured
                    ? "Welcome back"
                    : "Your ledger is ready for setup"}
                </h2>
                <p>
                  {configured
                    ? "Sign in to access your financial records."
                    : "Connect PostgreSQL and configure your owner password to start recording transactions."}
                </p>
                {configured ? (
                  <form onSubmit={login}>
                    <label>
                      Owner password
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                    <button className="primary full" disabled={busy}>
                      {busy ? "Signing in…" : "Unlock workspace"}
                      <ArrowRight size={18} />
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="setup-steps">
                      <span>
                        <b>1</b> Configure the environment
                      </span>
                      <span>
                        <b>2</b> Apply the database migration
                      </span>
                      <span>
                        <b>3</b> Sign in and add your capital
                      </span>
                    </div>
                    <p className="small">
                      The included README provides the exact setup commands. You
                      can explore the interface with sample data now.
                    </p>
                    <button className="secondary full" onClick={enterDemo}>
                      Explore sample ledger <ArrowRight size={17} />
                    </button>
                  </>
                )}
              </section>
            </div>
          ) : (
            <>
              {tab === "Overview" && (
                <>
                  <section className="stats-grid">
                    <div className="capital-card">
                      <div className="card-label">
                        <span>Available capital</span>
                        <Wallet size={20} />
                      </div>
                      <div className="capital-amount">
                        {balanceDisplay(data.available)}
                      </div>
                      <p>Global pool cash ready to deploy</p>
                      <div className="capital-bottom">
                        <span>GLOBAL CAPITAL POOL</span>
                        <button onClick={() => open("CAPITAL")}>
                          <Plus size={15} /> Add capital
                        </button>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon blue">
                        <ArrowUpRight size={20} />
                      </div>
                      <span>Outstanding loan principal</span>
                      <strong>{balanceDisplay(data.lent)}</strong>
                      <small>
                        {error
                          ? "— active loans · Lent to borrowers"
                          : `${data.loans.filter((l) => l.status === "ACTIVE").length} active ${
                              data.loans.filter((l) => l.status === "ACTIVE").length === 1 ? "loan" : "loans"
                            } · Lent to borrowers`}
                      </small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon orange">
                        <Landmark size={19} />
                      </div>
                      <span>Outstanding borrowing principal</span>
                      <strong>{balanceDisplay(data.borrowed)}</strong>
                      <small>
                        {error
                          ? "— active borrowings · Owed to lenders"
                          : `${(data.borrowings || []).filter((b) => b.status === "ACTIVE").length} active ${
                              (data.borrowings || []).filter((b) => b.status === "ACTIVE").length === 1
                                ? "borrowing"
                                : "borrowings"
                            } · Owed to lenders`}
                      </small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon green">
                        <ArrowDownLeft size={20} />
                      </div>
                      <span>Borrower interest received</span>
                      <strong>{balanceDisplay(data.interestEarned)}</strong>
                      <small>Earned income · Separate from returned principal</small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon purple">
                        <RotateCcw size={19} />
                      </div>
                      <span>Lender interest paid</span>
                      <strong>{balanceDisplay(data.lenderInterestPaid || "0")}</strong>
                      <small>Contractual interest paid · Separate from principal repaid</small>
                    </div>
                  </section>
                  <div
                    className="info-note"
                    style={{
                      margin: "0 28px 18px",
                      display: "flex",
                      gap: "10px",
                      alignItems: "center",
                      borderLeft: "3px solid var(--gold)",
                    }}
                  >
                    <Info size={18} style={{ flexShrink: 0, color: "var(--gold)" }} />
                    <span>
                      <strong>Accounting Guardrail:</strong> Returned principal is capital recovery, not income. Only contractual borrower interest received constitutes income.
                    </span>
                  </div>
                  <section className="quick-actions">
                    <span>QUICK ACTIONS</span>
                    <div className="action-row">
                      <button className="action-primary" onClick={() => open("DISBURSE")}>
                        <HandCoins size={18} /> Add loan{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button className="action-primary" onClick={promptRepay}>
                        <RotateCcw size={18} /> Record repayment{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button onClick={() => open("BORROW")}>
                        <Landmark size={18} /> Record borrowing{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button onClick={promptRepayLender}>
                        <ArrowDownLeft size={18} /> Repay lender{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button onClick={openPoolStatement}>
                        <Wallet size={18} /> Pool statement{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button onClick={() => setTab("Activity")}>
                        <FileText size={18} /> Activity ledger{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button onClick={() => setTab("Reconciliation")}>
                        <ShieldCheck size={18} /> Integrity check{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button onClick={() => open("CAPITAL")}>
                        <Plus size={18} /> Capital addition{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button onClick={() => open("PERSON")}>
                        <Users size={18} /> Add a person{" "}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </section>
                  <div className="content-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Upcoming & overdue</h2>
                        <button
                          className="text-button"
                          onClick={() => setTab("Loans")}
                        >
                          All loans <ArrowRight size={15} />
                        </button>
                      </div>
                      {overdue.length > 0 && (
                        <div className="overdue-summary">
                          <Clock size={17} />
                          <span>
                            {overdue.length}{" "}
                            {overdue.length === 1 ? "loan needs" : "loans need"}{" "}
                            your attention
                          </span>
                          <span>No late fees added</span>
                        </div>
                      )}
                      {due.length ? (
                        loanRows(due.slice(0, 4))
                      ) : (
                        <div className="empty-state">
                          <HandCoins size={31} />
                          <h3>Your first loan starts here</h3>
                          <p>
                            Add your capital and a borrower, then record a
                            disbursement.
                          </p>
                          <button
                            className="secondary"
                            onClick={() =>
                              open(data.people.length ? "DISBURSE" : "PERSON")
                            }
                          >
                            {data.people.length
                              ? "Disburse a loan"
                              : "Add a borrower"}
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      )}
                    </section>
                    <section className="panel pool-panel">
                      <div className="panel-heading">
                        <h2>Capital at a glance</h2>
                        <Wallet size={19} />
                      </div>
                      <div className="allocation-visual">
                        <div>
                          <span>Available</span>
                          <strong>{balanceDisplay(data.available)}</strong>
                        </div>
                        <div>
                          <span>Lent out</span>
                          <strong>{balanceDisplay(data.lent)}</strong>
                        </div>
                      </div>
                      <div className="allocation-bar">
                        <span
                          style={{
                            width:
                              error ||
                              new D(data.available)
                                .plus(data.lent)
                                .isZero()
                                ? "0%"
                                : new D(data.available)
                                  .div(new D(data.available).plus(data.lent))
                                  .mul(100)
                                  .toFixed(2) + "%",
                          }}
                        />
                      </div>
                      <p className="pool-explanation">
                        All capital works together. Borrower loans are never
                        tied to individual lenders.
                      </p>
                      <button
                        type="button"
                        className="secondary"
                        style={{
                          marginTop: "8px",
                          marginBottom: "12px",
                          width: "100%",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          fontSize: "13px",
                        }}
                        onClick={openPoolStatement}
                      >
                        <FileSpreadsheet size={15} /> View Full Pool Statement
                      </button>
                      <div className="pool-foot">
                        <ShieldCheck size={17} /> Every movement has a source
                      </div>
                    </section>
                  </div>
                  <section className="panel activity-panel">
                    <div className="panel-heading">
                      <h2>Recent capital movements</h2>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <button
                          type="button"
                          className="text-btn"
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--gold)",
                            cursor: "pointer",
                            fontSize: "12px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: 0,
                          }}
                          onClick={() => setTab("Activity")}
                        >
                          View Activity Ledger <ChevronRight size={14} />
                        </button>
                        <span className="muted">
                          {data.activity.length
                            ? `${data.activity.length} latest entries`
                            : "A fresh start"}
                        </span>
                      </div>
                    </div>
                    {data.activity.length ? (
                      <div className="activity-table">
                        <div className="table-head">
                          <span>Transaction</span>
                          <span>Date</span>
                          <span>Reference</span>
                          <span>Amount</span>
                        </div>
                        {data.activity.slice(0, 6).map((a) => (
                          <div className="activity-row" key={a.id}>
                            <div>
                              <span
                                className={
                                  "movement-icon " +
                                  (a.direction === "IN" ? "green" : "blue")
                                }
                              >
                                {a.direction === "IN" ? (
                                  <ArrowDownLeft size={18} />
                                ) : (
                                  <ArrowUpRight size={18} />
                                )}
                              </span>
                              <span className="activity-title">
                                <strong>
                                  {label(a.type.replace(/_(IN|OUT)$/, ""))}
                                </strong>
                                <small>
                                  {a.direction === "IN"
                                    ? "Capital received"
                                    : "Capital deployed"}
                                </small>
                              </span>
                            </div>
                            <span>{dateLabel(a.date)}</span>
                            <span className="reference">
                              {a.reference || "—"}
                            </span>
                            <strong
                              className={
                                a.direction === "IN" ? "in-amount" : ""
                              }
                            >
                              {a.direction === "IN" ? "+" : "−"}
                              {rupees(a.amount)}
                            </strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state compact">
                        <p>
                          Your capital history will appear here as you record
                          transactions.
                        </p>
                      </div>
                    )}
                  </section>
                </>
              )}
              {tab === "Loans" && (
                <section className="panel">
                  <div className="list-toolbar">
                    <label className="search">
                      <Search size={18} />
                      <input
                        aria-label="Search borrowers"
                        placeholder="Search borrowers…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter loans"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option>All loans</option>
                      <option>Active</option>
                      <option>Settled</option>
                      <option>Overdue</option>
                    </select>
                  </div>
                  {loans.length ? (
                    loanRows(loans)
                  ) : (
                    <div className="empty-state">
                      <HandCoins size={30} />
                      <h3>
                        {search ? "No matching loans" : "No loans to show"}
                      </h3>
                      <p>
                        {search
                          ? "Try a different borrower name."
                          : "Disburse your first loan after adding capital and a borrower."}
                      </p>
                    </div>
                  )}
                </section>
              )}
              {tab === "Borrowings" &&
                (data.borrowings && data.borrowings.length > 0 ? (
                  <section className="panel">
                    <div className="list-toolbar">
                      <label className="search">
                        <Search size={18} />
                        <input
                          aria-label="Search lenders"
                          placeholder="Search lenders…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <span className="muted">
                        {borrowings.length}{" "}
                        {borrowings.length === 1 ? "borrowing" : "borrowings"}
                      </span>
                    </div>
                    <div className="loan-list">
                      {borrowingRows(borrowings)}
                    </div>
                  </section>
                ) : (
                  <section className="panel empty-state">
                    <Landmark size={34} />
                    <h2>Your lender ledger</h2>
                    <p>
                      Money you borrow stays in its own separate ledger.
                    </p>
                    <div className="info-note">
                      Borrowed principal increases the shared pool. It will never
                      count as income or be tied to a specific borrower loan.
                    </div>
                    {!isWelcome && (
                      <button
                        className="primary"
                        onClick={() => open("BORROW")}
                      >
                        <Plus size={18} /> Record borrowing
                      </button>
                    )}
                  </section>
                ))}
              {tab === "People" && (
                <section className="panel">
                  <div className="list-toolbar">
                    <label className="search">
                      <Search size={18} />
                      <input
                        aria-label="Search people"
                        placeholder="Search people…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <span className="muted">{data.people.length} people</span>
                  </div>
                  {data.people
                    .filter((p) =>
                      p.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p) => (
                      <div className="person-row" key={p.id}>
                        <span className="avatar">
                          {p.name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <div className="row-main">
                          <strong>{p.name}</strong>
                          <span>{p.phone || "No phone added"}</span>
                        </div>
                        <span className="badge">
                          {p.borrowerId && p.lenderId
                            ? "Borrower & lender"
                            : p.borrowerId
                              ? "Borrower"
                              : "Lender"}
                        </span>
                      </div>
                    ))}
                  {!data.people.length && (
                    <div className="empty-state">
                      <Users size={32} />
                      <h3>Keep your people together</h3>
                      <p>
                        Add a person once, then give them a borrower role, a
                        lender role, or both.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => open("PERSON")}
                      >
                        Add a person <Plus size={17} />
                      </button>
                    </div>
                  )}
                </section>
              )}
              {tab === "Activity" && (
                <section className="panel activity-container">
                  <div className="panel-header-action">
                    <div>
                      <div className="eyebrow">CHRONOLOGICAL LEDGER & POSITION</div>
                      <h2>Dated Activity Ledger</h2>
                      <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: "14px" }}>
                        Dated financial history across disbursements, borrowings, repayments, capital additions, and safe reversals.
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          loadActivity();
                          loadFinancialPosition();
                        }}
                        disabled={activityLoading}
                        style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                      >
                        <RefreshCw size={15} className={activityLoading ? "spin" : ""} /> Refresh
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          const params = new URLSearchParams();
                          if (activityFrom) params.set("from", activityFrom);
                          if (activityTo) params.set("to", activityTo);
                          if (activityDirection !== "ALL") params.set("direction", activityDirection);
                          if (activityEntityType !== "ALL") params.set("entityType", activityEntityType);
                          if (activitySearch) params.set("search", activitySearch);
                          downloadCsv(
                            `/api/export?type=activity&${params.toString()}`,
                            `activity_ledger_${today()}.csv`,
                          );
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                      >
                        <Download size={15} /> Export Activity CSV
                      </button>
                    </div>
                  </div>

                  {/* Financial Position Summary */}
                  {financialPosition && (
                    <div className="position-grid" style={{ marginBottom: "20px" }}>
                      <div className="position-card">
                        <div className="position-label">Personal Capital Injected</div>
                        <div className="position-value" style={{ color: "var(--gold)" }}>
                          {rupees(financialPosition.ownCapitalInjected)}
                        </div>
                        <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                          Equity baseline · Never income
                        </small>
                      </div>
                      <div className="position-card">
                        <div className="position-label">Principal Lent (Gross)</div>
                        <div className="position-value">
                          {rupees(financialPosition.principalLent.grossDisbursed)}
                        </div>
                        <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                          Outstanding: {rupees(financialPosition.principalLent.outstandingPrincipal)} ({financialPosition.principalLent.activeLoanCount} active)
                        </small>
                      </div>
                      <div className="position-card">
                        <div className="position-label">Principal Borrowed (Gross)</div>
                        <div className="position-value">
                          {rupees(financialPosition.principalBorrowed.grossBorrowed)}
                        </div>
                        <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                          Liability: {rupees(financialPosition.principalBorrowed.outstandingLiability)} ({financialPosition.principalBorrowed.activeBorrowingCount} active)
                        </small>
                      </div>
                      <div className="position-card">
                        <div className="position-label">Borrower Interest Received</div>
                        <div className="position-value" style={{ color: "#6ee7b7" }}>
                          {rupees(financialPosition.interest.borrowerInterestReceived)}
                        </div>
                        <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                          Principal recovered: {rupees(financialPosition.principalLent.principalRecovered)}
                        </small>
                      </div>
                      <div className="position-card">
                        <div className="position-label">Lender Interest Paid</div>
                        <div className="position-value" style={{ color: "#f87171" }}>
                          {rupees(financialPosition.interest.lenderInterestPaid)}
                        </div>
                        <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                          Net interest: {rupees(financialPosition.interest.netInterestSpread)}
                        </small>
                      </div>
                    </div>
                  )}

                  {/* Filter Toolbar */}
                  <div className="activity-filter-panel">
                    <div className="filter-group">
                      <label>From Date</label>
                      <input
                        type="date"
                        value={activityFrom}
                        onChange={(e) => setActivityFrom(e.target.value)}
                      />
                    </div>
                    <div className="filter-group">
                      <label>To Date</label>
                      <input
                        type="date"
                        value={activityTo}
                        onChange={(e) => setActivityTo(e.target.value)}
                      />
                    </div>
                    <div className="filter-group">
                      <label>Cash Movement</label>
                      <select
                        value={activityDirection}
                        onChange={(e) => setActivityDirection(e.target.value as any)}
                      >
                        <option value="ALL">All Movements</option>
                        <option value="IN">IN (Inflows)</option>
                        <option value="OUT">OUT (Outflows)</option>
                      </select>
                    </div>
                    <div className="filter-group">
                      <label>Entity Category</label>
                      <select
                        value={activityEntityType}
                        onChange={(e) => setActivityEntityType(e.target.value as any)}
                      >
                        <option value="ALL">All Categories</option>
                        <option value="LOAN">Borrower Loans</option>
                        <option value="BORROWING">Lender Borrowings</option>
                        <option value="EQUITY">Owner Equity</option>
                      </select>
                    </div>
                    <div className="filter-group">
                      <label>Search Counterparty / Ref</label>
                      <input
                        type="text"
                        placeholder="Search name, ref, notes…"
                        value={activitySearch}
                        onChange={(e) => setActivitySearch(e.target.value)}
                      />
                    </div>
                    <div className="filter-group" style={{ display: "flex", alignItems: "flex-end" }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setActivityFrom("");
                          setActivityTo("");
                          setActivityDirection("ALL");
                          setActivityEntityType("ALL");
                          setActivitySearch("");
                        }}
                        style={{ padding: "8px 12px", fontSize: "12px" }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* Activity Table */}
                  {activityLoading ? (
                    <div className="settle-loading" style={{ margin: "40px 0" }}>
                      <RefreshCw size={24} className="spin" color="var(--gold)" />
                      <span>Loading activity entries…</span>
                    </div>
                  ) : activityList.length === 0 ? (
                    <div className="empty-state">
                      <FileText size={32} />
                      <h3>No activity entries found</h3>
                      <p>Adjust your search filters or date range to view ledger transactions.</p>
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="ledger-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Event Type</th>
                            <th>Counterparty / Entity</th>
                            <th>Reference</th>
                            <th>Direction</th>
                            <th style={{ textAlign: "right" }}>Amount</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activityList.map((a) => (
                            <tr key={a.id}>
                              <td style={{ whiteSpace: "nowrap" }}>{dateLabel(a.date)}</td>
                              <td>
                                <div style={{ fontWeight: 600 }}>{a.type.replace(/_/g, " ")}</div>
                                <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                                  {a.entityType}: {a.entityId ? a.entityId.slice(-8) : "—"}
                                </small>
                              </td>
                              <td>{a.counterparty || "Owner Equity"}</td>
                              <td style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-secondary)" }}>
                                {a.reference || "—"}
                              </td>
                              <td>
                                <span className={`badge ${a.direction === "IN" ? "settled" : a.direction === "OUT" ? "overdue" : ""}`}>
                                  {a.direction}
                                </span>
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  fontWeight: 600,
                                  color: a.direction === "IN" ? "#6ee7b7" : a.direction === "OUT" ? "#f87171" : "inherit",
                                }}
                              >
                                {a.direction === "IN" ? `+${rupees(a.amount)}` : a.direction === "OUT" ? `−${rupees(a.amount)}` : rupees(a.amount)}
                              </td>
                              <td style={{ fontSize: "12px", color: "var(--text-secondary)", maxWidth: "250px" }}>
                                {a.notes || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
              {tab === "Reconciliation" && (
                <section className="panel reconciliation-container">
                  <div className="panel-header-action">
                    <div>
                      <div className="eyebrow">AUTOMATED FINANCIAL RECONCILIATION</div>
                      <h2>Continuous Integrity Audit</h2>
                      <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: "14px" }}>
                        Mathematical audit comparing cash pool movements, payment allocations, signed adjustments, and balance conservation. Read-only: no records are modified.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => loadReconciliation()}
                      disabled={reconcileLoading}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <RefreshCw size={15} className={reconcileLoading ? "spin" : ""} /> Run Integrity Audit
                    </button>
                  </div>

                  {reconcileLoading ? (
                    <div className="settle-loading" style={{ margin: "40px 0" }}>
                      <RefreshCw size={24} className="spin" color="var(--gold)" />
                      <span>Checking database invariants and allocation equations…</span>
                    </div>
                  ) : !reconcileReport ? (
                    <div className="empty-state">
                      <AlertTriangle size={32} />
                      <h3>No reconciliation report loaded</h3>
                      <p>Click Run Integrity Audit to inspect the ledger.</p>
                    </div>
                  ) : (
                    <>
                      {/* Status Banner */}
                      <div className={`reconcile-hero ${reconcileReport.healthy ? "healthy" : "flagged"}`}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {reconcileReport.healthy ? (
                            <CheckCircle2 size={32} color="#6ee7b7" />
                          ) : (
                            <XCircle size={32} color="#f87171" />
                          )}
                          <div>
                            <h3 style={{ margin: 0, fontSize: "18px" }}>
                              {reconcileReport.healthy
                                ? "Ledger in Full Mathematical Agreement"
                                : `Reconciliation Discrepancies Flagged (${reconcileReport.discrepancies.length})`}
                            </h3>
                            <small style={{ color: "var(--text-muted)" }}>
                              As of {new Date(reconcileReport.generatedAt).toLocaleString("en-IN")} · 0 integrity violations detected across active ledger records
                            </small>
                          </div>
                        </div>
                      </div>

                      {/* Reconciliation Metrics Grid */}
                      <div className="position-grid" style={{ marginBottom: "20px" }}>
                        <div className="position-card">
                          <div className="position-label">Audited Pool Balance</div>
                          <div className="position-value" style={{ color: "var(--gold)" }}>
                            {rupees(reconcileReport.metrics.poolBalance)}
                          </div>
                          <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                            {reconcileReport.metrics.totalPoolTransactions} cash movements
                          </small>
                        </div>
                        <div className="position-card">
                          <div className="position-label">Audited Repayments</div>
                          <div className="position-value">
                            {reconcileReport.metrics.totalPayments}
                          </div>
                          <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                            Borrower & lender repayments
                          </small>
                        </div>
                        <div className="position-card">
                          <div className="position-label">Audited Agreements</div>
                          <div className="position-value">
                            {reconcileReport.metrics.totalLoans + reconcileReport.metrics.totalBorrowings}
                          </div>
                          <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                            {reconcileReport.metrics.totalLoans} loans · {reconcileReport.metrics.totalBorrowings} borrowings
                          </small>
                        </div>
                        <div className="position-card">
                          <div className="position-label">Signed Adjustments</div>
                          <div className="position-value">
                            {reconcileReport.metrics.totalAdjustments}
                          </div>
                          <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                            Immutable audit trail
                          </small>
                        </div>
                        <div className="position-card">
                          <div className="position-label">Reversals Recorded</div>
                          <div className="position-value">
                            {reconcileReport.metrics.totalReversals}
                          </div>
                          <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                            Append-only corrections
                          </small>
                        </div>
                      </div>

                      {/* Discrepancies if any */}
                      {reconcileReport.discrepancies.length > 0 && (
                        <div style={{ marginBottom: "24px" }}>
                          <h3 style={{ color: "#f87171", margin: "0 0 12px", fontSize: "16px" }}>
                            Actionable Discrepancy Items ({reconcileReport.discrepancies.length})
                          </h3>
                          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {reconcileReport.discrepancies.map((d, i) => (
                              <div key={i} className="discrepancy-card">
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <strong style={{ color: d.severity === "CRITICAL" ? "#f87171" : "var(--gold)" }}>{d.code}</strong>
                                  <span className={`badge ${d.severity === "CRITICAL" ? "overdue" : ""}`}>
                                    {d.entityType}: {d.entityId ? d.entityId.slice(-8) : "SYSTEM"}
                                  </span>
                                </div>
                                <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
                                  {d.message}
                                </p>
                                {d.details && Object.keys(d.details).length > 0 && (
                                  <div style={{ marginTop: "6px", fontSize: "12px", fontFamily: "monospace", color: "var(--text-muted)" }}>
                                    {JSON.stringify(d.details)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Evaluated Equations List */}
                      <div>
                        <h3 style={{ margin: "0 0 12px", fontSize: "16px" }}>
                          Evaluated Financial Invariants
                        </h3>
                        <div className="checks-list">
                          {[
                            {
                              name: "Capital Pool Non-Negative Cumulative Balance",
                              detail: `Audited ${reconcileReport.metrics.totalPoolTransactions} pool movements. Cumulative derived balance never dips below ₹0.`,
                              passed: !reconcileReport.discrepancies.some((d) => d.code.startsWith("POOL_")),
                            },
                            {
                              name: "Payment Allocation Conservation (Amount = Principal + Interest + Fees)",
                              detail: `Audited ${reconcileReport.metrics.totalPayments} repayments. Every payment strictly equals sum of its allocations.`,
                              passed: !reconcileReport.discrepancies.some((d) => d.code === "PAYMENT_ALLOCATION_MISMATCH" || d.code === "PAYMENT_NON_POSITIVE"),
                            },
                            {
                              name: "Cash Movement 1-to-1 Linking",
                              detail: "Every loan and lender repayment is linked to exactly one verified pool transaction.",
                              passed: !reconcileReport.discrepancies.some((d) => d.code.includes("MISSING_POOL_TX") || d.code === "MULTIPLE_POOL_TX_FOR_PAYMENT"),
                            },
                            {
                              name: "Cash Movement Amount, Date & Direction Consistency",
                              detail: "Pool transaction amounts, dates, and cash flow directions match corresponding ledger payments exactly.",
                              passed: !reconcileReport.discrepancies.some((d) => d.code.includes("POOL_AMOUNT_MISMATCH") || d.code.includes("POOL_DATE_MISMATCH") || d.code.includes("POOL_DIRECTION_MISMATCH")),
                            },
                            {
                              name: "Disbursement & Borrowing Receipt Linking",
                              detail: `Audited ${reconcileReport.metrics.totalLoans} loans and ${reconcileReport.metrics.totalBorrowings} borrowings for disbursement/receipt pool movements.`,
                              passed: !reconcileReport.discrepancies.some((d) => d.code.includes("DISBURSEMENT") || d.code.includes("RECEIPT")),
                            },
                            {
                              name: "Non-Negative Remaining Principal & Interest Balances",
                              detail: "Derived balances reject overpayments; remaining principal and interest are never negative.",
                              passed: !reconcileReport.discrepancies.some((d) => d.code.includes("OVERPAID")),
                            },
                            {
                              name: "Agreement Status & Balance Invariant",
                              detail: "Closed agreements have exactly ₹0 remaining balance; active agreements have unpaid balances.",
                              passed: !reconcileReport.discrepancies.some((d) => d.code.includes("WITH_OUTSTANDING") || d.code.includes("WITH_ZERO_BALANCE")),
                            },
                            {
                              name: "Safe Reversal Compensating Invariants",
                              detail: `Audited ${reconcileReport.metrics.totalReversals} payment reversals for compensating pool entries and audit trail.`,
                              passed: !reconcileReport.discrepancies.some((d) => d.code.startsWith("REVERSAL_")),
                            },
                          ].map((chk, i) => (
                            <div key={i} className={`check-item ${chk.passed ? "passed" : "failed"}`}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                {chk.passed ? (
                                  <CheckCircle2 size={16} color="#6ee7b7" />
                                ) : (
                                  <XCircle size={16} color="#f87171" />
                                )}
                                <span style={{ fontWeight: 600, fontSize: "13px" }}>{chk.name}</span>
                              </div>
                              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                {chk.detail}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}
              {tab === "More" && (
                <div className="more-grid">
                  <section className="panel settings">
                    <h2>Accounting conventions</h2>
                    <dl>
                      <div>
                        <dt>Capital</dt>
                        <dd>One global, fungible pool</dd>
                      </div>
                      <div>
                        <dt>Annual interest</dt>
                        <dd>Simple interest · Actual/365 fixed</dd>
                      </div>
                      <div>
                        <dt>Monthly interest</dt>
                        <dd>
                          Simple interest · Original day anchor; partial
                          intervals prorated
                        </dd>
                      </div>
                      <div>
                        <dt>Accrual dates</dt>
                        <dd>Start inclusive · Repayment exclusive</dd>
                      </div>
                      <div>
                        <dt>Official amounts</dt>
                        <dd>Whole rupees · Round half up</dd>
                      </div>
                      <div>
                        <dt>Payment allocation</dt>
                        <dd>Fees → Interest → Principal</dd>
                      </div>
                      <div>
                        <dt>Overdue policy</dt>
                        <dd>No automatic penalties or extra interest</dd>
                      </div>
                    </dl>
                  </section>
                  <section className="panel settings">
                    <div className="icon-tile">
                      <BookOpen size={24} />
                    </div>
                    <h2>Aure Ledger</h2>
                    <p>
                      A personal lending workspace built around clear financial
                      records.
                    </p>
                    <div className="info-note">
                      Phase 5: owner-reviewed early settlement with signed interest adjustments, derived balances, and shared pool cash integration are active.
                    </div>
                    {authenticated && !demo && (
                      <button className="secondary" onClick={logout}>
                        <LogOut size={17} /> Sign out
                      </button>
                    )}
                    <div className="creator">adonis's creation</div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer>
            <span>AURE LEDGER</span>
            <span>Clarity in every transaction.</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.map((n) => (
          <button
            key={n.name}
            className={tab === n.name ? "active" : ""}
            onClick={() => {
              setTab(n.name);
              setSearch("");
            }}
          >
            <n.icon size={21} />
            <span>{n.name === "Overview" ? "Home" : n.name}</span>
          </button>
        ))}
      </nav>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
      >
        <div className="dialog-content">
          <div className="dialog-heading">
            <div>
              <div className="eyebrow">
                {modal === "REPAY"
                  ? "LOAN REPAYMENT"
                  : modal === "REPAY_LENDER"
                    ? "LENDER REPAYMENT"
                    : modal === "CHOOSE_REPAY_LOAN"
                      ? "RECORD REPAYMENT"
                      : modal === "CHOOSE_REPAY_BORROWING"
                        ? "REPAY LENDER"
                        : modal === "EARLY_SETTLE"
                          ? "EARLY SETTLEMENT REVIEW"
                          : modal === "REVERSE_PAYMENT"
                            ? "SAFE FINANCIAL REVERSAL"
                            : modal === "AGREEMENT_STATEMENT"
                              ? "INDIVIDUAL STATEMENT"
                              : modal === "POOL_STATEMENT"
                                ? "CAPITAL POOL STATEMENT"
                                : selected
                                  ? isBorrowing
                                    ? "BORROWING RECORD"
                                    : "LOAN RECORD"
                                  : "YOUR LEDGER"}
              </div>
              <h2>
                {modal === "REPAY" && selected
                  ? `Repayment · ${selected.name}`
                  : modal === "REPAY_LENDER" && selected
                    ? `Repay lender · ${selected.name}`
                    : modal === "CHOOSE_REPAY_LOAN"
                      ? "Select borrower loan to repay"
                      : modal === "CHOOSE_REPAY_BORROWING"
                        ? "Select borrowing to repay"
                        : modal === "EARLY_SETTLE" && selected
                          ? `Early settlement · ${selected.name}`
                          : modal === "REVERSE_PAYMENT" && reversalPayment
                            ? `Reverse Payment · ${reversalPayment.agreementName}`
                            : modal === "AGREEMENT_STATEMENT"
                              ? `${statementData ? statementData.counterpartyName : "Agreement"} Statement`
                              : modal === "POOL_STATEMENT"
                                ? "Shared Capital Pool Statement"
                                : selected
                                  ? selected.name
                                  : modal === "DISBURSE"
                                    ? "Disburse a loan"
                                    : modal === "BORROW"
                                      ? "Record borrowing"
                                      : modal === "CAPITAL"
                                        ? "Add own capital"
                                        : "Add a person"}
              </h2>
            </div>
            <button
              aria-label="Close dialog"
              className="icon-button"
              onClick={close}
              disabled={busy || uncertain}
            >
              <X size={21} />
            </button>
          </div>
          {selected && !modal ? (
            <div className="loan-detail">
              {!isBorrowing ? (
                <>
                  <span className="detail-amount">
                    {rupees(
                      new D(selected.remainingPrincipal)
                        .plus(selected.remainingInterest)
                        .toFixed(0),
                    )}
                  </span>
                  <p>Total outstanding balance</p>
                  <dl>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span
                          className={
                            selected.status === "CLOSED"
                              ? "badge settled"
                              : selected.due < today()
                                ? "badge overdue"
                                : "badge"
                          }
                        >
                          {selected.status === "CLOSED"
                            ? "Settled"
                            : selected.due < today()
                              ? "Overdue"
                              : "Active"}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Outstanding principal</dt>
                      <dd>
                        <strong>{rupees(selected.remainingPrincipal)}</strong>
                      </dd>
                    </div>
                    <div>
                      <dt>Outstanding interest</dt>
                      <dd>
                        <strong>{rupees(selected.remainingInterest)}</strong>
                      </dd>
                    </div>
                    <div>
                      <dt>Original principal</dt>
                      <dd>{rupees(selected.principal)}</dd>
                    </div>
                    <div>
                      <dt>Original agreed interest</dt>
                      <dd>{rupees(selected.interest)}</dd>
                    </div>
                    <div>
                      <dt>Agreement dates</dt>
                      <dd>
                        {dateLabel(selected.start)} → {dateLabel(selected.due)}
                      </dd>
                    </div>
                    <div>
                      <dt>Interest method</dt>
                      <dd>
                        {selected.method === "ANNUAL_ACTUAL_365"
                          ? "Annual simple · Actual/365"
                          : "Monthly simple · Anchored intervals"}
                      </dd>
                    </div>
                    <div>
                      <dt>Rate</dt>
                      <dd>
                        {selected.rate}%{" "}
                        {selected.method === "ANNUAL_ACTUAL_365"
                          ? "per year"
                          : "per month"}
                      </dd>
                    </div>
                    <div>
                      <dt>Record ID</dt>
                      <dd className="record-id">{selected.id}</dd>
                    </div>
                  </dl>
                  {selected.status === "ACTIVE" ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        marginTop: "20px",
                      }}
                    >
                      <button
                        className="primary"
                        style={{ flex: 1 }}
                        onClick={() =>
                          openRepay(selected as Snapshot["loans"][number])
                        }
                      >
                        <Plus size={17} /> Record repayment
                      </button>
                      <button
                        className="secondary"
                        style={{
                          flex: 1,
                          borderColor: "var(--gold-border)",
                          color: "var(--gold)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                        }}
                        onClick={() => openEarlySettle(selected)}
                      >
                        <Sparkles size={16} /> Early settlement
                      </button>
                    </div>
                  ) : (
                    <div className="info-note" style={{ marginTop: "20px" }}>
                      This loan is fully settled. All contractual obligations
                      have been fulfilled.
                    </div>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      marginTop: "12px",
                      width: "100%",
                      fontSize: "13px",
                    }}
                    onClick={() => openAgreementStatement(selected.id, "LOAN")}
                  >
                    <FileSpreadsheet size={15} /> Individual Loan Statement
                  </button>
                  {selected.adjustments && selected.adjustments.length > 0 && (
                    <div
                      className="repayment-history"
                      style={{ marginTop: "16px" }}
                    >
                      <h3>
                        Interest adjustments ({selected.adjustments.length})
                      </h3>
                      <div className="payment-list">
                        {selected.adjustments.map((a) => {
                          const isNeg = new D(a.amount).lt(0);
                          return (
                            <div className="payment-row" key={a.id}>
                              <div>
                                <strong
                                  style={{
                                    color: isNeg ? "#6ee7b7" : "var(--gold)",
                                  }}
                                >
                                  {isNeg
                                    ? `−${rupees(new D(a.amount).abs().toFixed(0))}`
                                    : `+${rupees(a.amount)}`}
                                </strong>
                                <small>
                                  {dateLabel(a.createdAt)} · by {a.performedBy}
                                </small>
                                {a.reason && (
                                  <div
                                    style={{
                                      fontSize: "11px",
                                      color: "var(--text-muted)",
                                      marginTop: "2px",
                                    }}
                                  >
                                    Reason: {a.reason}
                                  </div>
                                )}
                              </div>
                              <div className="payment-row-end">
                                <div>{isNeg ? "Discount" : "Addition"}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="repayment-history">
                    <h3>Repayment history ({selected.payments.length})</h3>
                    {selected.payments.length === 0 ? (
                      <p
                        style={{
                          fontSize: "12px",
                          color: "var(--muted)",
                          fontStyle: "italic",
                        }}
                      >
                        No repayments recorded yet.
                      </p>
                    ) : (
                      <div className="payment-list">
                        {selected.payments.map((p) => (
                          <div
                            className="payment-row"
                            key={p.id}
                            style={{ opacity: p.reversed ? 0.65 : 1 }}
                          >
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <strong>{rupees(p.amount)}</strong>
                                {p.reversed && (
                                  <span
                                    className="badge overdue"
                                    style={{ fontSize: "10px", padding: "2px 6px" }}
                                  >
                                    REVERSED
                                  </span>
                                )}
                              </div>
                              <small>
                                {dateLabel(p.date)}
                                {p.reference ? ` · Ref: ${p.reference}` : ""}
                              </small>
                              {p.reversed && p.reversalReason && (
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--text-muted)",
                                    marginTop: "2px",
                                  }}
                                >
                                  Reversed: {p.reversalReason}{" "}
                                  {p.reversalDate ? `(${dateLabel(p.reversalDate)})` : ""}
                                </div>
                              )}
                            </div>
                            <div className="payment-row-end">
                              <div>Principal: {rupees(p.principal)}</div>
                              <div>Interest: {rupees(p.interest)}</div>
                              {!p.reversed && selected.status === "ACTIVE" && (
                                <div style={{ marginTop: "6px" }}>
                                  {p.canReverse ? (
                                    <button
                                      type="button"
                                      className="secondary reversal-trigger-btn"
                                      onClick={() =>
                                        openReversal(p, selected, "LOAN")
                                      }
                                      title="Reverse this payment with compensating entry"
                                    >
                                      Reverse
                                    </button>
                                  ) : (
                                    <span
                                      className="reversal-unsupported-tag"
                                      title={p.unsupportedReason || "Reversal locked"}
                                    >
                                      {p.unsupportedReason || "Reversal locked"}
                                    </span>
                                  )}
                                </div>
                              )}
                              {!p.reversed && selected.status === "CLOSED" && (
                                <span
                                  className="reversal-unsupported-tag"
                                  title="Agreement is closed. Reversals prohibited."
                                >
                                  Closed (Locked)
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span className="detail-amount">
                    {rupees(
                      new D(selected.remainingPrincipal ?? selected.principal)
                        .plus(selected.remainingInterest ?? selected.interest)
                        .toFixed(0),
                    )}
                  </span>
                  <p>Total outstanding liability</p>
                  <dl>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span
                          className={
                            selected.status === "CLOSED"
                              ? "badge settled"
                              : selected.due < today()
                                ? "badge overdue"
                                : "badge"
                          }
                        >
                          {selected.status === "CLOSED"
                            ? "Settled"
                            : selected.due < today()
                              ? "Overdue"
                              : "Active"}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Outstanding principal</dt>
                      <dd>
                        <strong>
                          {rupees(
                            selected.remainingPrincipal ?? selected.principal,
                          )}
                        </strong>
                      </dd>
                    </div>
                    <div>
                      <dt>Outstanding interest</dt>
                      <dd>
                        <strong>
                          {rupees(
                            selected.remainingInterest ?? selected.interest,
                          )}
                        </strong>
                      </dd>
                    </div>
                    <div>
                      <dt>Original principal</dt>
                      <dd>{rupees(selected.principal)}</dd>
                    </div>
                    <div>
                      <dt>Original agreed interest</dt>
                      <dd>{rupees(selected.interest)}</dd>
                    </div>
                    <div>
                      <dt>Agreement dates</dt>
                      <dd>
                        {dateLabel(selected.start)} → {dateLabel(selected.due)}
                      </dd>
                    </div>
                    <div>
                      <dt>Interest method</dt>
                      <dd>
                        {selected.method === "ANNUAL_ACTUAL_365"
                          ? "Annual simple · Actual/365"
                          : "Monthly simple · Anchored intervals"}
                      </dd>
                    </div>
                    <div>
                      <dt>Rate</dt>
                      <dd>
                        {selected.rate}%{" "}
                        {selected.method === "ANNUAL_ACTUAL_365"
                          ? "per year"
                          : "per month"}
                      </dd>
                    </div>
                    <div>
                      <dt>Available in pool</dt>
                      <dd>{rupees(data.available)}</dd>
                    </div>
                    <div>
                      <dt>Record ID</dt>
                      <dd className="record-id">{selected.id}</dd>
                    </div>
                  </dl>
                  {selected.status === "ACTIVE" ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        marginTop: "20px",
                      }}
                    >
                      <button
                        className="primary"
                        style={{ flex: 1 }}
                        onClick={() =>
                          openRepayLender(
                            selected as Snapshot["borrowings"][number],
                          )
                        }
                      >
                        <Plus size={17} /> Repay lender
                      </button>
                      <button
                        className="secondary"
                        style={{
                          flex: 1,
                          borderColor: "var(--gold-border)",
                          color: "var(--gold)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                        }}
                        onClick={() => openEarlySettle(selected)}
                      >
                        <Sparkles size={16} /> Early settlement
                      </button>
                    </div>
                  ) : (
                    <div className="info-note" style={{ marginTop: "20px" }}>
                      This borrowing is fully settled. All liabilities have been
                      repaid.
                    </div>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      marginTop: "12px",
                      width: "100%",
                      fontSize: "13px",
                    }}
                    onClick={() => openAgreementStatement(selected.id, "BORROWING")}
                  >
                    <FileSpreadsheet size={15} /> Individual Borrowing Statement
                  </button>
                  {selected.adjustments && selected.adjustments.length > 0 && (
                    <div
                      className="repayment-history"
                      style={{ marginTop: "16px" }}
                    >
                      <h3>
                        Interest adjustments ({selected.adjustments.length})
                      </h3>
                      <div className="payment-list">
                        {selected.adjustments.map((a) => {
                          const isNeg = new D(a.amount).lt(0);
                          return (
                            <div className="payment-row" key={a.id}>
                              <div>
                                <strong
                                  style={{
                                    color: isNeg ? "#6ee7b7" : "var(--gold)",
                                  }}
                                >
                                  {isNeg
                                    ? `−${rupees(new D(a.amount).abs().toFixed(0))}`
                                    : `+${rupees(a.amount)}`}
                                </strong>
                                <small>
                                  {dateLabel(a.createdAt)} · by {a.performedBy}
                                </small>
                                {a.reason && (
                                  <div
                                    style={{
                                      fontSize: "11px",
                                      color: "var(--text-muted)",
                                      marginTop: "2px",
                                    }}
                                  >
                                    Reason: {a.reason}
                                  </div>
                                )}
                              </div>
                              <div className="payment-row-end">
                                <div>{isNeg ? "Discount" : "Addition"}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="repayment-history">
                    <h3>
                      Repayment history ({selected.payments?.length ?? 0})
                    </h3>
                    {!selected.payments || selected.payments.length === 0 ? (
                      <p
                        style={{
                          fontSize: "12px",
                          color: "var(--muted)",
                          fontStyle: "italic",
                        }}
                      >
                        No repayments recorded yet.
                      </p>
                    ) : (
                      <div className="payment-list">
                        {selected.payments.map((p) => (
                          <div
                            className="payment-row"
                            key={p.id}
                            style={{ opacity: p.reversed ? 0.65 : 1 }}
                          >
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <strong>{rupees(p.amount)}</strong>
                                {p.reversed && (
                                  <span
                                    className="badge overdue"
                                    style={{ fontSize: "10px", padding: "2px 6px" }}
                                  >
                                    REVERSED
                                  </span>
                                )}
                              </div>
                              <small>
                                {dateLabel(p.date)}
                                {p.reference ? ` · Ref: ${p.reference}` : ""}
                              </small>
                              {p.reversed && p.reversalReason && (
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--text-muted)",
                                    marginTop: "2px",
                                  }}
                                >
                                  Reversed: {p.reversalReason}{" "}
                                  {p.reversalDate ? `(${dateLabel(p.reversalDate)})` : ""}
                                </div>
                              )}
                            </div>
                            <div className="payment-row-end">
                              <div>Principal: {rupees(p.principal)}</div>
                              <div>Interest: {rupees(p.interest)}</div>
                              {!p.reversed && selected.status === "ACTIVE" && (
                                <div style={{ marginTop: "6px" }}>
                                  {p.canReverse ? (
                                    <button
                                      type="button"
                                      className="secondary reversal-trigger-btn"
                                      onClick={() =>
                                        openReversal(p, selected, "BORROWING")
                                      }
                                      title="Reverse this payment with compensating entry"
                                    >
                                      Reverse
                                    </button>
                                  ) : (
                                    <span
                                      className="reversal-unsupported-tag"
                                      title={p.unsupportedReason || "Reversal locked"}
                                    >
                                      {p.unsupportedReason || "Reversal locked"}
                                    </span>
                                  )}
                                </div>
                              )}
                              {!p.reversed && selected.status === "CLOSED" && (
                                <span
                                  className="reversal-unsupported-tag"
                                  title="Agreement is closed. Reversals prohibited."
                                >
                                  Closed (Locked)
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : modal === "CHOOSE_REPAY_LOAN" ? (
            <div className="picker-modal">
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 12px" }}>
                Choose which active borrower loan you wish to record a repayment against:
              </p>
              <div className="picker-list">
                {data.loans
                  .filter((l) => l.status === "ACTIVE")
                  .map((l) => (
                    <button
                      key={l.id}
                      className="picker-item"
                      onClick={() => openRepay(l)}
                    >
                      <div>
                        <div className="picker-name">{l.name}</div>
                        <small style={{ color: "var(--text-muted)" }}>
                          Due {dateLabel(l.due)}
                        </small>
                      </div>
                      <div className="picker-meta">
                        <strong>{rupees(l.remainingPrincipal)}</strong> principal
                        {new D(l.remainingInterest).gt(0) && (
                          <span> · {rupees(l.remainingInterest)} int</span>
                        )}
                      </div>
                      <ChevronRight size={17} color="var(--gold)" />
                    </button>
                  ))}
              </div>
            </div>
          ) : modal === "CHOOSE_REPAY_BORROWING" ? (
            <div className="picker-modal">
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 12px" }}>
                Choose which active lender borrowing you wish to record a repayment against:
              </p>
              <div className="picker-list">
                {(data.borrowings || [])
                  .filter((b) => b.status === "ACTIVE")
                  .map((b) => (
                    <button
                      key={b.id}
                      className="picker-item"
                      onClick={() => openRepayLender(b)}
                    >
                      <div>
                        <div className="picker-name">{b.name}</div>
                        <small style={{ color: "var(--text-muted)" }}>
                          Due {dateLabel(b.due)}
                        </small>
                      </div>
                      <div className="picker-meta">
                        <strong>
                          {rupees(
                            new D(b.remainingPrincipal)
                              .plus(b.remainingInterest)
                              .toFixed(0),
                          )}
                        </strong>{" "}
                        liability
                        <span>
                          {" "}(Principal: {rupees(b.remainingPrincipal)})
                        </span>
                      </div>
                      <ChevronRight size={17} color="var(--gold)" />
                    </button>
                  ))}
              </div>
            </div>
          ) : modal === "REVERSE_PAYMENT" && reversalPayment ? (
            <form className="reversal-form" onSubmit={handleReverseSubmit}>
              <div className="reversal-warning-box">
                <AlertTriangle size={24} color="#f87171" />
                <div>
                  <h4 style={{ margin: "0 0 4px", color: "#f87171", fontSize: "14px" }}>
                    Append-Only Financial Correction
                  </h4>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                    Original financial transactions remain permanently preserved and immutable.
                    Submitting this reversal atomically appends a linked compensating transaction,
                    restores the agreement's outstanding balances, and balances the capital pool.
                  </p>
                </div>
              </div>

              <div className="reversal-details-grid">
                <div>
                  <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>Counterparty</small>
                  <strong>{reversalPayment.agreementName}</strong>
                </div>
                <div>
                  <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>Agreement Type</small>
                  <strong>{reversalPayment.agreementType === "LOAN" ? "Borrower Loan" : "Lender Borrowing"}</strong>
                </div>
                <div>
                  <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>Payment Amount</small>
                  <strong style={{ color: "var(--gold)", fontSize: "16px" }}>{rupees(reversalPayment.amount)}</strong>
                </div>
                <div>
                  <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>Original Payment Date</small>
                  <strong>{dateLabel(reversalPayment.date)}</strong>
                </div>
                <div>
                  <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>Principal Reversed</small>
                  <strong>{rupees(reversalPayment.principal)}</strong>
                </div>
                <div>
                  <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>Interest Reversed</small>
                  <strong>{rupees(reversalPayment.interest)}</strong>
                </div>
              </div>

              <div className="reversal-effect-note">
                <strong>Accounting & Financial Invariants:</strong>
                <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                  {reversalPayment.agreementType === "LOAN" ? (
                    <>
                      <li>Reinstates loan outstanding principal (+{rupees(reversalPayment.principal)}) and interest (+{rupees(reversalPayment.interest)}).</li>
                      <li>Deducts {rupees(reversalPayment.amount)} from the shared capital pool (cash returned to borrower).</li>
                      <li>Solvency validation: Available pool cash ({rupees(data.available)}) must be at least {rupees(reversalPayment.amount)}.</li>
                    </>
                  ) : (
                    <>
                      <li>Reinstates borrowing liability principal (+{rupees(reversalPayment.principal)}) and interest (+{rupees(reversalPayment.interest)}).</li>
                      <li>Adds {rupees(reversalPayment.amount)} to the shared capital pool (cash returned by lender).</li>
                    </>
                  )}
                  <li>Executed atomically under global advisory lock 67421901 with immutable audit logging.</li>
                </ul>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span>Effective Reversal Date</span>
                <input
                  type="date"
                  value={reversalDate}
                  onChange={(e) => setReversalDate(e.target.value)}
                  max={today()}
                  disabled={uncertain || reversalLoading}
                  required
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span>Explanatory Reason <span style={{ color: "var(--gold)" }}>*</span></span>
                <input
                  type="text"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="Required: explain reason for reversal (e.g. erroneous entry, duplicate transaction)"
                  minLength={5}
                  maxLength={500}
                  disabled={uncertain || reversalLoading}
                  required
                />
              </label>

              <label className="settle-confirm-check">
                <input
                  type="checkbox"
                  checked={reversalConfirmed}
                  onChange={(e) => setReversalConfirmed(e.target.checked)}
                  disabled={uncertain || reversalLoading}
                  required
                />
                <span>
                  I confirm the append-only reversal of {rupees(reversalPayment.amount)} for {reversalPayment.agreementName}.
                </span>
              </label>

              {uncertain && (
                <div className="info-note" style={{ margin: "12px 0" }}>
                  The result is unconfirmed due to a network interruption. Keep this form open and retry the same reversal. The original duplicate-protection key is preserved.
                </div>
              )}

              {formError && (
                <div className="message error" role="alert">
                  {formError}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button
                  type="button"
                  className="secondary"
                  style={{ flex: 1 }}
                  onClick={close}
                  disabled={reversalLoading || uncertain}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary"
                  style={{ flex: 1, backgroundColor: "#b91c1c", borderColor: "#ef4444" }}
                  disabled={reversalLoading || !reversalConfirmed || reversalReason.trim().length < 5}
                >
                  {reversalLoading
                    ? "Reversing..."
                    : uncertain
                      ? "Retry Reversal"
                      : "Confirm & Reverse"}
                </button>
              </div>
            </form>
          ) : modal === "AGREEMENT_STATEMENT" ? (
            <div className="statement-content">
              {statementLoading ? (
                <div className="settle-loading" style={{ margin: "40px 0" }}>
                  <RefreshCw size={24} className="spin" color="var(--gold)" />
                  <span>Loading agreement statement…</span>
                </div>
              ) : !statementData ? (
                <div className="empty-state">
                  <AlertTriangle size={32} />
                  <h3>Failed to load statement</h3>
                  <p>Could not retrieve the statement records.</p>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "18px" }}>
                        {statementData.counterpartyName} · {statementData.agreementType === "LOAN" ? "Borrower Loan" : "Lender Borrowing"}
                      </h3>
                      <div style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
                        Term: {dateLabel(statementData.startDate)} → {dateLabel(statementData.dueDate)} · Rate: {statementData.rate}% ({statementData.interestMethod === "ANNUAL_ACTUAL_365" ? "Annual Actual/365" : "Monthly Anchored"})
                      </div>
                      <div style={{ marginTop: "4px" }}>
                        <span className={`badge ${statementData.status === "CLOSED" ? "settled" : "active"}`}>
                          {statementData.status === "CLOSED" ? "Settled" : "Active"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        const pType = statementData.agreementType === "LOAN" ? "loan" : "borrowing";
                        downloadCsv(
                          `/api/export?type=${pType}&id=${statementData.agreementId}`,
                          `${pType}_statement_${statementData.counterpartyName.replace(/\s+/g, "_")}_${today()}.csv`,
                        );
                      }}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <Download size={15} /> Export Statement CSV
                    </button>
                  </div>

                  <div className="position-grid" style={{ marginBottom: "20px" }}>
                    <div className="position-card">
                      <div className="position-label">Original Principal</div>
                      <div className="position-value">{rupees(statementData.principal)}</div>
                      <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                        Total Paid: {rupees(statementData.totalPaidPrincipal)}
                      </small>
                    </div>
                    <div className="position-card">
                      <div className="position-label">Adjusted Interest</div>
                      <div className="position-value" style={{ color: "var(--gold)" }}>
                        {rupees(statementData.currentAdjustedInterest)}
                      </div>
                      <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                        Original: {rupees(statementData.originalInterest)} · Paid: {rupees(statementData.totalPaidInterest)}
                      </small>
                    </div>
                    <div className="position-card">
                      <div className="position-label">Outstanding Principal</div>
                      <div className="position-value">
                        {rupees(statementData.remainingPrincipal)}
                      </div>
                    </div>
                    <div className="position-card">
                      <div className="position-label">Outstanding Interest</div>
                      <div className="position-value" style={{ color: "var(--gold)" }}>
                        {rupees(statementData.remainingInterest)}
                      </div>
                    </div>
                    <div className="position-card">
                      <div className="position-label">Total Payoff</div>
                      <div className="position-value" style={{ color: statementData.status === "CLOSED" ? "#6ee7b7" : "var(--gold)" }}>
                        {rupees(statementData.totalRemainingPayoff)}
                      </div>
                    </div>
                  </div>

                  <h4 style={{ margin: "16px 0 8px", fontSize: "14px" }}>Transaction History & Running Balances</h4>
                  <div style={{ overflowX: "auto" }}>
                    <table className="statement-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Event / Description</th>
                          <th>Reference</th>
                          <th>Cash Amount</th>
                          <th>Alloc Principal</th>
                          <th>Alloc Interest</th>
                          <th>Adjustment</th>
                          <th style={{ textAlign: "right" }}>Running Principal</th>
                          <th style={{ textAlign: "right" }}>Running Interest</th>
                          <th style={{ textAlign: "right" }}>Running Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statementData.entries.map((en, i) => (
                          <tr key={i}>
                            <td style={{ whiteSpace: "nowrap" }}>{dateLabel(en.date)}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{en.eventType.replace(/_/g, " ")}</div>
                              <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>{en.description}</small>
                            </td>
                            <td style={{ fontFamily: "monospace", fontSize: "11px" }}>{en.reference || "—"}</td>
                            <td style={{ fontWeight: 600 }}>
                              {en.cashAmount ? (
                                <span style={{ color: en.cashDirection === "IN" ? "#6ee7b7" : "#f87171" }}>
                                  {en.cashDirection === "IN" ? `+${rupees(en.cashAmount)}` : `−${rupees(en.cashAmount)}`}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>{en.principalAllocation !== "0" ? rupees(en.principalAllocation) : "—"}</td>
                            <td>{en.interestAllocation !== "0" ? rupees(en.interestAllocation) : "—"}</td>
                            <td>
                              {en.adjustmentDelta ? (
                                <span style={{ color: new D(en.adjustmentDelta).lt(0) ? "#6ee7b7" : "var(--gold)" }}>
                                  {new D(en.adjustmentDelta).lt(0) ? `−${rupees(new D(en.adjustmentDelta).abs().toFixed(0))}` : `+${rupees(en.adjustmentDelta)}`}
                                </span>
                              ) : "—"}
                            </td>
                            <td style={{ textAlign: "right", fontFamily: "monospace" }}>{rupees(en.runningPrincipal)}</td>
                            <td style={{ textAlign: "right", fontFamily: "monospace" }}>{rupees(en.runningInterest)}</td>
                            <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "var(--gold)" }}>
                              {rupees(en.runningTotalOwed)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ) : modal === "POOL_STATEMENT" ? (
            <div className="statement-content">
              {statementLoading ? (
                <div className="settle-loading" style={{ margin: "40px 0" }}>
                  <RefreshCw size={24} className="spin" color="var(--gold)" />
                  <span>Loading capital pool statement…</span>
                </div>
              ) : !poolStatementData ? (
                <div className="empty-state">
                  <AlertTriangle size={32} />
                  <h3>Failed to load pool statement</h3>
                  <p>Could not retrieve pool movements.</p>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "18px" }}>
                        Capital Pool Statement
                      </h3>
                      <div style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
                        As of {new Date(poolStatementData.asOfDate).toLocaleString("en-IN")} · Derived balance from strictly verified append-only cash movements.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        downloadCsv(
                          "/api/export?type=pool",
                          `capital_pool_statement_${today()}.csv`,
                        );
                      }}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <Download size={15} /> Export Pool CSV
                    </button>
                  </div>

                  <div className="position-grid" style={{ marginBottom: "20px" }}>
                    <div className="position-card">
                      <div className="position-label">Derived Available Balance</div>
                      <div className="position-value" style={{ color: "var(--gold)", fontSize: "22px" }}>
                        {rupees(poolStatementData.currentBalance)}
                      </div>
                      <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                        Sum of all historical inflows minus outflows
                      </small>
                    </div>
                    <div className="position-card">
                      <div className="position-label">Total Inflows (IN)</div>
                      <div className="position-value" style={{ color: "#6ee7b7" }}>
                        +{rupees(poolStatementData.totalInflow)}
                      </div>
                      <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                        Capital, borrowings, repayments, reversals
                      </small>
                    </div>
                    <div className="position-card">
                      <div className="position-label">Total Outflows (OUT)</div>
                      <div className="position-value" style={{ color: "#f87171" }}>
                        −{rupees(poolStatementData.totalOutflow)}
                      </div>
                      <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                        Disbursements, lender repayments, reversals
                      </small>
                    </div>
                  </div>

                  <h4 style={{ margin: "16px 0 8px", fontSize: "14px" }}>Chronological Pool Ledger ({poolStatementData.entries.length} movements)</h4>
                  <div style={{ overflowX: "auto" }}>
                    <table className="statement-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Transaction Type</th>
                          <th>Counterparty / Source</th>
                          <th>Reference</th>
                          <th>Direction</th>
                          <th style={{ textAlign: "right" }}>Amount</th>
                          <th style={{ textAlign: "right" }}>Derived Running Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {poolStatementData.entries.map((en) => (
                          <tr key={en.id}>
                            <td style={{ whiteSpace: "nowrap" }}>{dateLabel(en.date)}</td>
                            <td style={{ fontWeight: 600 }}>{en.type.replace(/_/g, " ")}</td>
                            <td>{en.counterparty || "Owner Equity"}</td>
                            <td style={{ fontFamily: "monospace", fontSize: "11px" }}>{en.reference || "—"}</td>
                            <td>
                              <span className={`badge ${en.direction === "IN" ? "settled" : "overdue"}`}>
                                {en.direction}
                              </span>
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                fontWeight: 600,
                                color: en.direction === "IN" ? "#6ee7b7" : "#f87171",
                              }}
                            >
                              {en.direction === "IN" ? `+${rupees(en.amount)}` : `−${rupees(en.amount)}`}
                            </td>
                            <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "var(--gold)" }}>
                              {rupees(en.runningBalance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ) : (
            <form ref={form} onSubmit={submit} onChange={updateQuote}>
              <fieldset disabled={busy || uncertain}>
                {modal === "DISBURSE" && (
                  <>
                    <label>
                      Borrower
                      <select name="borrowerProfileId" required defaultValue="">
                        <option value="" disabled>
                          Select a borrower
                        </option>
                        {data.people
                          .filter((p) => p.borrowerId)
                          .map((p) => (
                            <option key={p.id} value={p.borrowerId!}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {!data.people.some((p) => p.borrowerId) && (
                      <div className="info-note">
                        Add a person with a borrower role before disbursing a
                        loan.
                      </div>
                    )}
                    <div className="form-grid">
                      <label>
                        Principal (₹)
                        <input
                          name="principal"
                          inputMode="numeric"
                          type="text"
                          pattern="[0-9]+"
                          placeholder="20000"
                          required
                        />
                      </label>
                      <label>
                        Interest rate (%)
                        <input
                          name="rate"
                          inputMode="decimal"
                          type="text"
                          pattern="[0-9]+(\.[0-9]{1,6})?"
                          defaultValue="12"
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Interest method
                      <select name="interestMethod">
                        <option value="ANNUAL_ACTUAL_365">
                          Annual simple — Actual/365 fixed
                        </option>
                        <option value="MONTHLY_ANCHORED">
                          Monthly simple — Original day anchor
                        </option>
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Disbursement date
                        <input
                          name="startDate"
                          type="date"
                          defaultValue={today()}
                          max={today()}
                          required
                        />
                      </label>
                      <label>
                        Agreed due date
                        <input name="dueDate" type="date" required />
                      </label>
                    </div>
                    <label>
                      UTR / reference <span className="optional">optional</span>
                      <input
                        name="reference"
                        maxLength={120}
                        placeholder="Bank or cash reference"
                      />
                    </label>
                    <div className="quote">
                      <span>Original agreed interest</span>
                      <strong>
                        {quote ? rupees(quote) : "Enter loan details"}
                      </strong>
                      <small>
                        Start inclusive, due date exclusive. Rounded to ₹1, half
                        up. No automatic overdue interest.
                      </small>
                    </div>
                    <div className="available-note">
                      Available capital{" "}
                      <strong>{rupees(data.available)}</strong>
                    </div>
                  </>
                )}
                {modal === "BORROW" && (
                  <>
                    <label>
                      Lender
                      <select name="lenderProfileId" required defaultValue="">
                        <option value="" disabled>
                          Select a lender
                        </option>
                        {data.people
                          .filter((p) => p.lenderId)
                          .map((p) => (
                            <option key={p.id} value={p.lenderId!}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {!data.people.some((p) => p.lenderId) && (
                      <div className="info-note">
                        Add a person with a lender role before recording a
                        borrowing.
                      </div>
                    )}
                    <div className="form-grid">
                      <label>
                        Principal (₹)
                        <input
                          name="principal"
                          inputMode="numeric"
                          type="text"
                          pattern="[0-9]+"
                          placeholder="25000"
                          required
                        />
                      </label>
                      <label>
                        Interest rate (%)
                        <input
                          name="rate"
                          inputMode="decimal"
                          type="text"
                          pattern="[0-9]+(\.[0-9]{1,6})?"
                          defaultValue="10"
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Interest method
                      <select name="interestMethod">
                        <option value="ANNUAL_ACTUAL_365">
                          Annual simple — Actual/365 fixed
                        </option>
                        <option value="MONTHLY_ANCHORED">
                          Monthly simple — Original day anchor
                        </option>
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Received date
                        <input
                          name="startDate"
                          type="date"
                          defaultValue={today()}
                          max={today()}
                          required
                        />
                      </label>
                      <label>
                        Agreed due date
                        <input name="dueDate" type="date" required />
                      </label>
                    </div>
                    <label>
                      UTR / reference <span className="optional">optional</span>
                      <input
                        name="reference"
                        maxLength={120}
                        placeholder="Bank or cash reference"
                      />
                    </label>
                    <div className="quote">
                      <span>Original agreed interest</span>
                      <strong>
                        {quote ? rupees(quote) : "Enter borrowing details"}
                      </strong>
                      <small>
                        Start inclusive, due date exclusive. Rounded to ₹1, half
                        up.
                      </small>
                    </div>
                  </>
                )}
                {modal === "CAPITAL" && (
                  <>
                    <p className="form-intro">
                      Record your own money entering the shared capital pool.
                      This is capital, not income.
                    </p>
                    <label>
                      Amount (₹)
                      <input
                        name="amount"
                        inputMode="numeric"
                        pattern="[0-9]+"
                        placeholder="50000"
                        required
                      />
                    </label>
                    <label>
                      Date received
                      <input
                        name="transactionDate"
                        type="date"
                        defaultValue={today()}
                        max={today()}
                        required
                      />
                    </label>
                    <label>
                      Reason
                      <input
                        name="reason"
                        maxLength={500}
                        placeholder="Initial personal capital"
                        required
                      />
                    </label>
                    <label>
                      UTR / reference <span className="optional">optional</span>
                      <input
                        name="reference"
                        maxLength={120}
                        placeholder="Bank or cash reference"
                      />
                    </label>
                  </>
                )}
                {modal === "PERSON" && (
                  <>
                    <label>
                      Person
                      <select
                        name="personId"
                        value={personId}
                        onChange={(e) => setPersonId(e.target.value)}
                      >
                        <option value="">Create a new person</option>
                        {data.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            Use existing: {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Full name
                      <input
                        name="name"
                        maxLength={120}
                        required
                        key={personId || "new-person"}
                        readOnly={!!personId}
                        defaultValue={
                          personId
                            ? data.people.find((p) => p.id === personId)?.name
                            : ""
                        }
                        placeholder="Enter full name"
                      />
                    </label>
                    <label>
                      Phone <span className="optional">optional</span>
                      <input
                        name="phone"
                        type="tel"
                        maxLength={30}
                        placeholder="Contact number"
                        disabled={!!personId}
                      />
                    </label>
                    <label>
                      Financial role
                      <select name="role">
                        <option value="BORROWER">
                          Borrower — I lend to them
                        </option>
                        <option value="LENDER">
                          Lender — I borrow from them
                        </option>
                        <option value="BOTH">Both borrower and lender</option>
                      </select>
                    </label>
                    <div className="info-note">
                      Check existing people before creating someone new. A
                      person can have both roles.
                    </div>
                  </>
                )}
                {modal === "REPAY" && selected && "remainingPrincipal" in selected && (
                  <>
                    <input type="hidden" name="loanId" value={selected.id} />
                    <p className="form-intro">
                      Record repayment for <strong>{selected.name}</strong>.
                      Total outstanding:{" "}
                      <strong>
                        {rupees(
                          new D(selected.remainingPrincipal)
                            .plus(selected.remainingInterest)
                            .toFixed(0),
                        )}
                      </strong>{" "}
                      (Principal: {rupees(selected.remainingPrincipal)},
                      Interest: {rupees(selected.remainingInterest)})
                    </p>
                    <div className="form-grid">
                      <label>
                        Amount (₹)
                        <input
                          name="amount"
                          inputMode="numeric"
                          type="text"
                          pattern="[0-9]+"
                          placeholder={new D(selected.remainingPrincipal)
                            .plus(selected.remainingInterest)
                            .toFixed(0)}
                          required
                          autoFocus
                        />
                      </label>
                      <label>
                        Payment date
                        <input
                          name="paymentDate"
                          type="date"
                          defaultValue={today()}
                          min={selected.start}
                          max={today()}
                          required
                        />
                      </label>
                    </div>
                    <label>
                      UTR / reference <span className="optional">optional</span>
                      <input
                        name="reference"
                        maxLength={120}
                        placeholder="Bank UTR or cash receipt"
                      />
                    </label>
                    {repayPreview && (
                      <div
                        className={
                          "quote" + (repayPreview.overpayment ? " warning" : "")
                        }
                      >
                        <span>
                          {repayPreview.overpayment
                            ? "Payment exceeds outstanding balance"
                            : "Allocation preview"}
                        </span>
                        <strong>
                          Interest: {rupees(repayPreview.interest)} · Principal:{" "}
                          {rupees(repayPreview.principal)}
                        </strong>
                        <small>
                          {repayPreview.overpayment ? (
                            <span style={{ color: "#b93838" }}>
                              Total payable is{" "}
                              {rupees(
                                new D(selected.remainingPrincipal)
                                  .plus(selected.remainingInterest)
                                  .toFixed(0),
                              )}
                              . Overpayments are rejected.
                            </span>
                          ) : (
                            <>
                              Remaining principal:{" "}
                              {rupees(repayPreview.remPrincipal)} · Remaining
                              interest: {rupees(repayPreview.remInterest)}
                              {repayPreview.settled &&
                                " · Full settlement will close this loan."}
                            </>
                          )}
                        </small>
                      </div>
                    )}
                  </>
                )}
                {modal === "REPAY_LENDER" &&
                  selected &&
                  "remainingPrincipal" in selected && (
                    <>
                      <input
                        type="hidden"
                        name="borrowingId"
                        value={selected.id}
                      />
                      <p className="form-intro">
                        Record repayment for lender{" "}
                        <strong>{selected.name}</strong>. Available cash:{" "}
                        <strong>{rupees(data.available)}</strong>. Total
                        outstanding liability:{" "}
                        <strong>
                          {rupees(
                            new D(selected.remainingPrincipal)
                              .plus(selected.remainingInterest)
                              .toFixed(0),
                          )}
                        </strong>{" "}
                        (Principal: {rupees(selected.remainingPrincipal)},
                        Interest: {rupees(selected.remainingInterest)})
                      </p>
                      <div className="form-grid">
                        <label>
                          Amount (₹)
                          <input
                            name="amount"
                            inputMode="numeric"
                            type="text"
                            pattern="[0-9]+"
                            placeholder={new D(selected.remainingPrincipal)
                              .plus(selected.remainingInterest)
                              .toFixed(0)}
                            required
                            autoFocus
                          />
                        </label>
                        <label>
                          Payment date
                          <input
                            name="paymentDate"
                            type="date"
                            defaultValue={today()}
                            min={selected.start}
                            max={today()}
                            required
                          />
                        </label>
                      </div>
                      <label>
                        UTR / reference{" "}
                        <span className="optional">optional</span>
                        <input
                          name="reference"
                          maxLength={120}
                          placeholder="Bank UTR or cash receipt"
                        />
                      </label>
                      {repayPreview && (
                        <div
                          className={
                            "quote" +
                            (repayPreview.insufficientCash ||
                              repayPreview.overpayment
                              ? " warning"
                              : "")
                          }
                        >
                          <span>
                            {repayPreview.insufficientCash
                              ? `Payment exceeds available pool cash (${rupees(data.available)} available)`
                              : repayPreview.overpayment
                                ? "Payment exceeds outstanding balance"
                                : "Allocation preview"}
                          </span>
                          <strong>
                            Interest: {rupees(repayPreview.interest)} ·
                            Principal: {rupees(repayPreview.principal)}
                          </strong>
                          <small>
                            {repayPreview.insufficientCash ? (
                              <span style={{ color: "#b93838" }}>
                                Available pool cash is{" "}
                                {rupees(data.available)}. Overdrafts are
                                rejected.
                              </span>
                            ) : repayPreview.overpayment ? (
                              <span style={{ color: "#b93838" }}>
                                Total liability is{" "}
                                {rupees(
                                  new D(selected.remainingPrincipal)
                                    .plus(selected.remainingInterest)
                                    .toFixed(0),
                                )}
                                . Overpayments are rejected.
                              </span>
                            ) : (
                              <>
                                Remaining principal:{" "}
                                {rupees(repayPreview.remPrincipal)} · Remaining
                                interest: {rupees(repayPreview.remInterest)}
                                {repayPreview.settled &&
                                  " · Full settlement will close this borrowing."}
                              </>
                            )}
                          </small>
                        </div>
                      )}
                    </>
                  )}
                {modal === "EARLY_SETTLE" && selected && (
                  <>
                    <input
                      type="hidden"
                      name="agreementId"
                      value={selected.id}
                    />
                    <input
                      type="hidden"
                      name="agreementType"
                      value={isBorrowing ? "BORROWING" : "LOAN"}
                    />
                    <div className="form-grid">
                      <label>
                        Settlement date
                        <input
                          name="settlementDate"
                          type="date"
                          value={settleDate}
                          onChange={(e) => setSettleDate(e.target.value)}
                          min={selected.start}
                          max={today()}
                          required
                        />
                      </label>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          paddingTop: "14px",
                        }}
                      >
                        <small
                          style={{
                            color: "var(--text-muted)",
                            fontSize: "11px",
                          }}
                        >
                          Contractual: {dateLabel(selected.start)} →{" "}
                          {dateLabel(selected.due)}
                        </small>
                        <small
                          style={{
                            color: "var(--gold)",
                            fontSize: "12px",
                            marginTop: "3px",
                            fontWeight: 500,
                          }}
                        >
                          {settlePreview
                            ? `${settlePreview.elapsedDays} of ${settlePreview.termDays} elapsed actual days`
                            : "Calculating proration…"}
                        </small>
                      </div>
                    </div>

                    {settleLoading && (
                      <div className="settle-loading">
                        <Sparkles size={24} color="var(--gold)" />
                        <span>Calculating server settlement quote…</span>
                      </div>
                    )}

                    {settlePreview && !settleLoading && (
                      <>
                        {(() => {
                          const existAdjSum =
                            settlePreview.existingAdjustments.reduce(
                              (acc, a) => acc.plus(a.amount),
                              new D(0),
                            );
                          return (
                            <div className="settle-summary-card">
                              <div className="settle-counterparty-row">
                                <div>
                                  <div className="settle-counterparty-name">
                                    {selected.name}
                                  </div>
                                  <small style={{ color: "var(--text-muted)" }}>
                                    {isBorrowing
                                      ? "Lender borrowing"
                                      : "Borrower loan"}{" "}
                                    · {selected.id}
                                  </small>
                                </div>
                                <span className="settle-term-badge">
                                  {selected.method === "ANNUAL_ACTUAL_365"
                                    ? "Annual Actual/365"
                                    : "Monthly Anchored"}
                                </span>
                              </div>

                              <div className="settle-stat-grid">
                                <div className="settle-stat-item">
                                  <small>Original agreed interest</small>
                                  <strong>
                                    {rupees(settlePreview.originalInterest)}
                                  </strong>
                                </div>
                                <div className="settle-stat-item">
                                  <small>Existing adjustments</small>
                                  <strong
                                    style={{
                                      color: existAdjSum.lt(0)
                                        ? "#6ee7b7"
                                        : "var(--text-primary)",
                                    }}
                                  >
                                    {existAdjSum.isZero()
                                      ? "₹0"
                                      : existAdjSum.lt(0)
                                        ? `−${rupees(existAdjSum.abs().toFixed(0))}`
                                        : `+${rupees(existAdjSum.toFixed(0))}`}
                                  </strong>
                                </div>
                                <div className="settle-stat-item">
                                  <small>Current adjusted total</small>
                                  <strong>
                                    {rupees(
                                      settlePreview.currentAdjustedInterest,
                                    )}
                                  </strong>
                                </div>
                                <div className="settle-stat-item">
                                  <small>Interest already paid</small>
                                  <strong>
                                    {rupees(settlePreview.interestPaid)}
                                  </strong>
                                </div>
                                <div className="settle-stat-item">
                                  <small>Outstanding principal</small>
                                  <strong>
                                    {rupees(settlePreview.outstandingPrincipal)}
                                  </strong>
                                </div>
                                <div
                                  className="settle-stat-item"
                                  style={{ borderColor: "var(--gold-border)" }}
                                >
                                  <small>Suggested total interest</small>
                                  <strong style={{ color: "var(--gold)" }}>
                                    {rupees(
                                      settlePreview.suggestedTotalInterest,
                                    )}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        <div>
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "var(--text-secondary)",
                              marginBottom: "6px",
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                            }}
                          >
                            Owner Settlement Decision
                          </div>
                          <div className="settle-decision-group">
                            <label
                              className={`settle-decision-card ${settleDecision === "SUGGESTED" ? "active" : ""
                                }`}
                            >
                              <input
                                type="radio"
                                name="settleDecisionRadio"
                                value="SUGGESTED"
                                checked={settleDecision === "SUGGESTED"}
                                onChange={() => setSettleDecision("SUGGESTED")}
                              />
                              <div className="settle-decision-body">
                                <div className="settle-decision-header">
                                  <span className="settle-decision-title">
                                    Accept suggested proration
                                  </span>
                                  <span className="settle-decision-amount">
                                    {rupees(
                                      settlePreview.suggestedTotalInterest,
                                    )}
                                  </span>
                                </div>
                                <span className="settle-decision-note">
                                  Default early-closure proration based on{" "}
                                  {settlePreview.elapsedDays} of{" "}
                                  {settlePreview.termDays} elapsed actual days.
                                  Replaces current agreed total.
                                </span>
                              </div>
                            </label>

                            <label
                              className={`settle-decision-card ${settleDecision === "RETAIN_CURRENT"
                                  ? "active"
                                  : ""
                                }`}
                            >
                              <input
                                type="radio"
                                name="settleDecisionRadio"
                                value="RETAIN_CURRENT"
                                checked={settleDecision === "RETAIN_CURRENT"}
                                onChange={() =>
                                  setSettleDecision("RETAIN_CURRENT")
                                }
                              />
                              <div className="settle-decision-body">
                                <div className="settle-decision-header">
                                  <span className="settle-decision-title">
                                    Retain current agreed total
                                  </span>
                                  <span className="settle-decision-amount">
                                    {rupees(
                                      settlePreview.currentAdjustedInterest,
                                    )}
                                  </span>
                                </div>
                                <span className="settle-decision-note">
                                  No interest discount will be applied. Settles
                                  at full contractual agreed interest.
                                </span>
                              </div>
                            </label>

                            <label
                              className={`settle-decision-card ${settleDecision === "MANUAL" ? "active" : ""
                                }`}
                            >
                              <input
                                type="radio"
                                name="settleDecisionRadio"
                                value="MANUAL"
                                checked={settleDecision === "MANUAL"}
                                onChange={() => setSettleDecision("MANUAL")}
                              />
                              <div className="settle-decision-body">
                                <div className="settle-decision-header">
                                  <span className="settle-decision-title">
                                    Enter manual final total interest
                                  </span>
                                  <span className="settle-decision-amount">
                                    {manualInterest &&
                                      !isNaN(Number(manualInterest))
                                      ? rupees(manualInterest)
                                      : "Custom"}
                                  </span>
                                </div>
                                <span className="settle-decision-note">
                                  Owner discretion. Must be at least{" "}
                                  {rupees(settlePreview.interestPaid)}{" "}
                                  (interest already paid).
                                </span>
                              </div>
                            </label>
                          </div>
                        </div>

                        {settleDecision === "MANUAL" && (
                          <label style={{ marginTop: "4px" }}>
                            Manual final total interest (₹)
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]+"
                              value={manualInterest}
                              onChange={(e) =>
                                setManualInterest(e.target.value)
                              }
                              placeholder={`At least ${settlePreview.interestPaid}`}
                              required
                              autoFocus
                            />
                          </label>
                        )}

                        {(() => {
                          let finalD: InstanceType<typeof D> | null = null;
                          if (settleDecision === "SUGGESTED") {
                            finalD = new D(
                              settlePreview.suggestedTotalInterest,
                            );
                          } else if (settleDecision === "RETAIN_CURRENT") {
                            finalD = new D(
                              settlePreview.currentAdjustedInterest,
                            );
                          } else if (
                            manualInterest.trim() &&
                            !isNaN(Number(manualInterest.trim()))
                          ) {
                            finalD = new D(manualInterest.trim());
                          }

                          if (!finalD) return null;

                          const paidD = new D(settlePreview.interestPaid);
                          const isNegative = finalD.lt(0);
                          const isBelowPaid = finalD.lt(paidD);
                          if (isNegative) {
                            return (
                              <div className="message error" role="alert">
                                Final total interest cannot be negative.
                              </div>
                            );
                          }
                          if (isBelowPaid) {
                            return (
                              <div className="message error" role="alert">
                                Final total interest ({rupees(finalD.toFixed(0))})
                                cannot be below interest already paid (
                                {rupees(paidD.toFixed(0))}). Historical interest
                                payments cannot be refunded or retroactively
                                reallocated.
                              </div>
                            );
                          }

                          const currD = new D(
                            settlePreview.currentAdjustedInterest,
                          );
                          const deltaD = finalD.minus(currD);
                          const prinD = new D(
                            settlePreview.outstandingPrincipal,
                          );
                          const payoffD = prinD.plus(finalD).minus(paidD);
                          const availPoolD = new D(data.available);
                          const isOverdraft =
                            isBorrowing && payoffD.gt(availPoolD);

                          return (
                            <>
                              {isOverdraft && (
                                <div className="message error" role="alert">
                                  Payment exceeds available pool cash (
                                  {rupees(data.available)} available). Overdrafts
                                  are rejected. Add capital or collect
                                  repayments before settling this borrowing.
                                </div>
                              )}
                              <div className="settle-cash-box">
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                >
                                  <span
                                    className={`settle-cash-direction ${isBorrowing ? "out" : "in"
                                      }`}
                                  >
                                    {isBorrowing ? (
                                      <ArrowUpRight size={14} />
                                    ) : (
                                      <ArrowDownLeft size={14} />
                                    )}
                                    {isBorrowing
                                      ? "Cash Outflow · Payment to lender"
                                      : "Cash Inflow · Receipt from borrower"}
                                  </span>
                                  {!deltaD.isZero() && (
                                    <span
                                      style={{
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        color: deltaD.lt(0)
                                          ? "#6ee7b7"
                                          : "var(--gold)",
                                      }}
                                    >
                                      Signed adjustment:{" "}
                                      {deltaD.lt(0)
                                        ? `−${rupees(deltaD.abs().toFixed(0))}`
                                        : `+${rupees(deltaD.toFixed(0))}`}
                                    </span>
                                  )}
                                </div>

                                <div className="settle-cash-rows">
                                  <div className="settle-cash-row">
                                    <span>Outstanding principal</span>
                                    <span>{rupees(prinD.toFixed(0))}</span>
                                  </div>
                                  <div className="settle-cash-row">
                                    <span>Selected final interest</span>
                                    <span>{rupees(finalD.toFixed(0))}</span>
                                  </div>
                                  <div className="settle-cash-row">
                                    <span>Less interest already paid</span>
                                    <span>−{rupees(paidD.toFixed(0))}</span>
                                  </div>
                                  <div className="settle-cash-row total">
                                    <span>Exact settlement payoff</span>
                                    <strong>{rupees(payoffD.toFixed(0))}</strong>
                                  </div>
                                </div>

                                {payoffD.isZero() && (
                                  <div
                                    className="info-note"
                                    style={{ margin: 0, fontSize: "12px" }}
                                  >
                                    Exact payoff is ₹0. Full principal and interest
                                    have already been satisfied. The agreement will
                                    close cleanly without creating empty payment
                                    rows.
                                  </div>
                                )}
                              </div>

                              <label>
                                Explanatory reason{" "}
                                <span style={{ color: "var(--gold)" }}>*</span>
                                <input
                                  type="text"
                                  value={settleReason}
                                  onChange={(e) =>
                                    setSettleReason(e.target.value)
                                  }
                                  placeholder="Required: explain reason for early settlement decision"
                                  maxLength={500}
                                  required
                                />
                              </label>

                              <label className="settle-confirm-check">
                                <input
                                  type="checkbox"
                                  checked={settleConfirmed}
                                  onChange={(e) =>
                                    setSettleConfirmed(e.target.checked)
                                  }
                                  disabled={isOverdraft}
                                />
                                <span>
                                  I confirm the early settlement terms: signed delta
                                  of{" "}
                                  <strong>
                                    {deltaD.isZero()
                                      ? "₹0"
                                      : deltaD.lt(0)
                                        ? `−${rupees(deltaD.abs().toFixed(0))}`
                                        : `+${rupees(deltaD.toFixed(0))}`}
                                  </strong>{" "}
                                  and exact cash settlement of{" "}
                                  <strong style={{ color: "var(--gold)" }}>
                                    {rupees(payoffD.toFixed(0))}
                                  </strong>
                                  . This action will atomically close this agreement.
                                </span>
                              </label>
                            </>
                          );
                        })()}
                      </>
                    )}
                  </>
                )}
              </fieldset>
              {formError && (
                <div className="message error" role="alert">
                  {formError}
                </div>
              )}
              {uncertain && (
                <div className="info-note">
                  The result is unconfirmed. Keep this form open and retry the
                  same submission. Financial submissions use a
                  duplicate-protection key.
                </div>
              )}
              <button
                className="primary full"
                disabled={
                  busy ||
                  (modal === "REPAY" &&
                    (repayPreview?.overpayment || !selected)) ||
                  (modal === "REPAY_LENDER" &&
                    (repayPreview?.overpayment ||
                      repayPreview?.insufficientCash ||
                      !selected)) ||
                  (modal === "EARLY_SETTLE" &&
                    (!settlePreview ||
                      settleLoading ||
                      !settleConfirmed ||
                      !settleReason.trim() ||
                      (settleDecision === "MANUAL" &&
                        (!manualInterest.trim() ||
                          isNaN(Number(manualInterest.trim())) ||
                          new D(manualInterest.trim()).lt(0) ||
                          new D(manualInterest.trim()).lt(
                            settlePreview?.interestPaid ?? "0",
                          ))) ||
                      (isBorrowing &&
                        settlePreview &&
                        new D(settlePreview.outstandingPrincipal)
                          .plus(
                            settleDecision === "SUGGESTED"
                              ? settlePreview.suggestedTotalInterest
                              : settleDecision === "RETAIN_CURRENT"
                                ? settlePreview.currentAdjustedInterest
                                : manualInterest.trim() || "0",
                          )
                          .minus(settlePreview.interestPaid)
                          .gt(data.available)))) ||
                  (!data.people.some((p) => p.borrowerId) &&
                    modal === "DISBURSE") ||
                  (!data.people.some((p) => p.lenderId) &&
                    modal === "BORROW")
                }
                type="submit"
              >
                {busy
                  ? "Saving…"
                  : uncertain
                    ? "Check the same submission"
                    : modal === "DISBURSE"
                      ? "Confirm disbursement"
                      : modal === "BORROW"
                        ? "Record borrowing"
                        : modal === "REPAY"
                          ? "Confirm repayment"
                          : modal === "REPAY_LENDER"
                            ? "Confirm lender repayment"
                            : modal === "EARLY_SETTLE"
                              ? "Confirm & settle agreement"
                              : modal === "CAPITAL"
                                ? "Record capital addition"
                                : "Save person"}
                {!busy && <Check size={18} />}
              </button>
            </form>
          )}
        </div>
      </dialog>
    </div>
  );
}
