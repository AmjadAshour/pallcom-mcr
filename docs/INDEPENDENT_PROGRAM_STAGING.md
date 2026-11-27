# Independent Program · local staging runbook

The Phase 2 slice serves one explicitly configured station on one always-on Node control host. Live Control starts a local GStreamer worker. It publishes H.264 at 1280×720/25 fps with 48 kHz stereo AAC in MPEG-TS over UDP. The receiver and optional OBS sender run on the worker host. The existing OBS controls and playout scheduler continue to address their original OBS outputs.

## Configure a staging station

1. Select an existing disposable station or create one in a staging database. Set `MCR_PROGRAM_STATION_ID` to its ID on the API host. Run one API instance for this station. Use trusted local accounts on the media host since loopback UDP has no sender authentication.
2. Provide a Python environment with PyGObject, GStreamer and the plugins used by [the worker](../backend/src/infrastructure/program/worker.py). On the tested Windows x64 host, Python 3.12 and `gstreamer-bundle==1.28.9` supplied the runtime. For example, create a virtual environment, install that wheel with its Python interpreter, then set `MCR_PROGRAM_PYTHON` to that interpreter's absolute path. Prime the plugin registry with that account before the first start. Check codec distribution/licensing for any deployment.
3. Choose two distinct, unused UDP ports above 1023. The defaults are `MCR_PROGRAM_INPUT_PORT=5100` and `MCR_PROGRAM_OUTPUT_PORT=5102`. Set `MCR_PROGRAM_SLATE` to `bars`, `blue` or `black`. The slate includes silence. Set environment values before starting the server. There are no client-supplied paths, destinations or commands.
4. Open **Live Control → Independent Program → Start Program**. On the host, open `ffplay udp://127.0.0.1:5102` using the configured output port. Use a single receiver on this unicast port. To retain a sample instead, use `ffmpeg -i udp://127.0.0.1:5102 -t 10 -map 0:v -map 0:a -c copy sample.ts` with a fresh staging file.
5. In a dedicated OBS profile, choose **Advanced Output → Recording → Custom Output (FFmpeg)**, output to URL, container `mpegts`, H.264 video and AAC audio, with destination `udp://127.0.0.1:5100?pkt_size=1316`. Start that profile's custom recording to contribute media. The MCR worker needs only the signal. Wait for five seconds of healthy decoded picture and audio and choose **Take OBS**. Stop the contribution to test loss. After about one second without either required track the worker selects the configured slate. On reconnect the operator must explicitly take OBS again. **Take slate** also works manually.
6. Close the operator browser to leave Program running. Use **Stop Program** to release the worker and ingest port. Configuration belongs to the host administrator. Station reads use the existing read permission, actions require control permission and station/organization scope. Action requests are audited. A stopped API or worker ends this test output; start Program again after service recovery. The free Render blueprint and the stock Node container do not provision the worker runtime.

## Verification on 24 November 2026

| Scenario | Check and observed result |
|---|---|
| Cold start | With OBS closed, started the worker on a blue slate. A separate FFmpeg process decoded RGB 0/0/255 from the output socket. |
| Actual OBS contribution | Launched an isolated portable copy of the installed OBS Studio with a dedicated profile, red test clip and tone. Once ready, a take produced a red receiver frame (253/24/0 after decoder scaling). |
| OBS loss | Terminated only the portable fixture. The same receiver returned to blue by decoded frame 400. |
| Reconnect | Relaunched the portable fixture. The receiver still showed blue when input returned to ready; an explicit retake produced red at frame 618. The Program session ID stayed the same across both takes and signal loss. |
| Browser independence | Started Program from the built Live Control page in Chrome with a disposable SQLite station, closed the operator tab and browser, then recorded 10.029 s in a separate FFmpeg receiver. ffprobe identified 1280×720 H.264 and 48 kHz AAC. Inspected a decoded frame showing the configured color bars. The API returned the original session and the authorized stop succeeded. |
| Authorization | Viewer start returned 403 and a different organization's administrator received 404. The scoped operator surface worked without an online OBS Agent. |
| Automated regression | `npm test` passed 23 tests using temporary SQLite. Both builds passed. `node backend/verification/program-loopback.js` exercised the receiver transitions with a synthetic FFmpeg sender. It requires the same Python environment, FFmpeg on PATH and two unused loopback ports (fixture defaults 25100 and 25102). |
 
These are local receiver and control checks. Exact switch latency, packet-by-packet continuity, listening quality, long-duration operation, crash recovery, external delivery and production capacity were not qualified. For rollback stop Program, remove the station opt-in, and restart the control service. No schema migration is required.

## Global Program watermark

On the configured independent station, open **Live Control → Independent Program → Program watermark**. An operator with station control permission can reuse the station logo from Graphics or upload a single-frame PNG, JPEG or WebP up to 512 KB. Preview shows the pending logo over a clean, sampled image of the selected input, or an empty canvas while Program is stopped. **Apply to Program** saves an immutable copy of the selected logo and layout. Apply with **Enable watermark** cleared to remove it. Reload saved settings to discard edits or resolve a concurrent edit.

The four anchors refer to physical canvas corners in both interface languages. Horizontal and vertical insets are percentages of canvas width and height, measured inward from the chosen corner. Size is a percentage of canvas width. An oversized or tall logo shrinks proportionally to fit the remaining rectangle. Opacity multiplies the image's own alpha. The staging output profile is 1280×720 at 25 fps. Preview scales the same coordinate system to fit the operator's display.

The worker composites the watermark after the input switch and before the Program encoder, above ads and graphics already composited into the selected source. Reserve that final layer above any future native ad compositor. Browser Source graphics on the legacy OBS output retain their own controls. Draft edits stay in the editor until applied. Applied settings and the normalized bitmap live in the station-scoped SQLite program_watermarks row. A running worker reports its applied revision; a stopped worker restores it before encoding on its next start. The worker requires the gdkpixbufoverlay and jpegenc plugins and the GdkPixbuf Python introspection binding.

Run `node backend/verification/watermark-loopback.js` after setting the staging Python interpreter and reserving localhost UDP ports 25200 and 25202. The fixture uses temporary SQLite, generated artwork, a synthetic contribution and a separate FFmpeg decoder. To exercise the actual Preview editor as well, build the frontend and set MCR_TEST_PLAYWRIGHT to the installed Playwright module URL and MCR_TEST_CHROME to Chrome's executable. Disable and apply to roll back the on-air change.

## Ad placements, playlists and schedules

Open **Live Control → Independent Program → Ad placements** on the opted-in station. Upload a PNG, JPEG, WebP or MP4, select it in the library and append it to a placement. Use Earlier/Later to reorder its playlist. Each placement has its own enabled checkbox, rectangle, layer and optional schedule. Image and video rectangles fill their specified width and height. Coordinates and movement are percentages of the full Program canvas, measured from the physical top left. The placement outline shows the starting rectangle. The Preview animates enabled draft playlists together over the sampled input and identifies intersecting boxes. Replay draft playlists restarts the audition; closing Preview has no effect on scheduling.

**Apply ads to Program** commits the whole draft with a revision check. Reload saved plan resolves an editing conflict. Live controls operate on the applied placement by ID. Pause holds the current frame, animation position or transparent gap. Resume continues from there. Skip advances to the following item immediately, including from a gap; skipping while paused cues that item and stays paused. Disable now removes only that placement and persists its disabled state. Re-enable it in the editor and Apply. The visible-placement count is sampled from the worker. Unchecking all placements and applying removes the ad layer while Program continues.

### Timing and rendering

- A placement repeats its playlist in order. Each slot consists of display duration followed by that item's gap. During a gap the placement is transparent, exposing lower placements and the source. Fade-in and fade-out run inside the display duration. Movement interpolates linearly from the configured rectangle by the item's X/Y displacement. The canvas clips off-screen motion.
- Video ads are silent, leaving Program audio intact. Playback starts at frame zero on each occurrence. Short clips loop for the display window; long clips cut at its end. Import samples video at 12.5 fps. Program renders at 25 fps. Images retain transparency.
- Set an IANA time zone, then enter optional local start/end times for the placement or an individual ad. Apply resolves them to UTC instants. A start is inclusive and an end is exclusive. Blank bounds are open. Ambiguous or nonexistent DST times are rejected. An ineligible ad reserves its normal slot transparently, keeping subsequent reservations predictable. Preview auditions the sequence without calendar gates.
- The Node broadcast supervisor evaluates schedules while the worker runs, with a wall clock for eligibility and a monotonic elapsed clock for rotation. It sends render updates independently of browser polling. Only one update is outstanding; if the worker is delayed it catches up to the current position. Four persistent ad layers composite after source selection and below the global watermark. Higher layer values draw above lower ones; equal values use ascending placement ID, with the later ID on top. Placements starting together share the same time sample.
- Scene changes, OBS loss and fallback change the underlying source. Placement schedules continue. Imports store normalized media and frames in station-scoped SQLite. Removing the original file after import has no effect. Removal of an assigned library creative is rejected; an unavailable or damaged stored frame leaves its slot transparent until a usable frame or following item.
- SQLite persists schedule anchors, offsets and manual overrides. After a service outage the existing Program must be started again. A running playlist rejoins its current position including downtime, an expired window stays clear, and paused or disabled placements keep their override. Layout-only edits preserve the playback position. Changing a playlist, start time or enabled state starts a new timeline anchored at its scheduled start, or at Apply when unscheduled.

### Staging limits and evidence

One station can store 32 creatives, configure four independently enabled placements, and assign 40 entries per placement. Uploads are limited to 12 MB. MP4 import requires FFmpeg on the API host (or FFMPEG_PATH); accepted clips cover up to 375 normalized frames, approximately 30 seconds. Normalized video fits within 640×360 before placement scaling. SQLite holds both the operator preview media and the prepared frames; include the database in backups.

Run `node --test backend/test/program-ads.test.js` for deterministic clock, ordering, gaps, simultaneous starts, manual control, restart and DST checks. Run `node backend/verification/ads-loopback.js` with the staging Python runtime, FFmpeg and ffprobe. It uses ports 25300/25302, a temporary database, a separate receiver and generated image/video fixtures. Optional MCR_TEST_PLAYWRIGHT and MCR_TEST_CHROME exercise the built editor, highlight overlapping boxes, and verify explicit apply before closing the browser. The fixture checks decoded frame timing, positions, size, stacking, fades, motion and video looping. It prints measurements and retains the receiver transport stream and a decoded overlap frame in its temporary directory.

## أول دفعة من المشاهد المستقلة

في **Live Control → Independent Program → مشهد محلي** اختر فيديو وصورة مستوردين من مكتبة الإعلانات. اضبط موضع الصورة وأبعادها من المعاينة، ثم احفظ المشهد أو اضغط **أخذ المشهد المحلي** لتطبيقه على Program. يعمل الفيديو كخلفية متكررة مع صوته عند توفره. المعاينة في المتصفح صامتة، وتبقى مواضع الإعلانات والشعار العام فوق المشهد. استخدم **Take slate** أو **Take OBS** لتغييره. يحفظ النظام مشهدًا محليًا واحدًا لكل محطة، ويتطلب أخذه مجددًا بعد بدء جلسة Program جديدة.

يتحقق فحص `node backend/verification/local-scene-loopback.js` من حفظ المشهد، بقاء اللوحة قبل Take، فك ترميز الفيديو والصورة مع الإعلان والشعار على مستقبل منفصل، ثم العودة إلى اللوحة بنفس الجلسة. يتطلب أدوات الوسائط وبيئة Python الموضحة أعلاه ومنفذي 25300 و25302 متاحين وOBS مغلقًا. للتراجع التشغيلي اختر لوحة الانتظار. يدعم الصوت ملفات MP4 المستوردة بعد هذا التحديث. أعد استيراد أي فيديو قديم لاستعادة صوته. تعمل الملفات التي لا تحتوي على مسار صوتي بصمت. تبقى مصادر الشبكة ومعاينة المشاهد من المحرك ضمن العمل اللاحق.

### معاينة إشارة الشبكة

افتح **معاينة مدخل البث الشبكي (OBS / MPEG-TS)** أثناء تشغيل Program. تعرض اللوحة لقطات من مدخل MPEG-TS الوارد قبل اختياره للبث. يمكن استخدام OBS أو مرسل متوافق يرسل H.264/AAC إلى منفذ الإدخال المحلي المهيأ. زر **بث مصدر OBS** يأخذ هذا المدخل عند الجاهزية. عند فقد الإشارة تختفي المعاينة ويعود Program إلى لوحة الانتظار إذا كان المدخل على الهواء. يمكن استقبال الإشارة من جهاز آخر على شبكة خاصة بتعيين MCR_PROGRAM_INPUT_HOST إلى عنوان IPv4 خاص مخصّص لخادم البث. القيمة الافتراضية 127.0.0.1. اترك خرج Program على المستقبل المحلي كما هو.

For LAN contribution, set MCR_PROGRAM_INPUT_HOST on the server to its assigned private IPv4 address and restart the control service. In the sender use the UDP address and port shown under Contribution Preview. Use H.264/AAC MPEG-TS. Restrict inbound UDP on that port to the trusted sender in the host firewall because this UDP transport does not authenticate senders. Program delivery still uses loopback. URL pull and internet-facing ingest are outside this setup.

### استقبال رابط بث مباشر

لتشغيل مصدر مباشر بدل مدخل UDP، يضبط مسؤول الخادم MCR_PROGRAM_INPUT_URL على رابط HTTPS يقدّم MPEG-TS مباشرًا بترميز H.264/AAC، ثم يعيد تشغيل خدمة التحكم ويبدأ Program. افتح معاينة المدخل وانتظر الجاهزية ثم اختر **أخذ إشارة الرابط**. عند الانقطاع تنتقل الصورة إلى لوحة الانتظار، ويعيد المحرك الاتصال تلقائيًا. يبقى الرجوع إلى الهواء بقرار المشغّل. يستخدم الوضعان خانة مدخل واحدة. أزل المتغير لاستعادة UDP.

يحتاج وضع الرابط إلى مكوّن souphttpsrc في GStreamer. يقبل HTTP على 127.0.0.1 فقط لبيئة الاختبار. ترفض إعادة التوجيه، ولا يعرض API عنوان الرابط. استخدم فقط مصادر موثوقة يضبطها مسؤول الخادم. يختبر MCR_TEST_INPUT_URL=1 مع node backend/verification/program-loopback.js مصدرًا محليًا ورفض إعادة التوجيه والانقطاع وإعادة الأخذ. الوضع مخصّص لـ MPEG-TS المباشر.

### تسجيل خرج Program

اضبط MCR_PROGRAM_RECORDING_DIR على مسار مطلق لمجلد موجود يملك حساب خدمة البث حق الكتابة فيه. يبدأ التسجيل تلقائيًا مع كل جلسة Program وينتهي عند **Stop Program**. يظهر اسم الملف وحالته في **Live Control**. يستقبل الملف MPEG-TS بعد تركيب جميع الطبقات والصوت، مثل خرج UDP. خذ الملف من المجلد على جهاز البث. استخدم مجلدًا مخصصًا وتابع سعته واحتفظ بالملفات حسب سياسة المحطة. لإلغاء التسجيل في الجلسات الجديدة أزل المتغير وأعد تشغيل الخدمة. فشل فتح الملف يظهر في حالة التسجيل ويترك خرج UDP يعمل.

### وجهات SRT لخرج Program

اضبط MCR_PROGRAM_SRT_URL على رابط مثل srt://127.0.0.1:25504?mode=caller، ثم ابدأ جلسة Program. شغّل المستقبل في وضع listener. يحتاج العامل إلى مكوّن srtsink في GStreamer. يرسل SRT نفس MPEG-TS المرمّز الذي يستخدمه UDP المحلي. تعرض اللوحة حالة الاتصال أو الإرسال أو إعادة المحاولة. تشير حالة الإرسال إلى تقدّم عدّاد الإرسال، وتأكيد الصورة والصوت يتم عند المستقبل. يبقى عنوان الوجهة ومعاملاته في إعدادات الخادم. أزل المتغير لوقف SRT في الجلسات التالية.

لتشفير وجهة SRT، ضع عبارة مرور تتراوح بين 10 و79 بايت في إعداد الخادم MCR_PROGRAM_SRT_PASSPHRASE. يستخدم هذا الإعداد مفتاحًا بطول 32 بايت. اضبط عبارة المرور نفسها على المستقبل. تعرض لوحة التشغيل حالة التشفير والإرسال فقط. لتكرار اختبار المفتاح الخاطئ ثم الصحيح، اضبط MCR_TEST_SRT_ENCRYPTED=1 قبل تشغيل اختبار SRT المحلي.

لإضافة وجهة مستقلة اضبط `MCR_PROGRAM_SECOND_SRT_URL` على عنوان مستقبل ثانٍ، مثل `srt://127.0.0.1:25506?mode=caller` في الاختبار المحلي. يمكن تعيين عبارة مرور خاصة بها في `MCR_PROGRAM_SECOND_SRT_PASSPHRASE`. تُقرأ الإعدادات عند بدء جلسة Program، وتعرض Live Control حالة كل وجهة على حدة. عند توقف مستقبل تعيد وجهته الاتصال في الخلفية بينما يستمر الإرسال إلى المستقبل الآخر وإلى UDP. لإلغاء الوجهة الثانية، أزل متغيريها قبل بدء الجلسة التالية.

يشغّل `node backend/verification/srt-loopback.js` ثلاثة مستقبلات FFmpeg محلية مستقلة. يفصل مستقبل SRT الأول، ويقيس تقدّم الإطارات والصوت في الثاني، ويعيد تشغيل الأول ويتحقق من استمرار معرّف جلسة Program. التحقق من مستقبل خارجي يبقى خطوة ميدانية.

### مراقبة فك الترميز عند مستقبل SRT

1. أنشئ رمزًا عشوائيًا منفصلًا لكل مستقبل من 32 بايت بصيغة hex، مثل ناتج `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. اضبط رمز الوجهة الأولى في `MCR_PROGRAM_SRT_RECEIVER_TOKEN` والثانية في `MCR_PROGRAM_SECOND_SRT_RECEIVER_TOKEN` داخل العملية التي تشغّل Program.
2. على جهاز المستقبل جهّز Python وGStreamer مع `srtsrc` و`tsdemux` وفك ترميز H.264 وAAC. اضبط `MCR_SRT_RECEIVER_URL` على رابط الاستماع، مثل `srt://127.0.0.1:25514?mode=listener` في الاختبار. للاتصال المشفّر استخدم عبارة مرور الوجهة نفسها ومعامل `pbkeylen=32`. اضبط `MCR_SRT_RECEIVER_TOKEN` على رمز الوجهة، واضبط `MCR_SRT_RECEIVER_REPORT_URL` على عنوان HTTPS لمسار `/api/v1/stations/<station-id>/program/receivers/primary` أو `secondary`. يدعم الفحص HTTP المحلي على loopback. احفظ العناوين ذات الأسرار والرموز في إعدادات الخدمة على الجهازين.
3. شغّل `python backend/src/infrastructure/program/srt-receiver.py` على جهاز المستقبل. يحتل الفاحص منفذ الاستماع ويفك الترميز للمراقبة. إذا كانت الوجهة تستمع بالفعل على المنفذ نفسه فادمج الإبلاغ مع مستقبلها، أو خصّص وجهة SRT أخرى للفاحص.
4. تعرض Live Control حالة الإرسال وحالة المستقبل لكل وجهة مفعّلة. يرسل الفاحص كل ثانيتين ما إذا فُكّت عينات صوت وصورة في آخر ثلاث ثوانٍ. يستمر فك الصوت في حالة الصمت المقصود. تعرض الواجهة توقف التقارير بعد ثماني ثوانٍ من آخر تقرير. عند بدء جلسة جديدة تنتظر اللوحة تقريرًا جديدًا. الإبلاغ يحدّث المراقبة فقط.
5. لإعادة اختبار القبول على loopback، اضبط `MCR_PROGRAM_PYTHON` وشغّل `node backend/verification/srt-receiver-health-loopback.js`. يستخدم الاختبار قاعدة مؤقتة ويغلق المستقبل ثم يعيده دون تغيير جلسة Program. لتعطيل المراقبة أوقف الفاحص وأزل رمز الوجهة من إعداد خدمة Program، ثم طبّق الإعداد عند إعادة تشغيل الخدمة التالية.

### خلط صوت مداخل Program

في **Live Control → خرج البرنامج المستقل**، اختر توجيه الصوت ومستواه لكل مدخل شبكي واضغط **تطبيق على Program**. يظهر المدخل الثاني إذا ضُبط `MCR_PROGRAM_SECOND_INPUT_PORT`. يحتاج التطبيق إلى صلاحية التحكم بالمحطة ويُسجّل في سجل التدقيق.

- **يتبع الصورة** هو الوضع الافتراضي. يمر الصوت عندما يكون المدخل جاهزًا ومعروضًا في Program.
- **يمتزج عند الجاهزية** يضيف صوت المدخل حتى عندما تُعرض صورة أخرى أو لوحة الانتظار. إذا فقد المدخل جاهزيته يخرج من الخليط تلقائيًا ويعود عند استعادة الجاهزية.
- **كتم المدخل** يزيل صوته من Program مع استمرار المعاينة وقياس مستوى الدخل.

يُخفض مستوى كل مدخل بصورة مستقلة بين ‎−30 و0 dB‎. تقيس عدّادات المداخل مستوى الإشارة قبل التوجيه والخفض. يظل زر كتم Program وخفضه العام مطبقًا على الخرج كله. اترك هامشًا في مستويات المداخل عند خلط إشارات عالية لتجنب قصّ القمم عند الجمع. يعود التوجيه إلى **يتبع الصورة** والمستوى إلى 0 dB عند بدء جلسة جديدة. لإلغاء الخلط خلال الجلسة أعِد المدخلات إلى الوضع الافتراضي.

لاختبار الخلط على مستقبل مستقل، اضبط `MCR_TEST_AUDIO_MIX=1` وشغّل `node backend/verification/program-loopback.js` مع FFmpeg وبيئة GStreamer. يقيس الاختبار نغمتين بترددَي 880 و440 هرتز من الصوت المفكوك على خرج UDP المحلي ويتحقق من أن ربط الصوت أو كتمه لا يغيّر الصورة.

### الاستماع إلى Program من Live Control

أثناء بث Program، اضغط **الاستماع إلى Program**. تُرسل اللوحة نسخة MP3 من صوت الخرج بعد خلط المداخل وتطبيق الخفض والكتم. اضغط **إيقاف الاستماع** لقطع الصوت في متصفحك. تتيح صلاحية قراءة المحطة الاستماع، وتخضع إجراءات البث لصلاحية التحكم. ينهي إيقاف Program اتصال المراقبة، ويتحقق الخادم دوريًا من بقاء جلسة المشاهدة وصلاحيتها.

يحتاج المحرك إلى مكوّن `lamemp3enc` في GStreamer. يتيح الخادم حتى ثمانية مستمعين متزامنين، ويتوقف ترميز MP3 عند انقطاع آخر مستمع. تحتاج خدمة النشر إلى تمرير الاستجابة المستمرة دون تخزين مؤقت. الضبط `MCR_PROGRAM_AUDIO_MONITOR=0` قبل بدء جلسة جديدة يعطّل الميزة.

يشغّل `node backend/verification/program-audio-monitor-loopback.js` مستقبلَين محليين مستقلين لصوت MP3 وخرج UDP/AAC. يختبر الكتم والخفض وإغلاق الاتصال عند إلغاء جلسة المستخدم. لاختبار زر الاستماع في Chrome أيضًا، اضبط `MCR_TEST_PLAYWRIGHT` و`MCR_TEST_CHROME` بعد بناء الواجهة.

### خرج HLS محمي للمحطة

عيّن `MCR_PROGRAM_HLS_DIR` إلى مجلد خاص موجود على مضيف Program. يعتمد العامل على `hlssink2` ويستخدم خرج H.264/AAC نفسه. تظهر حالة التجهيز أو التعذّر ورابط القائمة في Live Control. يحتاج المشغّل أو المستقبل إلى جلسة أو رمز وصول بصلاحية قراءة المحطة لكل طلب قائمة وقطعة. أدوات التشغيل التي تدعم ترويسات HTTP تستطيع استخدام ترويسة Authorization. افتح الرابط في لاعب يدعم HLS. تتغير القائمة عند بدء جلسة جديدة.

الخرج أحادي الجودة ويستخدم نافذة متحركة قصيرة. تستمر مخارج UDP وSRT عند تعذّر كتابة HLS. تعرض اللوحة أحدث حوادث HLS وSRT في جلسة Program الحالية. يعطي سجل SRT حالة الإرسال، وتظهر حالة فك الترميز من مستقبل SRT المقترن في سطر مستقل. لإيقاف HLS أزل متغير المجلد قبل بدء الجلسة التالية. يتضمن [دليل الجاهزية](BROADCAST_READINESS_AR.md) النسخ والاستعادة وتجهيز تجربة التشغيل الممتد.

### كشف الصورة السوداء

اضبط MCR_PROGRAM_BLACK_SECONDS على عدد صحيح بين 1 و60 لتفعيل الكشف، ثم ابدأ جلسة Program جديدة. القيمة 0 تعطّله. يختبر العامل لقطة من المدخل نحو مرتين في الثانية ويصنّفها سوداء إذا كانت 99% من النقاط المفحوصة داكنة جدًا. إذا استمر السواد للمدة المحددة، تظهر حالة **صورة سوداء**. يعود Program إلى اللوحة إذا كان المدخل على الهواء. بعد عودة الصورة، ينتظر العامل خمس ثوانٍ من الاستقرار قبل السماح للمشغّل بأخذ الإشارة مرة أخرى. اترك الكشف معطلًا إذا كان السواد الطويل جزءًا مقصودًا من المحتوى.

### كشف تجمّد الصورة

اضبط MCR_PROGRAM_FREEZE_SECONDS بين 1 و60 ثم ابدأ جلسة Program جديدة. القيمة 0 تعطّل الكشف. تقارن الميزة نقاطًا من لقطات المعاينة بنحو مرتين في الثانية. إذا ظلّت متقاربة طوال المدة، تظهر حالة **صورة متجمّدة** وتعود الإشارة الموجودة على الهواء إلى لوحة الانتظار. بعد عودة الحركة واستقرار الإشارة خمس ثوانٍ، اضغط Take لإعادتها. اختر مدة تناسب المحتوى الثابت المقصود، لأن الميزة تقيس تغيّر الصورة ولا تحدد سبب ثباتها.

### كشف الصمت الصوتي

اضبط MCR_PROGRAM_SILENCE_SECONDS بين 1 و60 وابدأ جلسة Program جديدة. القيمة 0 تعطّل الكشف. يقيس العامل متوسط طاقة عينات الصوت المفكوكة مقارنة بعتبة −60 dBFS. عند استمرار الانخفاض تظهر حالة **صمت صوتي**، ويعود Program إلى اللوحة إذا كان المصدر على الهواء. بعد عودة الصوت ينتظر العامل خمس ثوانٍ من الاستقرار قبل السماح بـ Take. هذه الميزة تناسب المصادر التي يُفترض أن ترسل صوتًا مستمرًا. تركها معطلة يسمح بالصمت المقصود.

يظهر **مستوى صوت المدخل** أثناء تشغيل Program. يعرض المقياس قيمة RMS لعينات الصوت الواردة بالديسيبل بالنسبة إلى الحد الرقمي الأقصى (dBFS)، وينخفض إلى −90 عند الصمت. تختفي القراءة عند فقد الإشارة. يعمل المقياس حتى مع تعطيل التحويل التلقائي بسبب الصمت، ويعرض الصوت الوارد قبل Take.

يعرض مقياس Program مستوى الصوت بعد اختيار المصدر وقبل الترميز. قارنه بمقياس المدخل للتحقق من الصوت قبل Take. استخدم مستقبلًا منفصلًا لتأكيد وصول الصوت إلى الوجهة.

استخدم زر **كتم صوت Program** أو **استعادة صوت Program** للتحكم بصوت البث. الكتم يشمل كل مخارج الجلسة والتسجيل ويبقى عند تبديل المصدر. تبدأ الجلسة الجديدة بصوت مفعّل. يحتاج الزر إلى صلاحية التحكم بالمحطة.

لخفض صوت Program اختر قيمة بين −30 و0 dB واضغط **تطبيق المستوى**. القيمة 0 dB تستعيد المستوى الأصلي. يؤثر الإعداد على جميع المخارج ويبقى خلال تبديل المصادر في الجلسة نفسها. تبدأ الجلسة الجديدة عند 0 dB.

تعرض **مراقبة صورة Program** لقطات بعد تركيب المشهد والشعار والإعلانات وقبل الترميز. تُحدّث اللوحة اللقطة دوريًا. لتأكيد وصول الصورة إلى وجهة البث، راقب المستقبل المنفصل.

تظهر معاينة المدخل ومراقبة Program جنبًا إلى جنب عند اتساع النافذة، وتنتقلان إلى صفين على الشاشة الضيقة. تُعرض مساحة ثابتة مع حالة انتظار عندما تغيب اللقطة.

تتيح قائمة **المشاهد المحلية** حفظ حتى 32 مشهدًا مسمّى، إلى جانب المشهد الأصلي إن وُجد. اختر مشهدًا للمعاينة في المتصفح، ثم اضغط **أخذ المشهد المحلي** لإرساله إلى Program. يبقى الشعار والإعلانات فوق المشهد. يسري هذا على مشاهد الفيديو المحلي والصورة.

من **مشاهد Program** اختر **مشهد شبكي جديد**، أدخل الاسم واحفظه. يعرض المحرر معاينة مدخل المحطة الحالي ويسمح بأخذ المشهد عندما يصبح المدخل جاهزًا. يشير المشهد إلى المدخل الذي ضُبط على الخادم، سواء UDP أو رابط MPEG-TS. جميع المشاهد الشبكية في المحطة تستخدم هذا المدخل الواحد.

أثناء تشغيل Program اختر **معاينة لقطة من المحرك** في محرّر المشهد المحلي لرؤية الإطار الأول مع الصورة وموضعها. المعاينة لقطة ثابتة قبل الشعار العام والإعلانات. تعديل المسودة أو اختيار **استئناف المعاينة المتحركة** يعيد عرض المتصفح.

في محرّر المشاهد اختر **قطع مباشر** أو **ظهور تدريجي من السواد** قبل أخذ المشهد المحلي أو الشبكي. يستغرق الظهور نحو 600 مللي ثانية ويؤثر على صورة المشهد. يتبدل الصوت عند الأخذ، ويبقى الشعار والإعلانات ظاهرين فوق الصورة. اختر القطع المباشر للعودة إلى السلوك السابق.

لتفعيل مدخل ثانٍ، اضبط MCR_PROGRAM_SECOND_INPUT_PORT على منفذ UDP مختلف عن منفذي المدخل الأول وProgram. يستخدم المدخل الثاني عنوان الربط المحلي أو الخاص نفسه. اختر **المدخل الثاني** في المشهد الشبكي المحفوظ. لكل مدخل معاينة وحالة مستقلة، ويعود Program إلى اللوحة فقط عند فقد المصدر المعروض. احذف المتغير لتعطيل المدخل الثاني.

اضبط MCR_PROGRAM_AUTO_BACKUP=1 مع MCR_PROGRAM_SECOND_INPUT_PORT لتفعيل المدخل الثاني احتياطيًا. عند فشل المدخل الأول المعروض، يأخذ المحرك الثاني تلقائيًا إذا كان جاهزًا. إذا تعذر استخدامه أو تعطّل وهو على الهواء تظهر لوحة الانتظار. يستعيد المشغّل المدخل الأول يدويًا بعد تعافيه. أزل MCR_PROGRAM_AUTO_BACKUP لاستعادة سياسة اللوحة فقط.

### إبقاء Program أثناء إعادة تشغيل لوحة التحكم

فعّل الوضع المنفصل بتعيين MCR_PROGRAM_RUNTIME_PORT إلى منفذ محلي غير مستخدم، مختلف عن منفذ لوحة الويب. اضبط MCR_PROGRAM_STATION_ID ونفس ملف SQLite ومفاتيح التوقيع والتشفير لكلا العمليتين. شغّل node backend/src/program-runtime.js كخدمة مستقلة عن node backend/src/index.js. اجعل كل عملية تحت إشراف مستقل حتى تُعاد إحداهما دون الأخرى. استمر في استخدام رابط اللوحة المعتاد. تستمع خدمة Program على 127.0.0.1، وتمرر اللوحة طلبات Program إليها مع استمرار التحقق من الصلاحيات.

عند إعادة تشغيل اللوحة، يظل عامل البث تابعًا لخدمة Program ويحتفظ بالجلسة. عند إيقاف خدمة Program نفسها يتوقف العامل. يمكن تفعيل بدء جلسة جديدة تلقائيًا عند تشغيل الخدمة من جديد. قبل حذف محطة مرتبطة بهذا الوضع أوقف Program وأزل ربطها من الخدمتين. للرجوع إلى التشغيل ضمن عملية واحدة، أوقف Program والخدمة المنفصلة، ثم أزل MCR_PROGRAM_RUNTIME_PORT وأعد تشغيل اللوحة.

تحقق محليًا بتشغيل node backend/verification/control-restart-loopback.js، مع بيئة Python وأدوات الاختبار السابقة وتهيئة منافذ 25600–25603 لتكون غير مستخدمة.

لتفعيل البدء التلقائي اضبط MCR_PROGRAM_AUTOSTART=1 في خدمة Program المنفصلة. بعد تشغيل الخدمة تبدأ جلسة جديدة على لوحة الانتظار، مع قراءة إعدادات الشعار والإعلانات من SQLite. إيقاف Program من الواجهة ينهي الجلسة الحالية، وعند إعادة تشغيل الخدمة يبدأ Program مرة أخرى ما دام الخيار مفعّلًا. أزل المتغير للعودة إلى البدء اليدوي.

لاستعادة المصدر بعد إعادة تشغيل خدمة Program، اضبط MCR_PROGRAM_RESTORE_SOURCE=1 إلى جانب MCR_PROGRAM_AUTOSTART=1. تستعيد الخدمة آخر اختيار تلقّاه المحرك من المشغّل بنجاح. يبدأ الملف المحلي من أوله، وينتظر المصدر الشبكي الجاهزية حتى 30 ثانية. عند غياب المصدر تبقى لوحة الانتظار. أخذ اللوحة أو إيقاف Program يدويًا يحفظ قرار البقاء على اللوحة عند التشغيل التالي. أزل خيار الاستعادة للإبقاء على بدء الجلسة على اللوحة فقط.

تعرض Live Control حالة انتظار المصدر المحفوظ أو تعذّر استعادته أثناء بث اللوحة. عند فقد مادة المشهد، استعد الملف واختر المشهد يدويًا. اختبار إعادة التشغيل يحقن فقد إطار محلي في قاعدة مؤقتة ويؤكد بقاء اللوحة.

### جدولة أخذ مشهد

احفظ مشهدًا مسمّى ثم اختر موعد البث في قسم **جدول بث Program** واضغط **جدولة المشهد المحفوظ**. يُعرض الموعد بحسب توقيت جهاز المشغّل ويُحفظ كوقت مطلق. يحتاج الإنشاء والإلغاء إلى صلاحية إدارة الجدولة والتحكم بالمحطة. يستمر التنفيذ مع إغلاق اللوحة، ومع توقف خادم الويب إذا كانت خدمة Program منفصلة. يجب أن يكون Program قيد التشغيل. إذا تغيّر المشهد بعد الجدولة أو فقد المصدر جاهزيته أو فات الموعد بأكثر من 30 ثانية، يسجّل النظام التعذّر. يسجّل وقت التنفيذ عند قبول المحرك لأمر Take. لإيقاف موعد معلّق استخدم زر الإلغاء.

اختر **تكرار كل 24 ساعة** عند جدولة مشهد مسمّى. ينشئ الخادم الموعد المعلّق التالي عند حلول الموعد الحالي، حتى إن تعذّر بثه. تجاوز الموعد المعلّق بإلغائه يوقف التكرار ويحفظ النتائج السابقة. إذا تعارض الموعد التالي مع حدث موجود، يُختار أول يوم لاحق غير محجوز في الساعة نفسها على مقياس UTC. التكرار بفاصل ثابت، وقد يتغير الوقت المعروض محليًا عند تغيّر التوقيت الصيفي.

لجدولة قائمة، اختر موعد البداية، ثم أضف مشهدين مسمّيين أو أكثر بالترتيب وحدد الثواني حتى المشهد التالي واضغط **جدولة القائمة**. يحفظ الخادم جميع المواعيد معًا. التعارض هنا هو تطابق وقت أخذ مشهد مع موعد موجود. يبقى المشهد الأخير على الهواء حتى أمر أخذ آخر. القائمة تُجدول لمرة واحدة، ويمكن إلغاء كل موعد معلّق على حدة.

يمكنك اختيار **مشهد التعبئة بعد القائمة**. أدخل مدة العنصر الأخير أيضًا ليحسب الخادم موعد أخذ مشهد التعبئة. اختر مشهد فيديو محليًا مسمّى. يظل هذا المشهد على الهواء حتى Take آخر، ويمكن إلغاء موعده من سجل الجدولة قبل التنفيذ.

استخدم **إيقاف الجدول مؤقتًا** للتحكم في Program يدويًا. المواعيد التي يحين وقتها أثناء الإيقاف تُسجل بوصفها متجاوزة، وتستمر جدولة التكرارات اليومية المقبلة. أمر Take الذي بدأ بالفعل قد يكتمل. عند الاستئناف ينفّذ الخادم المواعيد المقبلة. تحفظ قاعدة البيانات حالة الإيقاف بعد إعادة التشغيل.

زر **تنزيل سجل الجدولة CSV** يصدّر أحدث 10,000 موعد للمحطة. تُعرض الأوقات بتوقيت UTC، وتعني take_accepted أن المحرك قبل أمر Take. يتضمن الملف نتيجة التجاوز أو التعذّر عند وجودها.

اختر **تعديل الموعد** بجانب حدث معلّق لإعادة جدولته بتوقيت جهازك. يحتفظ الحدث بمعرّفه والمشهد والتكرار. تعديل حدث من قائمة متسلسلة يغيّر هذا الموعد وحده. إذا تعارض الوقت الجديد مع حدث آخر، يبقى الموعد الأصلي.

### Private UDP opt-in

For the private LAN workflow above, also set `MCR_PROGRAM_TRUST_PRIVATE_UDP=1` after confirming firewall restrictions for the authorized sender. Loopback requires no opt-in. Test receiver continuity and unauthorized network denial in isolated deployment staging.
