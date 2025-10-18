// api/telegram.js (Vercel)
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPSCRIPT_URL = process.env.APPSCRIPT_URL; // script web app exec URL
const SECRET = process.env.SECRET_TOKEN; // '441155kojour'
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

async function callAppsScript(payload) {
  payload.secret = SECRET;
  const resp = await fetch(APPSCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return resp.json();
}

function tgSend(chatId, text) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode:'HTML' })
  });
}

// simple helpers
function mkKb(arrRows) {
  return { keyboard: arrRows, one_time_keyboard: true, resize_keyboard: true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');

    const update = req.body || {};
    const update_id = update.update_id;
    // dedupe via AppsScript cache
    const ded = await callAppsScript({ action:'is_new_update', update_id });
    if (!ded.ok || ded.isNew === false) {
      return res.status(200).send('dup');
    }

    // handle messages
    const msg = update.message || update.callback_query && update.callback_query.message;
    if (!msg) { return res.status(200).send('no message'); }

    const text = (msg.text || '').trim();
    const tgUserId = msg.from.id;
    const chatId = msg.chat.id;

    // quick commands
    if (text === '/start') {
      await tgSend(chatId, 'سلام! برای رزرو نوبت لطفاً نام و نام‌خانوادگی‌تان را بنویسید.');
      // init state
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state: { step:'ask_full_name' } });
      return res.status(200).send('ok');
    }
    if (text === '/reset') {
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state: { step:'ask_full_name', full_name:'', phone:'', brand:'', service_type:'', issue_text:'', preferred_date:'', preferred_time:'' } });
      await tgSend(chatId, 'ریست شد. لطفاً نام و نام‌خانوادگی‌تان را بفرستید.');
      return res.status(200).send('ok');
    }

    // load state
    const stResp = await callAppsScript({ action:'get_state', tg_user_id: tgUserId });
    let state = (stResp.ok && stResp.state) ? stResp.state : { tg_user_id: String(tgUserId), step:'ask_full_name' };

    const step = state.step || 'ask_full_name';

    // state machine
    if (step === 'ask_full_name') {
      // accept current text as name
      if (!text) { await tgSend(chatId,'لطفاً نام را وارد کنید.'); return res.status(200).send('ok'); }
      state.full_name = text;
      state.step = 'ask_phone';
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, 'شماره موبایل خود را بفرستید (مثال: 09xxxxxxxxx)');
      return res.status(200).send('ok');
    }

    if (step === 'ask_phone') {
      const phone = text.replace(/\s+/g,'');
      if (!/^09\d{9}$/.test(phone)) { await tgSend(chatId, 'فرمت شماره اشتباه است؛ مثال: 09123456789'); return res.status(200).send('ok'); }
      state.phone = phone; state.step = 'ask_brand';
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, 'برند خودروی شما؟', mkKb([['MVM','Chery','Fownix','Other']]));
      return res.status(200).send('ok');
    }

    if (step === 'ask_brand') {
      state.brand = text; state.step = 'ask_service_type';
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, 'نوع خدمت را انتخاب کنید', mkKb([['دوره‌ای','تعمیری'],['بررسی','نصب آپشن','گارانتی']]));
      return res.status(200).send('ok');
    }

    if (step === 'ask_service_type') {
      state.service_type = text; state.step = 'ask_issue';
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, 'کمی توضیح در مورد مشکل یا درخواست بنویسید.');
      return res.status(200).send('ok');
    }

    if (step === 'ask_issue') {
      state.issue_text = text; state.step = 'ask_date';
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, 'تاریخ دلخواه (مثال: 1404/08/03) را وارد کنید.');
      return res.status(200).send('ok');
    }

    if (step === 'ask_date') {
      state.preferred_date = text; state.step = 'ask_time';
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state });
      await tgSend(chatId, 'ساعت دلخواه (مثال: 10:30) را وارد کنید.');
      return res.status(200).send('ok');
    }

    if (step === 'ask_time') {
      state.preferred_time = text; state.step = 'confirm';
      await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state });
      // send confirmation message with keyboard
      const summary =
        `اطلاعات شما:\nنام: ${state.full_name}\nموبایل: ${state.phone}\nبرند: ${state.brand}\nخدمت: ${state.service_type}\nتاریخ: ${state.preferred_date}\nساعت: ${state.preferred_time}\n\nبرای تأیید "تایید" را بفرستید یا "لغو" برای بازگشت.`;
      await tgSend(chatId, summary, ); // simple text
      return res.status(200).send('ok');
    }

    if (step === 'confirm') {
      if (text === 'تایید' || text.toLowerCase() === 'ok' || text === 'confirm') {
        // append appointment via Apps Script
        const app = {
          full_name: state.full_name,
          phone: state.phone,
          brand: state.brand,
          service_type: state.service_type,
          issue_text: state.issue_text,
          preferred_date: state.preferred_date,
          preferred_time: state.preferred_time,
          status: 'requested'
        };
        const apResp = await callAppsScript({ action:'append_appointment', app });
        // send confirmation to user
        await tgSend(chatId, 'درخواست شما ثبت شد. همکاران با شما تماس می‌گیرند. شناسه: ' + (apResp.ok?apResp.row:'-'));
        // send message to staff group
        const msgToStaff =
          `🆕 نوبت جدید ثبت شد\nنام: ${app.full_name}\nتلفن: ${app.phone}\nبرند: ${app.brand}\nخدمت: ${app.service_type}\nتوضیحات: ${app.issue_text}\nترجیح: ${app.preferred_date} ${app.preferred_time}\nID: ${apResp.ok?apResp.row:''}`;
        await tgSend(STAFF_CHAT_ID, msgToStaff);
        // reset state
        await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state: { step:'done' }});
        return res.status(200).send('ok');
      } else if (text === 'لغو' || text.toLowerCase()==='cancel') {
        await callAppsScript({ action:'set_state', tg_user_id: tgUserId, state: { step:'ask_full_name' }});
        await tgSend(chatId, 'عملیات لغو شد. نام خود را بفرستید.');
        return res.status(200).send('ok');
      } else {
        await tgSend(chatId, 'برای تایید "تایید" یا برای لغو "لغو" را بفرستید.');
        return res.status(200).send('ok');
      }
    }

    // default fallback
    await tgSend(chatId, 'برای شروع /start را بزنید.');
    return res.status(200).send('ok');

  } catch (err) {
    console.error('ERR handler:', err);
    return res.status(200).send('ok');
  }
}
