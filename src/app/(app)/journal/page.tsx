"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useEntity } from "@/components/EntityContext";
import { useEntries, fetchAll } from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Button, Input, Card, Spinner } from "@/components/ui";
import { PageHeader } from "@/components/ReportToolbar";
import type { LedgerRow } from "@/lib/types";

/** Local calendar date as YYYY-MM-DD (matches how entry.date is stored). */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function JournalPage() {
  const { entity } = useEntity();
  const entityId = entity?.id ?? null;
  const currency = entity?.currency ?? "EGP";
  const { entries, loading, reload } = useEntries(entityId);

  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [totalsLoading, setTotalsLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Date filter — defaults to today; widen `to` for a range, or clear both for all.
  const [from, setFrom] = useState<string>(() => todayStr());
  const [to, setTo] = useState<string>(() => todayStr());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!entityId) {
        setTotals(new Map());
        setTotalsLoading(false);
        return;
      }
      setTotalsLoading(true);
      try {
        const rows = await fetchAll<LedgerRow>("v_ledger", entityId, "entry_id,debit");
        if (cancelled) return;
        const map = new Map<string, number>();
        for (const r of rows) {
          map.set(r.entry_id, (map.get(r.entry_id) ?? 0) + (Number(r.debit) || 0));
        }
        setTotals(map);
      } catch {
        if (!cancelled) setTotals(new Map());
      } finally {
        if (!cancelled) setTotalsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId, entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (
        q &&
        !(
          String(e.entry_no).includes(q) ||
          (e.description ?? "").toLowerCase().includes(q) ||
          (e.ref_no ?? "").toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [entries, search, from, to]);

  const grandTotal = useMemo(
    () => filtered.reduce((s, e) => s + (totals.get(e.id) ?? 0), 0),
    [filtered, totals]
  );

  async function handleDelete(id: string, entryNo: number) {
    if (!window.confirm(`هل تريد حذف القيد رقم ${entryNo}؟ سيتم حذف سطوره أيضاً.`)) return;
    const sb = supabaseBrowser();
    const { error } = await sb.from("journal_entries").delete().eq("id", id);
    if (error) {
      window.alert(`تعذّر الحذف: ${error.message}`);
      return;
    }
    await reload();
  }

  if (!entity) {
    return (
      <div dir="rtl">
        <PageHeader title="قيود اليومية" />
        <Card>
          <p className="py-8 text-center text-sm text-slate-500">الرجاء اختيار منشأة لعرض القيود.</p>
        </Card>
      </div>
    );
  }

  const busy = loading || totalsLoading;

  return (
    <div dir="rtl">
      <PageHeader title="قيود اليومية" subtitle="إدارة قيود اليومية">
        <Link href="/journal/new">
          <Button>+ قيد جديد</Button>
        </Link>
      </PageHeader>

      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <span className="mb-1 block text-xs font-semibold text-slate-500">بحث</span>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم القيد أو البيان…"
              />
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-slate-500">من تاريخ</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-slate-500">إلى تاريخ</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" />
            </label>
            <Button
              variant="outline"
              onClick={() => {
                setFrom(todayStr());
                setTo(todayStr());
              }}
            >
              اليوم
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              كل التواريخ
            </Button>
          </div>
          <div className="text-sm text-slate-600">
            عدد القيود: <span className="num font-semibold">{filtered.length}</span>
            {" — "}الإجمالي:{" "}
            <span className="num font-semibold">{fmtMoney(grandTotal, currency)}</span>
          </div>
        </div>

        {busy ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">لا توجد قيود.</p>
        ) : (
          <div className="overflow-auto">
            <table className="sheet">
              <thead>
                <tr>
                  <th>رقم القيد</th>
                  <th>التاريخ</th>
                  <th>البيان</th>
                  <th>المرجع</th>
                  <th>إجمالي المدين</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="num font-semibold text-slate-700">{e.entry_no}</td>
                    <td>{fmtDate(e.date)}</td>
                    <td>{e.description || "—"}</td>
                    <td>{e.ref_no || "—"}</td>
                    <td className="num">
                      <span className="num">{fmtMoney(totals.get(e.id) ?? 0, currency)}</span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Link href={`/journal/${e.id}`}>
                          <Button variant="ghost">عرض/تعديل</Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => handleDelete(e.id, e.entry_no)}
                        >
                          حذف
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
