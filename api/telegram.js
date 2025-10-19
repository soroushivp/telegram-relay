export const config = {
  api: { bodyParser: false },
};

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPSCRIPT_URL = process.env.APPSCRIPT_URL;
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

// حافظهٔ موقت مکالمات
const sessions = {};

// تابع ارسال پیام به کاربر
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

// ساخت لیست ۷ روز کاری آینده (بدون جمعه)
function getNextWorkingDays(count = 7) {
  const days = [];
  let date = new Date();

  while (days.length < count) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay(); // 0=Sunday, 5=Friday
    if (day !== 5) {
      const y = date.getFullYear() - 621; // تبدیل تقریبی به شمسی (نمایشی)
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const d = date.getDate().toString().padStart(2, '0');
      days.push(`${y}/${m}/${d}`);
    }
  }
  return days.map((d) => [d]);
}

// تابع اصلی
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  const body = await new Response(req).json();
  const message = body.message;
  if (!message || !message.text) return res.status(200).send("No message");

  const chatId = message.chat.id;
  const text = message.text.trim();
  const step = sessions[chatId]?.step || 0;

  // شروع مکالمه
  if (text === "/start") {
    sessions[chatId] = { step: 1, data: {} };
    await sendMessage(chatId, "👋 سلام! به ربات نوبت دهی خدمات گروه خودرو کجور خوش آمدید! لطفاً *نام و نام خانوادگی* خود را وارد کنید (مثلاً: علی رضایی):");
    return res.status(200).send("OK");
  }

  if (!sessions[chatId]) {
    await sendMessage(chatId, "برای شروع دوباره لطفاً /start را بزنید.");
    return res.status(200).send("OK");
  }

  const user = sessions[chatId].data;

  switch (step) {
    // ۱. نام و نام خانوادگی
    case 1:
      if (text.length < 3) {
        await sendMessage(chatId, "⚠️ لطفاً نام و نام خانوادگی را درست وارد کنید (مثلاً: علی رضایی)");
        break;
      }
      user.name = text;
      sessions[chatId].step = 2;
      await sendMessage(chatId, "📱 لطفاً شماره موبایل خود را وارد کنید (مثلاً: 09123456789):");
      break;

    // ۲. شماره موبایل
    case 2:
      if (!/^09\d{9}$/.test(text)) {
        await sendMessage(chatId, "⚠️ شماره موبایل باید با 09 شروع شود و 11 رقم باشد. (مثلاً: 09123456789)");
        break;
      }
      user.phone = text;
      sessions[chatId].step = 3;
      await sendMessage(chatId, "🔧 لطفاً نوع خدمت مورد نظر خود را انتخاب کنید:", [
        ["نوبت تعمیرگاه"],
        ["نصب آپشن"],
        ["سرویس دوره‌ای"],
      ]);
      break;

    // ۳. نوع سرویس
    case 3:
      user.service = text;
      sessions[chatId].step = 4;
      await sendMessage(chatId, "🚗 لطفاً پلاک خودرو را وارد کنید (مثلاً: 22الف111):");
      break;

    // ۴. پلاک خودرو
    case 4:
      if (text.length < 5) {
        await sendMessage(chatId, "⚠️ پلاک خودرو کوتاه است. (مثلاً: 22الف111)");
        break;
      }
      user.plate = text;
      sessions[chatId].step = 5;
      await sendMessage(chatId, "🏷️ لطفاً برند خودرو را انتخاب کنید:", [
        ["MVM", "فونیکس"],
        ["سایپا", "سایر"],
      ]);
      break;

    // ۵. برند خودرو
    case 5:
      user.brand = text;
      sessions[chatId].step = 6;
      await sendMessage(chatId, "🚘 لطفاً مدل و سال ساخت خودرو را وارد کنید (مثلاً: X22 مدل 1401):");
      break;

    // ۶. مدل و سال
    case 6:
      if (text.length < 3) {
        await sendMessage(chatId, "⚠️ لطفاً مدل و سال خودرو را درست وارد کنید (مثلاً: X22 مدل 1401)");
        break;
      }
      user.model = text;
      sessions[chatId].step = 7;
      await sendMessage(chatId, "📝 لطفاً توضیح مختصر یا ایراد خودرو را بنویسید (مثلاً: صدای زیاد از موتور):");
      break;

    // ۷. توضیح یا ایراد
    case 7:
      user.description = text;
      sessions[chatId].step = 8;
      await sendMessage(chatId, "📆 لطفاً یکی از تاریخ‌های زیر را انتخاب کنید:", getNextWorkingDays());
      break;

    // ۸. انتخاب تاریخ
    case 8:
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(text)) {
        await sendMessage(chatId, "⚠️ لطفاً تاریخ را از میان گزینه‌های موجود انتخاب کنید.");
        break;
      }
      user.date = text;
      sessions[chatId].step = 9;
      await sendMessage(chatId, "⏰ لطفاً ساعت مورد نظر خود را وارد کنید (مثلاً: 8 یا 14 یا 14:30):");
      break;

    // ۹. ساعت
    case 9:
      if (!/^\d{1,2}(:\d{2})?$/.test(text)) {
        await sendMessage(chatId, "⚠️ لطفاً فقط ساعت را وارد کنید (مثلاً: 8 یا 14 یا 14:30)");
        break;
      }
      user.time = text;
      sessions[chatId].step = 0;

      // ارسال به Google Sheet
      await fetch(APPSCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });

      // پیام برای گروه کارشناسان
      const summary =
        `📋 *رزرو جدید ثبت شد:*\n\n` +
        `👤 ${user.name}\n📞 ${user.phone}\n🔧 ${user.service}\n🚗 ${user.brand} - ${user.model}\n` +
        `🔢 پلاک: ${user.plate}\n📝 ${user.description}\n📅 ${user.date} | 🕐 ${user.time}`;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: STAFF_CHAT_ID,
          text: summary,
          parse_mode: "Markdown",
        }),
      });

      await sendMessage(chatId, "✅ نوبت شما با موفقیت ثبت شد.\nاز اعتماد شما سپاسگزاریم 🙏");
      break;
  }

  res.status(200).send("OK");
}
