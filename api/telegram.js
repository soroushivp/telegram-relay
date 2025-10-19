export const config = {
  api: { bodyParser: false },
};

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPSCRIPT_URL = process.env.APPSCRIPT_URL;
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

const sessions = {};

// 🟢 تابع ارسال پیام
async function sendMessage(chatId, text, keyboard) {
  const body = {
    chat_id: chatId,
    text,
    reply_markup: keyboard
      ? { keyboard, resize_keyboard: true, one_time_keyboard: true }
      : undefined,
  };
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 🗓️ تابع ساخت لیست تاریخ‌های شمسی ۷ روز آینده (بدون جمعه)
function getNext7Days() {
  const days = [];
  const base = new Date();
  const weekdayNames = ["یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"];

  while (days.length < 7) {
    base.setDate(base.getDate() + 1);
    const day = base.getDay(); // 5 = جمعه
    if (day !== 5) {
      const gYear = base.getFullYear();
      const gMonth = base.getMonth() + 1;
      const gDay = base.getDate();
      // محاسبه‌ی تقریبی به شمسی (ساده و نزدیک به واقع)
      const persian = toPersianDate(gYear, gMonth, gDay);
      const label = `${weekdayNames[day]} (${persian})`;
      days.push([label]);
    }
  }
  return days;
}

// 🔢 تابع تبدیل ساده میلادی به شمسی (بدون وابستگی به کتابخانه)
function toPersianDate(gYear, gMonth, gDay) {
  const g2d = (y, m, d) => {
    const GY = y - 1600;
    const GM = m - 1;
    const GD = d - 1;
    const gDayNo =
      365 * GY +
      Math.floor((GY + 3) / 4) -
      Math.floor((GY + 99) / 100) +
      Math.floor((GY + 399) / 400);
    const gMonthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let i = 0; i < GM; ++i) gDayNo += gMonthDays[i];
    if (GM > 1 && ((GY % 4 === 0 && GY % 100 !== 0) || GY % 400 === 0)) gDayNo++;
    return gDayNo + GD;
  };

  let jDayNo = g2d(gYear, gMonth, gDay) - 79;
  const jCycle = Math.floor(jDayNo / 12053);
  jDayNo %= 12053;
  let jYear = 979 + 33 * jCycle + 4 * Math.floor(jDayNo / 1461);
  jDayNo %= 1461;
  if (jDayNo >= 366) {
    jYear += Math.floor((jDayNo - 1) / 365);
    jDayNo = (jDayNo - 1) % 365;
  }
  const jMonthDays = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  let jMonth;
  for (jMonth = 0; jMonth < 11 && jDayNo >= jMonthDays[jMonth]; ++jMonth)
    jDayNo -= jMonthDays[jMonth];
  const jDay = jDayNo + 1;
  return `${jYear}/${String(jMonth + 1).padStart(2, "0")}/${String(jDay).padStart(2, "0")}`;
}

// 🧩 تابع اصلی
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  const body = await new Response(req).json();
  const message = body.message;
  if (!message || !message.text) return res.status(200).send("No message");

  const chatId = message.chat.id;
  const text = message.text.trim();
  const step = sessions[chatId]?.step || 0;

  // شروع گفتگو
  if (text === "/start") {
    sessions[chatId] = { step: 1, data: {} };
    await sendMessage(
      chatId,
      "👋 سلام! لطفاً *نام و نام خانوادگی* خود را وارد کنید (مثلاً: علی رضایی):"
    );
    return res.status(200).send("OK");
  }

  if (!sessions[chatId]) {
    await sendMessage(chatId, "برای شروع دوباره لطفاً /start را بزنید.");
    return res.status(200).send("OK");
  }

  const user = sessions[chatId].data;

  switch (step) {
    // نام
    case 1:
      if (text.length < 3) {
        await sendMessage(chatId, "⚠️ لطفاً نام را درست وارد کنید (مثلاً: علی رضایی)");
        break;
      }
      user.name = text;
      sessions[chatId].step = 2;
      await sendMessage(chatId, "📱 لطفاً شماره موبایل خود را وارد کنید (مثلاً: 09123456789):");
      break;

    // شماره تماس
    case 2:
      if (!/^09\d{9}$/.test(text)) {
        await sendMessage(chatId, "⚠️ شماره موبایل باید با 09 شروع شود و 11 رقم باشد.");
        break;
      }
      user.phone = text;
      sessions[chatId].step = 3;
      await sendMessage(chatId, "🔧 لطفاً نوع خدمت مورد نظر را انتخاب کنید:", [
        ["نوبت تعمیرگاه"],
        ["نصب آپشن"],
        ["سرویس دوره‌ای"],
      ]);
      break;

    // نوع خدمت
    case 3:
      user.service = text;
      sessions[chatId].step = 4;
      await sendMessage(chatId, "🔢 لطفاً پلاک خودرو را وارد کنید (مثلاً: 22الف111):");
      break;

    // پلاک
    case 4:
      if (text.length < 5) {
        await sendMessage(chatId, "⚠️ پلاک کوتاه است. لطفاً مثل نمونه وارد کنید (مثلاً: 22الف111)");
        break;
      }
      user.plate = text;
      sessions[chatId].step = 5;
      await sendMessage(chatId, "🏷️ لطفاً برند خودرو را انتخاب کنید:", [
        ["MVM", "فونیکس"],
        ["سایپا", "سایر"],
      ]);
      break;

    // برند
    case 5:
      user.brand = text;
      sessions[chatId].step = 6;
      await sendMessage(chatId, "🚘 لطفاً مدل و سال خودرو را وارد کنید (مثلاً: FX 1403):");
      break;

    // مدل
    case 6:
      user.model = text;
      sessions[chatId].step = 7;
      await sendMessage(chatId, "📝 لطفاً ایراد یا توضیح لازم را بنویسید (مثلاً: صدای زیاد از موتور):");
      break;

    // توضیح
    case 7:
      user.description = text;
      sessions[chatId].step = 8;
      await sendMessage(chatId, "📆 لطفاً تاریخ مورد نظر خود را انتخاب کنید:", getNext7Days());
      break;

    // تاریخ
    case 8:
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(text) && !text.includes("۱۴۰")) {
        await sendMessage(chatId, "⚠️ لطفاً تاریخ را از میان گزینه‌های پیشنهادی انتخاب کنید.");
        break;
      }
      user.date = text;
      sessions[chatId].step = 9;
      await sendMessage(chatId, "⏰ لطفاً ساعت مورد نظر خود را وارد کنید (مثلاً: 8 یا 14 یا 14:30):");
      break;

    // ساعت
    case 9:
      if (!/^\d{1,2}(:\d{2})?$/.test(text)) {
        await sendMessage(chatId, "⚠️ لطفاً ساعت را درست وارد کنید (مثلاً: 8 یا 14:30)");
        break;
      }
      user.time = text;
      sessions[chatId].step = 0;

      // ارسال به گوگل شیت
      await fetch(APPSCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });

      // پیام گروه کارشناسان با فاصله‌گذاری
      const summary = 
`📋 رزرو جدید ثبت شد: 

👤 نام و نام خانوادگی: ${user.name}

📞 شماره تماس: ${user.phone}

🔧 خدمت درخواستی: ${user.service}

🚗 خودرو: ${user.brand} - ${user.model}

🔢 پلاک: ${user.plate}

📝 ایراد / توضیحات: ${user.description}

📅 تاریخ و ساعت مورد نظر: ${user.date} | 🕐 ${user.time}`;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: STAFF_CHAT_ID,
          text: summary,
          parse_mode: "Markdown",
        }),
      });

      await sendMessage(chatId, "✅ نوبت شما با موفقیت ثبت شد.\nاز همکاری شما سپاسگزاریم 🙏");
      break;
  }

  res.status(200).send("OK");
}
