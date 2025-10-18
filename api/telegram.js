export const config = {
  api: { bodyParser: false },
};

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPSCRIPT_URL = process.env.APPSCRIPT_URL;
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

const sessions = {};

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  const body = await new Response(req).json();
  const message = body.message;
  if (!message || !message.text) return res.status(200).send('No message');

  const chatId = message.chat.id;
  const text = message.text.trim();
  const step = sessions[chatId]?.step || 0;

  if (text === '/start') {
    sessions[chatId] = { step: 1, data: {} };
    await sendMessage(chatId, '👋 سلام! لطفاً نام و نام خانوادگی خود را وارد کنید:');
    return res.status(200).send('OK');
  }

  if (!sessions[chatId]) {
    await sendMessage(chatId, 'برای شروع /start را بزنید.');
    return res.status(200).send('OK');
  }

  const user = sessions[chatId].data;

  switch (step) {
    case 1:
      user.name = text;
      sessions[chatId].step = 2;
      await sendMessage(chatId, 'پلاک خودرو را وارد کنید:');
      break;

    case 2:
      user.plate = text;
      sessions[chatId].step = 3;
      await sendMessage(chatId, 'برند خودرو را انتخاب کنید:', [
        ['MVM', 'فونیکس'],
        ['سایپا', 'سایر'],
      ]);
      break;

    case 3:
      user.brand = text;
      sessions[chatId].step = 4;
      await sendMessage(chatId, 'نوع خدمت مورد نظر را انتخاب کنید:', [
        ['تعمیرگاه', 'خدمات پس از فروش'],
        ['نصب آپشن', 'کارشناسی خودرو'],
      ]);
      break;

    case 4:
      user.service = text;
      sessions[chatId].step = 5;
      await sendMessage(chatId, 'تاریخ مورد نظر خود را وارد کنید (مثلاً 1404/02/10):');
      break;

    case 5:
      user.date = text;
      sessions[chatId].step = 6;
      await sendMessage(chatId, 'ساعت مورد نظر خود را وارد کنید (مثلاً 14:30):');
      break;

    case 6:
      user.time = text;
      sessions[chatId].step = 0;

      // ارسال به Google Sheet
      await fetch(APPSCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });

      // ارسال به گروه کارشناسان
      const summary = `📋 *رزرو جدید ثبت شد:*\n\n👤 ${user.name}\n🚗 ${user.brand}\n🔧 ${user.service}\n📅 ${user.date}\n🕐 ${user.time}\n🔢 پلاک: ${user.plate}`;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: STAFF_CHAT_ID, text: summary, parse_mode: 'Markdown' }),
      });

      await sendMessage(chatId, '✅ نوبت شما با موفقیت ثبت شد. از همکاری شما سپاسگزاریم!');
      break;
  }

  res.status(200).send('OK');
}
