// api/telegram.js - Vercel Serverless Function

export default async function handler(req, res) {
  // Telegram only sends POST; any other method returns OK (healthcheck)
  if (req.method !== 'POST') return res.status(200).send('OK');

  // Security: must match the secret you pass in setWebhook
  const secret = req.headers['x-telegram-bot-api-secret-token'] || '';
  if (!process.env.SECRET_TOKEN || secret !== process.env.SECRET_TOKEN) {
    return res.status(403).send('forbidden');
  }

  try {
    // Forward the JSON body to your Google Apps Script Web App
    await fetch(process.env.TARGET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Vercel parses JSON body for Node functions:
      body: JSON.stringify(req.body || {})
    });
  } catch (e) {
    // Even if Apps Script is slow/down, don't make Telegram retry
  }

  return res.status(200).send('OK');
}
