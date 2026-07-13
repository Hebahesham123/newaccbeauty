# نظام المحاسبة — Accounting System

نظام محاسبة متكامل بُني بـ **Next.js (App Router) + React + TypeScript + Tailwind + Supabase**،
يحوّل ملف الإكسل «ارسال قيود يومية» إلى نظام كامل قابل للتوسعة.

A full double‑entry accounting system that turns your `ارسال قيود يومية.xlsx` into a real app.

## ✨ المميزات / Features

- **كيانات متعددة (Entities)** — أضف شركات/كيانات بلا حدود، مع **رفع شعار/صورة** لكل كيان، وتبديل الكيان الحالي.
- **شجرة حسابات قابلة للتعديل** — 3 مستويات (تصنيف ← مجموعة ← حساب)، إضافة/تعديل/حذف أي عقدة.
- **المشاريع (Cost Centers)** — أضف مشاريع، اربطها بالقيود، تابع الإنفاق مقابل الموازنة.
- **قيود اليومية** — محرر قيد مزدوج (مدين/دائن) مع تحقق التوازن قبل الحفظ.
- **التقارير المالية المحسوبة آلياً:**
  - دفتر الأستاذ (General Ledger) بأرصدة جارية
  - ميزان المراجعة (Trial Balance)
  - الميزانية العمومية (Balance Sheet)
  - قائمة الدخل (Income Statement)
  - قائمة التدفقات النقدية (Cash Flow)
  - تقارير الحسابات (Account Reports)
- **تصدير CSV + طباعة** لكل تقرير، فلترة بالتاريخ والمشروع.
- **مستخدمون وصلاحيات** — مستخدم عادي / مدير (admin)، مع مدير افتراضي `abdelrahman`.
- بياناتك الحقيقية مُحمّلة مسبقاً: **941 حساباً، 64 مشروعاً، 110 قيوداً (3228 سطراً)** متوازنة تماماً.

---

## 🚀 خطوات التشغيل / Setup

### 1) أنشئ مشروع Supabase
اذهب إلى <https://supabase.com> → New Project. بعد إنشائه افتح **Project Settings → API** وانسخ:
- `Project URL`
- `anon public key`
- `service_role key` (سري — لا تضعه في المتصفح)

### 2) أنشئ الجداول والبيانات
في **SQL Editor** بلوحة Supabase نفّذ بالترتيب:
1. محتوى `supabase/schema.sql`  (الجداول + الصلاحيات RLS + التخزين)
2. محتوى `supabase/seed.sql`    (شجرة الحسابات + المشاريع + القيود من الإكسل)

> seed.sql كبير (~5400 سطر). انسخه كاملاً ونفّذه مرة واحدة.

### 3) إعداد متغيرات البيئة
انسخ `.env.local.example` إلى `.env.local` واملأ القيم:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
```

### 4) ثبّت الحزم وشغّل
```bash
npm install
npm run dev
```
افتح <http://localhost:3000>.

### 5) أنشئ المدير «abdelrahman»
```bash
npm run seed
```
سيُنشئ المستخدم ويمنحه صلاحية المدير ويطبع بيانات الدخول:
```
email:    abdelrahman@admin.local
password: Admin@12345
```
> لتغيير البريد/كلمة المرور: `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed`.
> أو سجّل أي مستخدم من شاشة الدخول ثم رقّه عبر `supabase/make_admin.sql`.

---

## 🧮 كيف تُحسب التقارير

كل قيد سطرين على الأقل (مدين = دائن). التقارير تُبنى من العرض `v_ledger`:

- **ميزان المراجعة:** مجموع المدين والدائن لكل حساب.
- **الميزانية:** الأصول = (مدين − دائن) للحسابات الأصول؛ الخصوم/حقوق الملكية = (دائن − مدين)؛
  ويُضاف **صافي ربح الفترة** إلى حقوق الملكية ليتحقق التوازن (الأصول = الخصوم + حقوق الملكية).
- **قائمة الدخل:** الإيرادات (دائن − مدين) − المصروفات (مدين − دائن).
- **التدفقات النقدية:** بطريقة المطابقة غير المباشرة — التغير في النقدية = Σ(دائن − مدين) لكل
  الحسابات غير النقدية، مُصنّفة إلى تشغيلية / استثمارية / تمويلية.

تصنيف الحساب في القوائم محفوظ في عمود `report_category` (asset / liability / equity / income / expense)
ويمكن تعديله من شاشة **شجرة الحسابات**.

---

## 🗂 بنية المشروع

```
.                     ← جذر المشروع (هو نفسه مجلد تطبيق Next.js)
  supabase/
    schema.sql        ← الجداول + RLS + التخزين + view التقارير
    seed.sql          ← بياناتك (مولّدة من الإكسل)
    make_admin.sql    ← ترقية مستخدم إلى مدير
  scripts/
    gen_seed.py       ← يعيد توليد seed.sql من ./data/*.json
    seed.mjs          ← ينشئ مدير abdelrahman (npm run seed)
  data/               ← JSON مُستخرَج من الإكسل (accounts/projects/journal_lines)
  src/
    app/
      login/                       ← تسجيل الدخول/إنشاء حساب
      (app)/
        dashboard/                 ← لوحة المؤشرات
        entities/                  ← الكيانات + رفع الصور
        accounts/                  ← شجرة الحسابات
        projects/                  ← المشاريع
        journal/ ، journal/new ، journal/[id]
        reports/ general-ledger | trial-balance | balance-sheet
                 | income-statement | cash-flow | account-reports
    components/   ← واجهة مشتركة (ui, EntityContext, ReportToolbar, JournalEntryForm)
    lib/          ← supabase clients, types, reports (الحسابات), data hooks, csv, format
```

## 🖼 تضمين النظام داخل لوحة أدمن أخرى (Embedding)

لتشغيل هذا النظام داخل `<iframe>` في تطبيق أدمن آخر:

1. في متغيّرات البيئة (Vercel) اضبط النطاق المسموح له بالتضمين:
   ```
   FRAME_ANCESTORS='self' https://your-admin-domain.com
   NEXT_PUBLIC_EMBED=true
   ```
   - `FRAME_ANCESTORS` يُرسَل كترويسة `Content-Security-Policy: frame-ancestors …`
     (ولا نرسل `X-Frame-Options` كي لا يمنع التضمين).
   - `NEXT_PUBLIC_EMBED=true` يجعل كوكيز الجلسة `SameSite=None; Secure` لتعمل عبر المواقع.
2. أعِد النشر (Redeploy).
3. في الأدمن ضع: `<iframe src="https://accountingnew.vercel.app" …></iframe>`.

**تنبيهات مهمة:**
- يجب أن يكون كلا الموقعين على **HTTPS**.
- المتصفحات الحديثة تحجب كوكيز الطرف الثالث؛ الأكثر موثوقية أن يكون النظام على
  **نطاق فرعي من الأدمن** (مثل `accounting.your-admin.com`) ليُعامل كنفس الموقع،
  أو الاعتماد على متصفحات تدعم الكوكيز المُجزّأة (CHIPS/Partitioned).
- إن لم تُضمّن النظام، اترك `NEXT_PUBLIC_EMBED` فارغاً (الوضع الافتراضي الأكثر أماناً).

## ملاحظات
- الصلاحيات (RLS) مفعّلة: أي مستخدم مسجّل يقرأ/يكتب الدفاتر؛ المدير يدير المستخدمين.
  يمكن لاحقاً تضييقها لكل كيان حسب المالك.
- العملة الافتراضية `EGP` وتُضبط لكل كيان.
- لإعادة توليد `seed.sql` بعد تعديل الإكسل: `python scripts/gen_seed.py`.
