// ------------------------------------------------------------
// Telegram Bot Webhook Handler for Vercel
// ------------------------------------------------------------

import { buffer } from 'micro';
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// Disable Vercel's default body parser (Telegram sends raw JSON)
export const config = {
  api: { bodyParser: false },
};

// Environment variables (set them in Vercel dashboard)
const BOT_TOKEN = process.env.BOT_TOKEN;           // your Telegram bot token
const APPSCRIPT_URL = process.env.APPSCRIPT_URL;   // Google Apps Script web app URL
const SECRET = process.env.SECRET_TOKEN;           // shared secret with Apps Script
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;   // group/channel/chat ID for staff

// ------------------------------------------------------------
// Utility functions
// ------------------------------------------------------------
async function callAppsScript(payload) {
  payload.secret = SECRET;
  const resp = await fetch(APPSCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

async function tgSend(chatId, text, extra = {}) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
  });
}

function mkKb(arrRows) {
  return { keyboard: arrRows, one_time_keyboard: true, resize_keyboard: true };
}

// ------------------------------------------------------------
// Main webhook handler
// ------------------------------------------------------------
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');

    // Read and parse raw body (critical!)
    const buf = await buffer(req);
    const update = JSON.parse(buf.toString());
    console.log('📩 Incoming update:', update);

    const update_id = update.update_id;
    if (!update_id) return res.status(200).send('no update id');

    // Dedupe via Apps Script cache
    const ded = await callAppsScript({ action: 'is_new_update', update_id });
    if (!ded.ok || ded.isNew === false) return res.status(200).send('dup');

    const msg = update.message || (update.callback_query && update.callback_query.message);
    if (!msg) return res.status(200).send('no message');

    const text = (msg.text || '').trim();
    const tgUserId = msg.from.id;
    const chatId = msg.chat.id;

    // -------------------------------
    //  STEP 1: basic commands
    // -------------------------------
    if (text === '/start') {
      await tgSend(chatId, 'سلام! 👋 برای رزرو نوبت لطفاً نام و نام‌خانوادگی‌تان را بنویسید.');
      await callAppsScript({
        action: 'set_state',
        tg_user_id: tgUserId,
        state: { step: 'ask_full_name' },
      });
      return res.status(200).send('ok');
    }

    if (text === '/reset') {
      await callAppsScript({
        action: 'set_state',
        tg_user_id: tgUserId,
        state: {
          step: 'ask_full_name',
          full_name: '',
          phone: '',
          brand: '',
          service_type: '',
          issue_text: '',
          preferred_date: '',
          preferred_time: '',
        },
      });
      await tgSend(chatId, '🔄 ریست شد. لطفاً نام و نام‌خانوادگی‌تان را بفرستید.');
      return res.status(200).send('ok');
    }

    // -------------------------------
    //  STEP 2: load current state
    // -------------------------------
    const stResp = await callAppsScript({ action: 'get_state', tg_user_id: tgUserId });
    let state =
      stResp.ok && stResp.state
        ? stResp.state
        : { tg_user_id: String(tgUserId), step: 'ask_full_name' };
    const step = state.step || 'ask_full_name';

    // -------------------------------
    //  STEP 3: state machine
    // -------------------------------
    if (step === 'ask_full_name') {
      if (!text) {
        await tgSend(chatId, 'لطفاً نام را وارد کنید.');
        return res.status(200).send('ok');
      }
      state.full_name = text;
      state.step = 'ask_phone';
      await callAppsScript({ action: 'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, '📱 شماره موبایل خود را بفرستید (مثال: 09xxxxxxxxx)');
      return res.status(200).send('ok');
    }

    if (step === 'ask_phone') {
      const phone = text.replace(/\s+/g, '');
      if (!/^09\d{9}$/.test(phone)) {
        await tgSend(chatId, 'فرمت شماره اشتباه است؛ مثال: 09123456789');
        return res.status(200).send('ok');
      }
      state.phone = phone;
      state.step = 'ask_brand';
      await callAppsScript({ action: 'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, '🚗 برند خودروی شما چیست؟', { reply_markup: mkKb([['MVM', 'Chery', 'Fownix', 'Other']]) });
      return res.status(200).send('ok');
    }

    if (step === 'ask_brand') {
      state.brand = text;
      state.step = 'ask_service_type';
      await callAppsScript({ action: 'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, '🔧 نوع خدمت را انتخاب کنید', {
        reply_markup: mkKb([
          ['دوره‌ای', 'تعمیری'],
          ['بررسی', 'نصب آپشن', 'گارانتی'],
        ]),
      });
      return res.status(200).send('ok');
    }

    if (step === 'ask_service_type') {
      state.service_type = text;
      state.step = 'ask_issue';
      await callAppsScript({ action: 'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, '📝 لطفاً توضیحی کوتاه در مورد مشکل یا درخواست بنویسید.');
      return res.status(200).send('ok');
    }

    if (step === 'ask_issue') {
      state.issue_text = text;
      state.step = 'ask_date';
      await callAppsScript({ action: 'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, '📅 تاریخ دلخواه (مثال: 1404/08/03) را وارد کنید.');
      return res.status(200).send('ok');
    }

    if (step === 'ask_date') {
      state.preferred_date = text;
      state.step = 'ask_time';
      await callAppsScript({ action: 'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, '⏰ ساعت دلخواه (مثال: 10:30) را وارد کنید.');
      return res.status(200).send('ok');
    }

    if (step === 'ask_time') {
      state.preferred_time = text;
      state.step = 'confirm';
      await callAppsScript({ action: 'set_state', tg_user_id: tgUserId, state });

      const summary = `اطلاعات شما:\n👤 نام: ${state.full_name}\n📞 موبایل: ${state.phone}\n🚗 برند: ${state.brand}\n🔧 خدمت: ${state.service_type}\n🗓 تاریخ: ${state.preferred_date}\n⏰ ساعت: ${state.preferred_time}\n\nبرای تأیید "تایید" را بفرستید یا "لغو" برای بازگشت.`;
      await tgSend(chatId, summary);
      return res.status(200).send('ok');
    }

    if (step === 'confirm') {
      if (text === 'تایید' || text.toLowerCase() === 'ok' || text === 'confirm') {
        const app = {
          full_name: state.full_name,
          phone: state.phone,
          brand: state.brand,
          service_type: state.service_type,
          issue_text: state.issue_text,
          preferred_date: state.preferred_date,
          preferred_time: state.preferred_time,
          status: 'requested',
        };
        const apResp = await callAppsScript({ action: 'append_appointment', app });

        await tgSend(
          chatId,
          `✅ درخواست شما ثبت شد. همکاران با شما تماس می‌گیرند.\nشناسه نوبت: ${
            apResp.ok ? apResp.row : '-'
          }`
        );

        const msgToStaff = `🆕 نوبت جدید ثبت شد\n👤 نام: ${app.full_name}\n📞 تلفن: ${app.phone}\n🚗 برند: ${app.brand}\n🔧 خدمت: ${app.service_type}\n📝 توضیحات: ${app.issue_text}\n🗓 ${app.preferred_date} ⏰ ${app.preferred_time}\nID: ${
          apResp.ok ? apResp.row : ''
        }`;
        await tgSend(STAFF_CHAT_ID, msgToStaff);

        await callAppsScript({
          action: 'set_state',
          tg_user_id: tgUserId,
          state: { step: 'done' },
        });
        return res.status(200).send('ok');
      } else if (text === 'لغو' || text.toLowerCase() === 'cancel') {
        await callAppsScript({
          action: 'set_state',
          tg_user_id: tgUserId,
          state: { step: 'ask_full_name' },
        });
        await tgSend(chatId, '❌ عملیات لغو شد. لطفاً نام خود را بفرستید.');
        return res.status(200).send('ok');
      } else {
        await tgSend(chatId, 'برای تایید "تایید" یا برای لغو "لغو" را بفرستید.');
        return res.status(200).send('ok');
      }
    }

    // fallback
    await tgSend(chatId, 'برای شروع /start را بزنید.');
    return res.status(200).send('ok');
  } catch (err) {
    console.error('❌ ERR handler:', err);
    return res.status(200).send('ok');
  }
}
