# نشر قناة IPTV على خادم Linux

تضيف تهيئة IPTV الاختيارية قناة HLS واحدة إلى نشر Docker الحالي. ينتج **Independent Program** الصوت والصورة. يحوّل FFmpeg خرج MPEG-TS المحلي إلى قائمة HLS ومقاطع مستهدفة بطول ثانية واحدة دون إعادة الترميز، ويقدّمها Nginx عبر HTTPS. تبقى لوحة التحكم وصلاحيات المحطات على واجهة الإدارة الحالية.

رابط المشاهدة بعد بدء البث هو `https://mcr.example.com/iptv/program.m3u8`. الرابط **عام لأي شخص يستطيع الوصول إلى الدومين**. فعّل هذه التهيئة للمحتوى المصرّح ببثه للجمهور، أو ضع النشر على شبكة خاصة. يدعم هذا المسار جودة واحدة (720p25) لقناة واحدة. يدعم المحرك أيضًا إرسال SRT إلى مزوّد متوافق.

## التهيئة

1. جهّز خادم Linux دائم التشغيل مع Docker وDocker Compose، ووجّه الدومين إليه. اسمح باتصالات 80 و443، وضع `fullchain.pem` و`privkey.pem` في مجلد على الخادم خارج المستودع. منافذ UDP الداخلية لا تُنشر على الخادم.
2. أنشئ `deploy.env` في جذر المستودع على الخادم مع صلاحية قراءة للمسؤول فقط. استبدل الدومين ومسار الشهادة وكلمة مرور المدير. ولّد كل سر مستقلًا باستخدام `openssl rand -hex 32`.

   ~~~dotenv
   MCR_PUBLIC_ORIGIN=https://mcr.example.com
   MCR_TLS_DIRECTORY=/absolute/path/to/tls
   MCR_ADMIN_PASSWORD=
   JWT_SECRET=
   REFRESH_TOKEN_SECRET=
   ENCRYPTION_MASTER_KEY=
   MCR_PROGRAM_STATION_ID=
   MCR_PROGRAM_INPUT_URL=
   MCR_PROGRAM_SRT_URL=
   MCR_PROGRAM_SRT_PASSPHRASE=
   ~~~

3. شغّل الحاويات من جذر المستودع. عند نقل تثبيت قائم، احفظ نسخة من SQLite أولًا واستعمل اسم مشروع Compose نفسه حتى يُعاد استخدام وحدة التخزين.

   ~~~sh
   docker compose --env-file deploy.env -f backend/infrastructure/docker/docker-compose.yml -f backend/infrastructure/docker/docker-compose.iptv.yml config --quiet
   docker compose --env-file deploy.env -f backend/infrastructure/docker/docker-compose.yml -f backend/infrastructure/docker/docker-compose.iptv.yml up -d --build
   ~~~

4. سجّل الدخول في التثبيت الجديد بحساب `admin@mcrpro.local`. أنشئ المحطة أو اختر محطة قائمة. افتح `/api/v1/stations` على الدومين في جلسة دخول المدير، وانسخ قيمة `id` الخاصة بالمحطة إلى `MCR_PROGRAM_STATION_ID`.
5. لمصدر شبكة مُدار على الخادم، اضبط `MCR_PROGRAM_INPUT_URL` على رابط HTTPS مباشر يقدّم MPEG-TS. يمكن أيضًا ترك الإعداد فارغًا واستخدام مشهد محلي ترفعه من اللوحة. لإرسال نسخة SRT إلى مزوّد، اضبط `MCR_PROGRAM_SRT_URL` على عنوان مستقبل SRT، وأضف عبارة المرور إن لزم. أعد تشغيل أمر `up` ليقرأ Compose التعديلات.
6. افتح **Live Control → Independent Program → Start Program**. يبدأ الخرج بشاشة بديلة. بعد جاهزية المصدر، اختر **Take** للمشهد أو إشارة الشبكة. افتح رابط HLS في مشغّل IPTV بعد ظهور المقاطع الأولى.

## قبول النشر والتراجع

- افتح رابط HLS من جهاز مستقل، وتحقق من ظهور الصوت والصورة على مصدر معروف لمدة دقيقة على الأقل. يمكن استخدام `ffprobe -v error -show_entries stream=codec_name,codec_type https://mcr.example.com/iptv/program.m3u8` لتأكيد H.264 وAAC.
- أوقف **Program** من اللوحة، وتحقق من أن رابط القائمة يرجع 404 بعد انتهاء مهلة استقبال UDP والتنظيف. أعد بدء **Program** وتحقق من تشغيل القائمة مجددًا. تحقق أيضًا من استمرار وصول المشاهدين بعد تبديل المصدر داخل الجلسة.
- للتراجع عن توزيع IPTV، أوقف خدمة `hls` باستخدام نفس ملفات Compose، ثم شغّل تهيئة Docker الأساسية وحدها مع نفس اسم المشروع وملف البيئة. احتفظ بوحدة `mcr_sqlite` عند التراجع.
