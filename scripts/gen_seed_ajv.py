# -*- coding: utf-8 -*-
"""
Generate supabase/seed.sql from the source workbook(s).

Each workbook has a matrix-voucher sheet plus a 'Trial balance' sheet:
  * voucher sheet - Row 3 is the header (Ref, Date, Description, Net, Total,
    then one account name every 2 cols). Row 4 is the Credit/Debit sub-header.
    For an account whose NAME sits at 0-based column C: credit = row[C],
    debit = row[C+1]. Each subsequent row is ONE journal voucher. An opening
    row (Description 'op', whose Date cell is a bare time) carries the opening
    balances and is loaded as the first entry, dated `opening_date`.
  * 'Trial balance' - per-account totals; used to verify the import reconciles.

Output: supabase/seed.sql - wipes the current books, then inserts a fresh
entity, the chart-of-accounts tree, and every voucher as a journal entry.
"""
import os, io, datetime
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, "supabase", "seed.sql")

# Source workbooks, loaded in order into one continuous journal.
# Per-source options:
#   sheet              : voucher sheet name (default 'American journal voucher')
#   str_date_fixes     : corrected ISO date keyed by a raw TEXT date cell (parse fails)
#   opening_date       : date to stamp the 'op' opening-balance row (if present)
#   fix_jun25_feb_typo : remap 2026-06-25 -> 2026-02-25 ONLY for rows that appear
#                        before the March block (8 Feb vouchers were stamped '06'
#                        for '02'); real June-25 rows, which come after, are kept.
SOURCES = [
    {
        "path": os.path.join(ROOT, "من 1 ل 9.xlsx"),
        "sheet": "100",
        "opening_date": "2026-01-01",
        "fix_jun25_feb_typo": True,
        # Two June-13 vouchers have malformed text dates (double slash; one year typo'd 2028).
        "str_date_fixes": {"13/6//2026": "2026-06-13", "13/6//2028": "2026-06-13"},
    },
]

ENTITY_ID   = "11111111-1111-1111-1111-111111111111"
ENTITY_NAME = "الشركة الرئيسية"

# Arabic label + statement bucket for each report_category
CATEGORY = {
    "asset":     "الأصول",
    "liability": "الخصوم",
    "equity":    "حقوق الملكية",
    "income":    "الإيرادات",
    "expense":   "المصروفات",
}

# ---- APPROVED classification: account name -> (report_category, group) -------
# Order here also drives the account code numbering within each category.
CLASSIFY = [
    # ---- Balance sheet: assets ----
    ("Cash",                    "asset",     "Cash & Equivalents"),
    ("Bank",                    "asset",     "Cash & Equivalents"),
    ("Bank Masr",               "asset",     "Cash & Equivalents"),
    ("Vodafon Cash",            "asset",     "Cash & Equivalents"),
    ("Instapay 2",              "asset",     "Cash & Equivalents"),
    ("INSTAPAY",                "asset",     "Cash & Equivalents"),
    ("Paymob",                  "asset",     "Cash & Equivalents"),
    ("Value",                   "asset",     "Cash & Equivalents"),
    ("SYMPL",                   "asset",     "Cash & Equivalents"),
    ("Gift Card",               "asset",     "Cash & Equivalents"),
    ("Bank interest",           "asset",     "Cash & Equivalents"),
    ("Inventory",               "asset",     "Inventory"),
    ("Fixed assets",            "asset",     "Fixed Assets"),
    ("Prepared Expenses",       "asset",     "Other Current Assets"),
    ("Advance to employees",    "asset",     "Other Current Assets"),
    ("سلف",                     "asset",     "Other Current Assets"),
    ("Opreation",               "asset",     "Other Current Assets"),
    # ---- new bank/payment accounts introduced in Q2 ----
    ("Bank VISA",               "asset",     "Cash & Equivalents"),
    ("MONTERE",                 "asset",     "Cash & Equivalents"),
    ("ALEXBANK",                "asset",     "Cash & Equivalents"),
    ("ALEXBANK -INTEREST ACCOUNT", "asset",  "Cash & Equivalents"),
    ("insta pay 3",             "asset",     "Cash & Equivalents"),
    # ---- new accounts introduced in the Jan-Sep workbook ----
    ("other DEBTORS",           "asset",     "Other Current Assets"),
    ("Bueaty bar intarnational","asset",     "Other Current Assets"),
    # ---- Balance sheet: liabilities ----
    ("Suppliers",               "liability", "Payables"),
    ("deposits revenue",        "liability", "Payables"),
    ("Purchasing",              "liability", "Payables"),
    ("Bank interest cr",        "liability", "Payables"),
    # ---- Balance sheet: equity ----
    ("Capital",                 "equity",    "Equity"),
    ("Share holder's",          "equity",    "Equity"),
    ("Retained earning",        "equity",    "Equity"),
    ("p&l",                     "equity",    "Equity"),
    # ---- Income statement: income ----
    ("Sales",                   "income",    "Revenue"),
    # ---- Income statement: expenses ----
    ("Cost",                    "expense",   "Cost of Sales"),
    ("Administrative Expenses", "expense",   "Admin Expenses"),
    ("Shipping",                "expense",   "Operating Expenses"),
    ("Markting",                "expense",   "Operating Expenses"),
    ("Depreciation",            "expense",   "Operating Expenses"),
    ("other Ep",                "expense",   "Operating Expenses"),
    ("Discount",                "expense",   "Discounts & Refunds"),
    ("Refund",                  "expense",   "Discounts & Refunds"),
]

# account codes, numbered per category
CODE_PREFIX = {"asset": 1000, "liability": 2000, "equity": 3000, "income": 4000, "expense": 5000}


def norm_name(s):
    return None if s is None else str(s).strip()


def build_accounts():
    """Return dict keyed by normalized account name -> record, plus ordered lists."""
    acc = {}
    counters = dict(CODE_PREFIX)
    for name, cat, grp in CLASSIFY:
        key = norm_name(name)
        counters[cat] += 1
        acc[key] = {
            "name": key,
            "code": str(counters[cat]),
            "report": cat,
            "group": grp,
            "category": CATEGORY[cat],
        }
    return acc


def q(s):
    if s is None:
        return "null"
    return "'" + str(s).replace("'", "''") + "'"


def num(x):
    try:
        return str(round(float(x), 2))
    except Exception:
        return "0"


def parse_source(src, acc):
    """Parse one workbook's voucher sheet into a list of entry dicts."""
    wb = openpyxl.load_workbook(src["path"], read_only=True, data_only=True)
    ws = wb[src.get("sheet", "American journal voucher")]
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # header row (0-based index 2 == Excel row 3): map account name -> column C
    header = all_rows[2]
    name_to_col = {}
    for c, val in enumerate(header):
        nm = norm_name(val)
        if nm in acc:
            name_to_col[nm] = c  # credit at c, debit at c+1

    entries = []
    tot_d = tot_c = 0.0
    str_date_fixes = src.get("str_date_fixes", {})
    opening_date = src.get("opening_date")
    fix_jun25 = src.get("fix_jun25_feb_typo", False)
    seen_march = False  # once March rows appear, any 2026-06-25 is a real June date

    # data starts after the Credit/Debit sub-header (Excel row 4 == index 3).
    # Only rows carrying a resolvable date are vouchers (plus the 'op' opening
    # row); the footer "Total" and blank rows carry none and are skipped.
    for r in all_rows[4:]:
        if r is None:
            continue
        raw = r[1] if len(r) > 1 else None
        desc = norm_name(r[2] if len(r) > 2 else None)

        date = None
        if isinstance(raw, (datetime.datetime, datetime.date)):
            date = raw.strftime("%Y-%m-%d")
            if date.startswith("2026-03"):
                seen_march = True
            if fix_jun25 and date == "2026-06-25" and not seen_march:
                date = "2026-02-25"  # Feb voucher mis-stamped '06' for '02'
        elif isinstance(raw, str) and raw.strip() in str_date_fixes:
            date = str_date_fixes[raw.strip()]
        elif desc == "op" and opening_date:
            date = opening_date  # opening-balance row (Date cell is a bare time)
        if date is None:
            continue

        ref = r[0] if len(r) > 0 else None
        if desc == "op":
            desc = "Opening balance"
            if ref is None:
                ref = "OP"

        lines = []
        for nm, c in name_to_col.items():
            credit = r[c] if c < len(r) else None
            debit = r[c + 1] if (c + 1) < len(r) else None
            cv = float(credit) if isinstance(credit, (int, float)) else 0.0
            dv = float(debit) if isinstance(debit, (int, float)) else 0.0
            if cv == 0.0 and dv == 0.0:
                continue
            lines.append((nm, dv, cv))
            tot_d += dv
            tot_c += cv

        if not lines:
            continue  # blank rows carry no postings

        entries.append({
            "ref": str(int(ref)) if isinstance(ref, (int, float)) else norm_name(ref),
            "date": date,
            "desc": desc,
            "lines": lines,
        })

    return entries, tot_d, tot_c


def parse_journal(acc):
    """Load every source workbook into one continuous, chronologically-ordered journal."""
    entries, tot_d, tot_c = [], 0.0, 0.0
    for src in SOURCES:
        e, d, c = parse_source(src, acc)
        print(f"  {os.path.basename(src['path'])}: {len(e)} vouchers")
        entries.extend(e)
        tot_d += d
        tot_c += c
    return entries, tot_d, tot_c


def main():
    acc = build_accounts()
    entries, tot_d, tot_c = parse_journal(acc)

    # distinct categories & groups in declared order
    categories = []
    for r in acc.values():
        if r["category"] not in categories:
            categories.append(r["category"])
    group_pairs = []
    for r in acc.values():
        key = (r["category"], r["group"])
        if key not in group_pairs:
            group_pairs.append(key)
    cat_report = {r["category"]: r["report"] for r in acc.values()}

    out = io.StringIO()
    w = out.write
    w("-- ============================================================\n")
    w("-- AUTO-GENERATED SEED. Run AFTER schema.sql\n")
    w("-- Sources (loaded in order into one continuous journal):\n")
    for src in SOURCES:
        w(f"--   * {os.path.basename(src['path'])}\n")
    w("-- Wipes the existing books, then loads the chart of accounts and\n")
    w("-- every voucher (incl. the opening-balance entry) from the sources.\n")
    w("-- ============================================================\n")
    w("begin;\n\n")

    # ---- wipe existing data ----
    w("-- remove all existing entities and their books\n")
    w("delete from public.journal_lines;\n")
    w("delete from public.journal_entries;\n")
    w("delete from public.projects;\n")
    w("delete from public.accounts;\n")
    w("delete from public.entities;\n\n")

    # ---- entity ----
    w("-- entity\n")
    w(f"insert into public.entities (id, name, currency) values ({q(ENTITY_ID)}, {q(ENTITY_NAME)}, 'EGP');\n\n")

    # ---- categories ----
    w("-- chart of accounts: categories\n")
    w("insert into public.accounts (entity_id, code, name, type, report_category, category_name, is_postable) values\n")
    vals = []
    for c in categories:
        vals.append(f"  ({q(ENTITY_ID)}, {q('CAT::'+c)}, {q(c)}, 'category', {q(cat_report[c])}, {q(c)}, false)")
    w(",\n".join(vals) + ";\n\n")

    # ---- groups ----
    w("-- chart of accounts: groups\n")
    w("insert into public.accounts (entity_id, code, name, type, category_name, is_postable) values\n")
    vals = []
    for (cat, grp) in group_pairs:
        vals.append(f"  ({q(ENTITY_ID)}, {q('GRP::'+cat+'::'+grp)}, {q(grp)}, 'group', {q(cat)}, false)")
    w(",\n".join(vals) + ";\n\n")

    # ---- leaf accounts ----
    w("-- chart of accounts: postable accounts\n")
    w("insert into public.accounts (entity_id, code, name, type, report_category, group_name, category_name, is_postable) values\n")
    vals = []
    for r in acc.values():
        vals.append(f"  ({q(ENTITY_ID)}, {q(r['code'])}, {q(r['name'])}, 'account', {q(r['report'])}, {q(r['group'])}, {q(r['category'])}, true)")
    w(",\n".join(vals) + ";\n\n")

    # ---- link parents ----
    w("-- link groups -> categories\n")
    w("update public.accounts g set parent_id = c.id from public.accounts c\n")
    w(f"  where g.entity_id = {q(ENTITY_ID)} and g.type='group' and c.type='category'\n")
    w("    and c.entity_id = g.entity_id and c.code = 'CAT::' || g.category_name;\n\n")
    w("-- link accounts -> groups\n")
    w("update public.accounts a set parent_id = g.id from public.accounts g\n")
    w(f"  where a.entity_id = {q(ENTITY_ID)} and a.type='account' and g.type='group'\n")
    w("    and g.entity_id = a.entity_id and g.code = 'GRP::' || a.category_name || '::' || a.group_name;\n\n")

    # ---- journal entries ----
    w("-- journal entries\n")
    w("insert into public.journal_entries (entity_id, entry_no, ref_no, date, description) values\n")
    vals = []
    for i, e in enumerate(entries, start=1):
        vals.append(f"  ({q(ENTITY_ID)}, {i}, {q(e['ref'])}, {q(e['date'])}, {q(e['desc'])})")
    w(",\n".join(vals) + ";\n\n")

    # ---- journal lines ----
    w("-- journal lines\n")
    w("insert into public.journal_lines (entry_id, account_id, debit, credit, description)\n")
    w("select je.id, a.id, v.debit, v.credit, v.descr from (values\n")
    vals = []
    for i, e in enumerate(entries, start=1):
        for ln, (nm, dv, cv) in enumerate(e["lines"], start=1):
            code = acc[nm]["code"]
            vals.append(f"  ({i}, {q(code)}, {num(dv)}, {num(cv)}, {q(e['desc'])})")
    w(",\n".join(vals) + "\n")
    w(") as v(entry_no, code, debit, credit, descr)\n")
    w(f"join public.journal_entries je on je.entity_id = {q(ENTITY_ID)} and je.entry_no = v.entry_no\n")
    w(f"join public.accounts a on a.entity_id = {q(ENTITY_ID)} and a.code = v.code;\n\n")

    w("commit;\n")

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(out.getvalue())

    nlines = sum(len(e["lines"]) for e in entries)
    print("wrote", OUT)
    print(f"categories: {len(categories)}  groups: {len(group_pairs)}  accounts: {len(acc)}")
    print(f"entries: {len(entries)}  lines: {nlines}")
    print(f"total debit:  {round(tot_d, 2):,}")
    print(f"total credit: {round(tot_c, 2):,}")
    print(f"balanced: {abs(tot_d - tot_c) < 0.5}")


if __name__ == "__main__":
    main()
