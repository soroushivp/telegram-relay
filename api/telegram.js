export const config = {
  api: { bodyParser: false },
};

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPSCRIPT_URL = process.env.APPSCRIPT_URL;
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

const sessions = {};

// ارسال پیام به کاربر
async function sendMessage(chatId, text, keyboard) {
  const body = {
    chat_id: chatId,
    text,
    reply_markup: keyboard ? { keyboard, resize_keyboard: true, one_time_keyboard: true } : undefined,
  };
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// تبدیل ارقام فارسی/عربی به لاتین
function normalizeDigits(str) {
  const map = { '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
                '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9' };
  return (str || '').replace(/[۰-۹٠-٩]/g, d => map[d]);
}

// ساخت رشتهٔ تاریخ شمسی به صورت YYYY/MM/DD با ارقام لاتین
function toJalaliYMD(date) {
  const fmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year:'numeric', month:'2-digit', day:'2-digit' });
  const parts = fmt.formatToParts(date);
  const y = normalizeDigits(parts.find(p => p.type === 'year').value);
  const m = normalizeDigits(parts.find(p => p.type === 'month').value).padStart(2, '0');
  const d = normalizeDigits(parts.find(p => p.type === 'day').value).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// ساخت ۷ تاریخ کاری بعدی (بدون جمعه) به‌صورت دکمه‌های تک‌ستونی
function getNextWorkingJalaliDates(count = 7) {
  const rows = [];
  const dt = new Date(); // امروز؛ مثال شما: 27 مهر 1404 ≈ 2025-10-19
  while (rows.length < count) {
    dt.setDate(dt.getDate() + 1);
    const isFriday = dt.getDay() === 5; // جمعه
    if (!isFriday) {
      const j = toJalaliYMD(dt);
      rows.push([j]); // دکمه فقط خود تاریخ باشد
    }
  }
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  const body = await new Response(req).json();
  const message = body.message;
  if (!message || !message.text) return res.status(200).send('No message');

  const chatId = message.chat.id;
  const textRaw = message.text.trim();
  const text = normalizeDigits(textRaw);
  const step = sessions[chatId]?.step || 0;

  // شروع
  if (text === '/start') {
    sessions[chatId] = { step: 1, data: {} };
    await sendMessage(chatId, '👋 سلام! لطفاً *نام و نام خانوادگی* خود را وارد کنید (مثلاً: علی رضایی):');
    return res.status(200).send('OK');
  }

  if (!sessions[chatId]) {
    await sendMessage(chatId, 'برای شروع دوباره لطفاً /start را بزنید.');
    return res.status(200).send('OK');
  }

  const user = sessions[chatId].data;

  switch (step) {
    // 1) نام و نام خانوادگی
    case 1:
      if (text.length < 3) {
        await sendMessage(chatId, '⚠️ لطفاً نام و نام خانوادگی را درست وارد کنید (مثلاً: علی رضایی).');
        break;
      }
      user.name = textRaw; // نسخهٔ اصلی برای نمایش فارسی
      sessions[chatId].step = 2;
      await sendMessage(chatId, '📱 لطفاً شماره موبایل خود را وارد کنید (مثلاً: 09123456789):');
      break;

    // 2) شماره موبایل
    case 2:
      if (!/^09\d{9}$/.test(text)) {
        await sendMessage(chatId, '⚠️ شماره موبایل باید با 09 شروع شود و 11 رقم باشد (مثلاً: 09123456789).');
        break;
      }
      user.phone = text;
      sessions[chatId].step = 3;
      await sendMessage(chatId, '🔧 لطفاً نوع خدمت مورد نظر را انتخاب کنید:', [
        ['نوبت تعمیرگاه'],
        ['نصب آپشن'],
        ['سرویس دوره‌ای'],
      ]);
      break;

    // 3) نوع خدمت
    case 3:
      user.service = textRaw;
      sessions[chatId].step = 4;
      await sendMessage(chatId, '🔢 لطفاً پلاک خودرو را وارد کنید (مثلاً: 22الف111):');
      break;

    // 4) پلاک
    case 4:
      if (textRaw.length < 5) {
        await sendMessage(chatId, '⚠️ پلاک کوتاه است. لطفاً مثل نمونه وارد کنید (مثلاً: 22الف111).');
        break;
      }
      user.plate = textRaw;
      sessions[chatId].step = 5;
      await sendMessage(chatId, '🏷️ لطفاً برند خودرو را انتخاب کنید:', [
        ['MVM', 'فونیکس'],
        ['سایپا', 'سایر'],
      ]);
      break;

    // 5) برند
    case 5:
      user.brand = textRaw;
      sessions[chatId].step = 6;
      await sendMessage(chatId, '🚘 لطفاً مدل و سال خودرو را وارد کنید (مثلاً: FX 1403):');
      break;

    // 6) مدل و سال
    case 6:
      if (textRaw.length < 2) {
        await sendMessage(chatId, '⚠️ لطفاً مدل و سال را درست وارد کنید (مثلاً: FX 1403).');
        break;
      }
      user.model = textRaw;
      sessions[chatId].step = 7;
      await sendMessage(chatId, '📝 لطفاً ایراد یا توضیح لازم را بنویسید (مثلاً: سویچ رو گم کردم):');
      break;

    // 7) توضیح
    case 7:
      user.description = textRaw;
      sessions[chatId].step = 8;
      await sendMessage(chatId, '📆 لطفاً تاریخ مورد نظر خود را انتخاب کنید:', getNextWorkingJalaliDates());
      break;

    // 8) تاریخ (فقط از دکمه‌ها انتخاب شود)
    case 8:
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(text)) {
        await sendMessage(chatId, '⚠️ لطفاً تاریخ را از میان گزینه‌های پیشنهادی انتخاب کنید.');
        break;
      }
      user.date = text;
      sessions[chatId].step = 9;
      await sendMessage(chatId, '⏰ لطفاً ساعت مورد نظر را وارد کنید (مثلاً: 8 یا 14 یا 14:30):');
      break;

    // 9) ساعت (قبول: 8 | 14 | 14:30)
    case 9:
      if (!/^\d{1,2}(:\d{2})?$/.test(text)) {
        await sendMessage(chatId, '⚠️ لطفاً ساعت را درست وارد کنید (مثلاً: 8 یا 14 یا 14:30).');
        break;
      }
      user.time = text;
      sessions[chatId].step = 0;

      // ارسال به Google Sheet (ترتیب باید با Apps Script هماهنگ باشد)
      await fetch(APPSCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });

      // پیام گروه با قالب خواسته‌شده و فاصله بین خطوط (بدون Markdown)
      const summary =
`📋 رزرو جدید ثبت شد: 

👤 نام و نام خانوادگی:  ${user.name}

📞 شماره تماس:  ${user.phone}

🔧 خدمت درخواستی:  ${user.service}

🚗 خودرو :  ${user.brand} - ${user.model}

🔢 پلاک:  ${user.plate}

📝 ایراد/ توضیحات:  ${user.description}

📅 تاریخ و ساعت مورد نظر :  ${user.date} | 🕐 ${user.time}`;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: STAFF_CHAT_ID,
          text: summary,
          // parse_mode را عمداً تنظیم نمی‌کنیم تا فاصله‌ها حفظ شوند
        }),
      });

      await sendMessage(chatId, '✅ نوبت شما با موفقیت ثبت شد.\nاز همکاری شما سپاسگزاریم 🙏');
      break;
  }

  res.status(200).send('OK');
}
