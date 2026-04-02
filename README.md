# VortexFlow NCR

نظام NCR بواجهة `HTML/CSS/JS` كما هو، مع طبقة `Vercel Serverless API` وقاعدة بيانات `PostgreSQL` بدون إدخال إطار Frontend جديد.

## الجديد

- تسجيل دخول وجلسات آمنة عبر `HttpOnly Cookie`
- إنشاء أول حساب `Admin` من واجهة التطبيق
- إدارة مستخدمين وصلاحيات `admin / engineer / viewer`
- ربط دائم بـ `PostgreSQL`
- دعم نشر مباشر على `Vercel`
- تشغيل محلي احتياطي عبر `IndexedDB` عند غياب الخادم
- حقول NCR موسعة:
  - `priority`
  - `severity`
  - `owner`
  - `due date`
  - `root cause`
  - `corrective action`
  - `tags`
- سجل نشاط داخل تفاصيل التقرير
- إصلاح Service Worker لمنع كاش API

## التشغيل المحلي

```bash
npm install
npx vercel dev
```

إذا لم تشغّل الـ API أو لم تضبط قاعدة البيانات، سيعمل التطبيق محلياً بوضع `Offline / IndexedDB`.

## متطلبات Vercel

1. أنشئ قاعدة PostgreSQL أو استخدم Vercel Postgres / Neon.
2. أضف متغير البيئة `DATABASE_URL`.
3. انشر المشروع على Vercel.
4. افتح التطبيق لأول مرة وأنشئ أول مستخدم `Admin`.

## متغيرات البيئة

راجع الملف `.env.example`

- `DATABASE_URL`
- `SESSION_COOKIE_NAME`
- `SESSION_TTL_DAYS`

## ملاحظات تشغيلية

- الحد الأقصى للمرفقات عند الحفظ على الخادم: `3 MB`
- الحد الأقصى للمرفقات في الوضع المحلي: `10 MB`
- كل طلبات `GET /api/*` غير مخزنة في Service Worker
