import type { LedgerRow, ReportCategory } from "./types";

// ---- cash detection heuristic -------------------------------------------------
const CASH_WORDS = ["خزينة", "خزنة", "بنك", "كاش", "نقدية", "كريدي", "انستا", "محفظة"];
export function isCashRow(r: { account_name: string; group_name: string | null; category_name: string | null }) {
  const hay = `${r.account_name} ${r.group_name ?? ""} ${r.category_name ?? ""}`;
  if (hay.includes("النقدية")) return true;
  return CASH_WORDS.some((w) => r.account_name.includes(w));
}

export interface DateRange {
  from?: string; // inclusive ISO
  to?: string; // inclusive ISO
}

export function inRange(date: string, range?: DateRange): boolean {
  if (!range) return true;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

export function filterRows(rows: LedgerRow[], range?: DateRange, projectId?: string): LedgerRow[] {
  return rows.filter(
    (r) => inRange(r.date, range) && (!projectId || r.project_id === projectId)
  );
}

// ---- Trial Balance -----------------------------------------------------------
export interface TrialRow {
  account_id: string;
  account_code: string;
  account_name: string;
  report_category: ReportCategory | null;
  debit: number;
  credit: number;
  balance: number; // debit - credit
}

export function trialBalance(rows: LedgerRow[]): { rows: TrialRow[]; totalDebit: number; totalCredit: number } {
  const map = new Map<string, TrialRow>();
  for (const r of rows) {
    let t = map.get(r.account_id);
    if (!t) {
      t = {
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        report_category: r.report_category,
        debit: 0,
        credit: 0,
        balance: 0,
      };
      map.set(r.account_id, t);
    }
    t.debit += r.debit;
    t.credit += r.credit;
  }
  const out = [...map.values()];
  for (const t of out) t.balance = t.debit - t.credit;
  out.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));
  const totalDebit = out.reduce((s, t) => s + t.debit, 0);
  const totalCredit = out.reduce((s, t) => s + t.credit, 0);
  return { rows: out.filter((t) => t.debit || t.credit), totalDebit, totalCredit };
}

// ---- General Ledger (per account, running balance) ---------------------------
export interface LedgerAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  lines: (LedgerRow & { running: number })[];
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export function generalLedger(rows: LedgerRow[]): LedgerAccount[] {
  const map = new Map<string, LedgerAccount>();
  const sorted = [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.entry_no - b.entry_no
  );
  for (const r of sorted) {
    let g = map.get(r.account_id);
    if (!g) {
      g = {
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        lines: [],
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
      };
      map.set(r.account_id, g);
    }
    g.totalDebit += r.debit;
    g.totalCredit += r.credit;
    g.balance += r.debit - r.credit;
    g.lines.push({ ...r, running: g.balance });
  }
  return [...map.values()].sort((a, b) =>
    a.account_code.localeCompare(b.account_code, undefined, { numeric: true })
  );
}

// ---- Income Statement --------------------------------------------------------
export interface StatementLine {
  key: string;
  label: string;
  amount: number;
}
export interface IncomeStatement {
  // legacy flat view (kept for the dashboard & balance sheet)
  revenues: StatementLine[];
  expenses: StatementLine[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  // structured view that matches the owner's قائمة الدخل:
  //   Sales − Discount = Net Sales − Cost = Gross Profit − OpEx = Operating
  //   Profit + Other Income = Net Profit
  revenue: StatementLine[]; // gross revenue (Revenue group)
  grossRevenue: number;
  contra: StatementLine[]; // discounts etc. (shown negative)
  netSales: number;
  cogs: StatementLine[];
  totalCogs: number;
  grossProfit: number;
  opex: StatementLine[];
  totalOpex: number;
  operatingProfit: number;
  otherIncome: StatementLine[];
  totalOtherIncome: number;
  netProfit: number;
}

// Group names (set by the seed) that get special placement in the statement.
const CONTRA_REVENUE_GROUP = "Contra Revenue";
const OTHER_INCOME_GROUP = "Other Income";
const COGS_GROUP = "Cost of Sales";

/** Per-group totals for a category (sign applied to debit-credit). Legacy flat view. */
function groupSum(rows: LedgerRow[], cat: ReportCategory, sign: 1 | -1): StatementLine[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.report_category !== cat) continue;
    const key = r.group_name || r.category_name || r.account_name;
    map.set(key, (map.get(key) || 0) + sign * (r.debit - r.credit));
  }
  return [...map.entries()]
    .map(([label, amount]) => ({ key: label, label, amount }))
    .filter((l) => Math.abs(l.amount) > 0.005)
    .sort((a, b) => b.amount - a.amount);
}

/** Per-account lines for a category, each tagged with its group (for section buckets). */
function acctLines(rows: LedgerRow[], cat: ReportCategory, sign: 1 | -1) {
  const map = new Map<string, { label: string; group: string; amount: number }>();
  for (const r of rows) {
    if (r.report_category !== cat) continue;
    let a = map.get(r.account_id);
    if (!a) {
      a = { label: r.account_name, group: r.group_name || "", amount: 0 };
      map.set(r.account_id, a);
    }
    a.amount += sign * (r.debit - r.credit);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, label: v.label, group: v.group, amount: v.amount }))
    .filter((l) => Math.abs(l.amount) > 0.005);
}

export function incomeStatement(rows: LedgerRow[]): IncomeStatement {
  // income normal = credit-debit (sign -1 on debit-credit); expense normal = debit-credit (sign +1)
  const inc = acctLines(rows, "income", -1);
  const exp = acctLines(rows, "expense", 1);
  const strip = (l: { key: string; label: string; amount: number }) => ({
    key: l.key,
    label: l.label,
    amount: l.amount,
  });

  const revenue = inc.filter((l) => l.group !== CONTRA_REVENUE_GROUP && l.group !== OTHER_INCOME_GROUP).map(strip).sort((a, b) => b.amount - a.amount);
  const contra = inc.filter((l) => l.group === CONTRA_REVENUE_GROUP).map(strip).sort((a, b) => a.amount - b.amount);
  const otherIncome = inc.filter((l) => l.group === OTHER_INCOME_GROUP).map(strip).sort((a, b) => b.amount - a.amount);
  const cogs = exp.filter((l) => l.group === COGS_GROUP).map(strip).sort((a, b) => b.amount - a.amount);
  const opex = exp.filter((l) => l.group !== COGS_GROUP).map(strip).sort((a, b) => b.amount - a.amount);

  const sum = (ls: StatementLine[]) => ls.reduce((s, l) => s + l.amount, 0);
  const grossRevenue = sum(revenue);
  const totalContra = sum(contra); // negative
  const netSales = grossRevenue + totalContra;
  const totalCogs = sum(cogs);
  const grossProfit = netSales - totalCogs;
  const totalOpex = sum(opex);
  const operatingProfit = grossProfit - totalOpex;
  const totalOtherIncome = sum(otherIncome);
  const netProfit = operatingProfit + totalOtherIncome;

  // legacy flat view
  const revenues = groupSum(rows, "income", -1);
  const expenses = groupSum(rows, "expense", 1);
  const totalRevenue = revenues.reduce((s, l) => s + l.amount, 0);
  const totalExpense = expenses.reduce((s, l) => s + l.amount, 0);

  return {
    revenues,
    expenses,
    totalRevenue,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
    revenue,
    grossRevenue,
    contra,
    netSales,
    cogs,
    totalCogs,
    grossProfit,
    opex,
    totalOpex,
    operatingProfit,
    otherIncome,
    totalOtherIncome,
    netProfit,
  };
}

// ---- Balance Sheet -----------------------------------------------------------
export interface BalanceSheet {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquityRecorded: number;
  netIncome: number;
  totalEquity: number;
  totalLiabAndEquity: number;
  balanced: boolean;
}

export function balanceSheet(rows: LedgerRow[]): BalanceSheet {
  const assets = groupSum(rows, "asset", 1); // assets normal debit
  const liabilities = groupSum(rows, "liability", -1); // liabilities normal credit
  const equity = groupSum(rows, "equity", -1); // equity normal credit
  const totalAssets = assets.reduce((s, l) => s + l.amount, 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.amount, 0);
  const totalEquityRecorded = equity.reduce((s, l) => s + l.amount, 0);
  const inc = incomeStatement(rows);
  const netIncome = inc.netIncome;
  const totalEquity = totalEquityRecorded + netIncome;
  const totalLiabAndEquity = totalLiabilities + totalEquity;
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquityRecorded,
    netIncome,
    totalEquity,
    totalLiabAndEquity,
    balanced: Math.abs(totalAssets - totalLiabAndEquity) < 0.5,
  };
}

// ---- Cash Flow (sources & uses, indirect identity) ---------------------------
// Δcash = Σ (credit - debit) over all NON-cash lines, classified into 3 buckets.
export interface CashFlow {
  operating: StatementLine[];
  investing: StatementLine[];
  financing: StatementLine[];
  totalOperating: number;
  totalInvesting: number;
  totalFinancing: number;
  netChange: number;
  endingCash: number; // = netChange over ALL time when no range filter
}

function cfBucket(r: LedgerRow): "operating" | "investing" | "financing" {
  const cat = r.report_category;
  const g = `${r.group_name ?? ""} ${r.category_name ?? ""}`;
  if (cat === "equity") return "financing";
  if (cat === "asset" && (g.includes("ثابت") || g.includes("مجمع الاهلاك"))) return "investing";
  if (g.includes("جاري الشركاء") || g.includes("رأس المال") || g.includes("قروض")) return "financing";
  return "operating";
}

export function cashFlow(rows: LedgerRow[]): CashFlow {
  const buckets: Record<"operating" | "investing" | "financing", Map<string, number>> = {
    operating: new Map(),
    investing: new Map(),
    financing: new Map(),
  };
  for (const r of rows) {
    if (isCashRow(r)) continue; // skip cash side
    const impact = r.credit - r.debit; // effect on cash
    if (Math.abs(impact) < 0.005) continue;
    const b = cfBucket(r);
    const key = r.group_name || r.category_name || r.account_name;
    buckets[b].set(key, (buckets[b].get(key) || 0) + impact);
  }
  const toLines = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([label, amount]) => ({ key: label, label, amount }))
      .filter((l) => Math.abs(l.amount) > 0.005)
      .sort((a, b) => b.amount - a.amount);
  const operating = toLines(buckets.operating);
  const investing = toLines(buckets.investing);
  const financing = toLines(buckets.financing);
  const totalOperating = operating.reduce((s, l) => s + l.amount, 0);
  const totalInvesting = investing.reduce((s, l) => s + l.amount, 0);
  const totalFinancing = financing.reduce((s, l) => s + l.amount, 0);
  const netChange = totalOperating + totalInvesting + totalFinancing;
  return {
    operating,
    investing,
    financing,
    totalOperating,
    totalInvesting,
    totalFinancing,
    netChange,
    endingCash: netChange,
  };
}

// ---- Project P&L summary -----------------------------------------------------
export interface ProjectSummary {
  project_id: string | null;
  project_name: string;
  revenue: number;
  expense: number;
  net: number;
  debit: number;
  credit: number;
}

export function projectSummary(rows: LedgerRow[]): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>();
  for (const r of rows) {
    const id = r.project_id || "__none__";
    let p = map.get(id);
    if (!p) {
      p = {
        project_id: r.project_id,
        project_name: r.project_name || "بدون مشروع",
        revenue: 0,
        expense: 0,
        net: 0,
        debit: 0,
        credit: 0,
      };
      map.set(id, p);
    }
    p.debit += r.debit;
    p.credit += r.credit;
    if (r.report_category === "income") p.revenue += r.credit - r.debit;
    if (r.report_category === "expense") p.expense += r.debit - r.credit;
  }
  const out = [...map.values()];
  for (const p of out) p.net = p.revenue - p.expense;
  return out.sort((a, b) => b.expense - a.expense);
}
