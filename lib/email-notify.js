import net from 'node:net';
import tls from 'node:tls';

function formatMoney(value) {
  return `₺${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

function formatProfit(value) {
  const profit = Number(value || 0);
  const sign = profit < 0 ? '-' : '';
  return `${sign}₺${Math.abs(profit).toFixed(2).replace('.', ',')}`;
}

export function buildLossOrderEmail(row) {
  const profit = Number(row.netProfit || 0);
  const subject = `Zarar sipariş: ${row.orderNumber} (${formatProfit(profit)})`;
  const text = [
    'Zarar sipariş tespit edildi',
    '',
    `Sipariş: ${row.orderNumber}`,
    `Tarih: ${row.orderDate || ''}`,
    `Tutar: ${formatMoney(row.salesAmount)}`,
    `Net kâr: ${formatProfit(profit)}`,
    `Kâr %: ${Number(row.profitRate || 0).toFixed(1).replace('.', ',')}%`,
    '',
    'BuyBox Platform — Sipariş Kârlılığı'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="tr">
<body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
  <h2 style="color:#b91c1c;margin:0 0 12px">Zarar sipariş tespit edildi</h2>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
    <tr><td><strong>Sipariş</strong></td><td>${escapeHtml(row.orderNumber)}</td></tr>
    <tr><td><strong>Tarih</strong></td><td>${escapeHtml(row.orderDate || '')}</td></tr>
    <tr><td><strong>Tutar</strong></td><td>${escapeHtml(formatMoney(row.salesAmount))}</td></tr>
    <tr><td><strong>Net kâr</strong></td><td style="color:#b91c1c;font-weight:700">${escapeHtml(formatProfit(profit))}</td></tr>
    <tr><td><strong>Kâr %</strong></td><td>${escapeHtml(Number(row.profitRate || 0).toFixed(1).replace('.', ',') + '%')}</td></tr>
  </table>
  <p style="margin-top:16px;color:#6b7280;font-size:12px">BuyBox Platform — Sipariş Kârlılığı</p>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines.at(-1) || '';

      if (/^\d{3} /.test(lastLine)) {
        cleanup();
        const code = Number(lastLine.slice(0, 3));
        if (code >= 400) {
          reject(new Error(`SMTP hatası: ${buffer.trim()}`));
          return;
        }
        resolve(buffer.trim());
      }
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function cleanup() {
      socket.off('data', onData);
      socket.off('error', onError);
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function smtpTalk(socket, command) {
  if (command) {
    socket.write(`${command}\r\n`);
  }
  return readSmtpResponse(socket);
}

function base64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `buybox_${Date.now()}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].join('\r\n');

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${boundary}--`,
    ''
  ].join('\r\n');

  return `${headers}\r\n\r\n${body}`;
}

export function normalizeSmtpConfig(input = {}) {
  return {
    host: String(input.host || 'smtp.gmail.com').trim(),
    port: Number(input.port || 587),
    user: String(input.user || '').trim(),
    pass: String(input.pass || '').trim(),
    from: String(input.from || input.user || '').trim()
  };
}

export function smtpIsConfigured(config) {
  const normalized = normalizeSmtpConfig(config);
  return Boolean(normalized.host && normalized.user && normalized.pass);
}

async function openSocket(host, port) {
  const secure = port === 465;
  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  await new Promise((resolve, reject) => {
    socket.once(secure ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
  });

  await readSmtpResponse(socket);
  return socket;
}

async function upgradeStartTls(socket, host) {
  await smtpTalk(socket, 'STARTTLS');
  const secure = tls.connect({ socket, servername: host });
  await new Promise((resolve, reject) => {
    secure.once('secureConnect', resolve);
    secure.once('error', reject);
  });
  socket.removeAllListeners();
  return secure;
}

async function sendViaSmtp(config, { to, subject, text, html }) {
  const smtp = normalizeSmtpConfig(config);
  const from = smtp.from || smtp.user;
  const message = buildMimeMessage({ from, to, subject, text, html });

  let socket = await openSocket(smtp.host, smtp.port);

  try {
    await smtpTalk(socket, 'EHLO buybox-platform');

    if (smtp.port !== 465) {
      socket = await upgradeStartTls(socket, smtp.host);
      await smtpTalk(socket, 'EHLO buybox-platform');
    }

    await smtpTalk(socket, 'AUTH LOGIN');
    await smtpTalk(socket, base64(smtp.user));
    await smtpTalk(socket, base64(smtp.pass));
    await smtpTalk(socket, `MAIL FROM:<${from}>`);
    await smtpTalk(socket, `RCPT TO:<${to}>`);
    await smtpTalk(socket, 'DATA');
    socket.write(`${message.replace(/\r?\n/g, '\r\n')}\r\n.\r\n`);
    await readSmtpResponse(socket);
    await smtpTalk(socket, 'QUIT');
  } finally {
    socket.end();
  }
}

export async function sendEmail(smtpConfig, { to, subject, text, html }) {
  const recipient = String(to || '').trim();

  if (!recipient) {
    throw new Error('Alıcı e-posta adresi tanımlı değil.');
  }

  if (!smtpIsConfigured(smtpConfig)) {
    throw new Error('SMTP ayarları eksik. .env dosyasında SMTP_USER ve SMTP_PASS tanımlayın.');
  }

  await sendViaSmtp(smtpConfig, { to: recipient, subject, text, html });
  return { ok: true, to: recipient };
}
