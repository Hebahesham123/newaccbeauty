"use client";

import { useMemo, useState } from "react";
import { useEntity } from "@/components/EntityContext";
import { useLedger, useProjects } from "@/lib/data";
import { filterRows, incomeStatement } from "@/lib/reports";
import { fmtMoney } from "@/lib/format";
import { downloadCSV } from "@/lib/csv";
import { ReportToolbar, PageHeader, type ReportFilters } from "@/components/ReportToolbar";
import { Spinner, Card } from "@/components/ui";

export default function IncomeStatementPage() {
  const { entity, loading: entityLoading } = useEntity();
  const { rows, loading: ledgerLoading } = useLedger(entity?.id ?? null);
  const { projects } = useProjects(entity?.id ?? null);
  const [filters, setFilters] = useState<ReportFilters>({ from: "", to: "", projectId: "" });

  const f = useMemo(
    () => filterRows(rows, { from: filters.from || undefined, to: filters.to || undefined }, filters.projectId || undefined),
    [rows, filters]
  );
  const is = useMemo(() => incomeStatement(f), [f]);

  if (entityLoading) return <Spinner />;

  if (!entity) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <div className="text-6xl">🏢</div>
        <h2 className="text-lg font-bold text-slate-700">لا يوجد كيان محدد</h2>
        <p className="max-w-md text-sm text-slate-500">أضف كياناً من صفحة «الكيانات / الشركات» لعرض قائمة الدخل.</p>
      </div>
    );
  }

  const currency = entity.currency;

  const onExport = () => {
    const r: (string | number)[][] = [];
    is.revenue.forEach((l) => r.push(["الإيرادات", l.label, l.amount]));
    is.contra.forEach((l) => r.push(["الإيرادات", l.label, l.amount]));
    r.push(["", "صافي المبيعات", is.netSales]);
    is.cogs.forEach((l) => r.push(["تكلفة المبيعات", l.label, -l.amount]));
    r.push(["", "مجمل الربح", is.grossProfit]);
    is.opex.forEach((l) => r.push(["المصروفات التشغيلية", l.label, -l.amount]));
    r.push(["", "الربح التشغيلي", is.operatingProfit]);
    is.otherIncome.forEach((l) => r.push(["إيرادات أخرى", l.label, l.amount]));
    r.push(["", "صافي الربح / (الخسارة)", is.netProfit]);
    downloadCSV(`قائمة_الدخل_${entity.name}`, ["القسم", "البند", "المبلغ"], r);
  };

  const Money = ({ v, className = "" }: { v: number; className?: string }) => (
    <span className={`num ${className}`}>{fmtMoney(v, currency)}</span>
  );

  const period =
    filters.from || filters.to
      ? `عن الفترة من ${filters.from || "البداية"} إلى ${filters.to || "الآن"}`
      : "عن كامل الفترة";

  // reusable rows
  const LineRow = ({ label, v }: { label: string; v: number }) => (
    <tr className="text-slate-700">
      <td className="px-4 py-2 ps-8">{label}</td>
      <td className="px-4 py-2 text-left"><Money v={v} /></td>
    </tr>
  );
  const SectionRow = ({ label }: { label: string }) => (
    <tr className="bg-slate-50">
      <td className="px-4 py-2 text-sm font-bold text-slate-700" colSpan={2}>{label}</td>
    </tr>
  );
  const SubtotalRow = ({ label, v, strong = false }: { label: string; v: number; strong?: boolean }) => (
    <tr className={`font-bold ${strong ? "text-slate-900" : "text-slate-800"} border-t border-slate-200`}>
      <td className="px-4 py-2">{label}</td>
      <td className="px-4 py-2 text-left"><Money v={v} /></td>
    </tr>
  );

  return (
    <>
      <PageHeader title="قائمة الدخل" subtitle={entity.name} />
      <ReportToolbar filters={filters} setFilters={setFilters} projects={projects} onExport={onExport} />

      {ledgerLoading ? (
        <Spinner />
      ) : (
        <Card>
          <div className="mb-6 text-center">
            <h2 className="text-lg font-bold text-slate-800">{entity.name}</h2>
            <div className="mt-1 text-base font-semibold text-slate-700">قائمة الدخل</div>
            <div className="mt-0.5 text-sm text-slate-500">{period}</div>
          </div>

          <div className="mx-auto max-w-2xl">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {/* Revenue → Net Sales */}
                <SectionRow label="الإيرادات" />
                {is.revenue.map((l) => <LineRow key={l.key} label={l.label} v={l.amount} />)}
                {is.contra.map((l) => <LineRow key={l.key} label={`${l.label} (خصم)`} v={l.amount} />)}
                <SubtotalRow label="صافي المبيعات" v={is.netSales} />

                {/* Cost of Sales → Gross Profit */}
                {is.cogs.map((l) => <LineRow key={l.key} label={`تكلفة المبيعات — ${l.label}`} v={-l.amount} />)}
                <SubtotalRow label="مجمل الربح" v={is.grossProfit} />

                {/* Operating expenses → Operating Profit */}
                <SectionRow label="المصروفات التشغيلية" />
                {is.opex.length === 0 && (
                  <tr><td colSpan={2} className="px-4 py-2 text-center text-slate-400">لا توجد مصروفات تشغيلية</td></tr>
                )}
                {is.opex.map((l) => <LineRow key={l.key} label={l.label} v={-l.amount} />)}
                <SubtotalRow label="الربح التشغيلي" v={is.operatingProfit} />

                {/* Other income → Net Profit */}
                {is.otherIncome.length > 0 && <SectionRow label="إيرادات أخرى" />}
                {is.otherIncome.map((l) => <LineRow key={l.key} label={l.label} v={l.amount} />)}

                <tr className={is.netProfit >= 0 ? "bg-emerald-50" : "bg-red-50"}>
                  <td className={`px-4 py-3 text-base font-bold ${is.netProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    صافي الربح / (الخسارة)
                  </td>
                  <td className="px-4 py-3 text-left">
                    <Money v={is.netProfit} className={`text-base font-bold ${is.netProfit >= 0 ? "text-emerald-700" : "text-red-700"}`} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
