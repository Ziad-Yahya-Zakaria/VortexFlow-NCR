# VortexFlow NCR

نظام NCR بواجهة `HTML/CSS/JS` كما هو، مع `Vercel Serverless API` ودعم مباشر لـ `PostgreSQL` و`Supabase Postgres + Supabase Storage` بدون إدخال إطار Frontend جديد.

## أهم الإضافات

- تسجيل دخول وجلسات آمنة عبر `HttpOnly Cookie`
- إنشاء أول حساب `Admin` من واجهة التطبيق
- إدارة مستخدمين وصلاحيات `admin / engineer / viewer`
- دعم `Supabase Postgres` كقاعدة البيانات الرئيسية
- نقل المرفقات إلى `Supabase Storage` بدلاً من تخزين الصور داخل قاعدة البيانات
- Workflow جاهز للنشر التلقائي من `GitHub` إلى `Vercel`
- استمرار الوضع المحلي `IndexedDB` عند غياب الخادم

## التشغيل المحلي

```bash
npm install
npx vercel dev
```

إذا لم تُشغّل الـ API أو لم تضبط قاعدة البيانات، سيعمل التطبيق محلياً في وضع `Offline / IndexedDB`.

## ربط Supabase

1. أنشئ مشروعاً على `Supabase`.
2. من إعدادات قاعدة البيانات انسخ `Connection String`.
3. ضعها في `DATABASE_URL` أو `SUPABASE_DB_URL`.
4. من `Project Settings > API` انسخ:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. اضبط `SUPABASE_STORAGE_BUCKET` أو اتركه `ncr-attachments`.
6. عند أول رفع مرفق سيُنشأ الـ bucket تلقائياً إذا لم يكن موجوداً.

## النشر التلقائي من GitHub إلى Vercel

الملف `.github/workflows/vercel-production.yml` جاهز.

أضف الأسرار التالية في `GitHub Repository Secrets`:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

ثم أضف متغيرات البيئة داخل مشروع `Vercel`:

- `DATABASE_URL` أو `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `SESSION_COOKIE_NAME`
- `SESSION_TTL_DAYS`

بعد ذلك أي `push` على فرع `main` سيعمل له نشر تلقائي.

## متغيرات البيئة

راجع `.env.example`.

- `DATABASE_URL`
- `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `SESSION_COOKIE_NAME`
- `SESSION_TTL_DAYS`

## ملاحظات تشغيلية

- الحد الأقصى الحالي للمرفقات عند الحفظ عبر الخادم: `3 MB`
- الحد الأقصى للمرفقات في الوضع المحلي: `10 MB`
- عند ضبط `Supabase Storage` يتم حفظ المرفق في الـ bucket، بينما تحتفظ قاعدة البيانات فقط بالاسم والنوع والحجم والمسار
- كل طلبات `GET /api/*` غير مخزنة داخل `Service Worker`
