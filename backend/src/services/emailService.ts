import nodemailer from 'nodemailer';
import { config } from '../config';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

const brevoApiKey = process.env.BREVO_API_KEY?.trim() ?? '';
const brevoSenderEmail =
  process.env.BREVO_SENDER_EMAIL?.trim() ||
  config.smtp.from?.match(/<([^>]+)>/)?.[1] ||
  config.smtp.from?.trim() ||
  'info@dott-media.org';
const brevoSenderName = process.env.BREVO_SENDER_NAME?.trim() || 'Dott Media';

const sendWithBrevo = async (input: {
  to: string;
  subject: string;
  textContent: string;
  htmlContent: string;
}) => {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: brevoSenderEmail, name: brevoSenderName },
      to: [{ email: input.to }],
      replyTo: { email: brevoSenderEmail, name: brevoSenderName },
      subject: input.subject,
      textContent: input.textContent,
      htmlContent: input.htmlContent,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { messageId?: string; message?: string };
  if (!response.ok) {
    throw new Error(`brevo_${response.status}:${payload.message ?? 'send_failed'}`);
  }
  return payload.messageId ?? null;
};

export const verifyEmailTransport = async () => {
  if (brevoApiKey) {
    try {
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: { accept: 'application/json', 'api-key': brevoApiKey },
      });
      if (!response.ok) return { ready: false, reason: `brevo_${response.status}` };
      return { ready: true, reason: 'brevo_ready' };
    } catch (error) {
      return { ready: false, reason: (error as Error).message };
    }
  }
  if (!config.smtp.host || !config.smtp.from || !config.smtp.user || !config.smtp.pass) {
    return { ready: false, reason: 'smtp_not_configured' };
  }
  try {
    await transporter.verify();
    return { ready: true, reason: 'smtp_ready' };
  } catch (error) {
    return { ready: false, reason: (error as Error).message };
  }
};

export async function sendWorkspaceLiveEmail(to: string, company: string) {
  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: 'Your AI workspace is live',
    text: [
      `Hi ${company} team,`,
      '',
      'Your AI workspace is live. You can start automating tasks right away.',
      '',
      '– Dott Media',
    ].join('\n'),
  });
}

export async function sendMonthlyPerformanceReportEmail(to: string, company: string, report: string) {
  return sendPerformanceReportEmail(to, company, report, 'Monthly');
}

export async function sendPerformanceReportEmail(
  to: string,
  company: string,
  report: string,
  period: 'Weekly' | 'Monthly',
) {
  if (!brevoApiKey && (!config.smtp.host || !config.smtp.from || !config.smtp.user || !config.smtp.pass)) {
    throw new Error('smtp_not_configured');
  }
  const escaped = report
    .split('\n')
    .map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .join('<br>');
  const subject = `${period} performance report - ${company}`;
  const textContent = [
      `Hi ${company} team,`,
      '',
      report,
      '',
      '-- Dott Media',
    ].join('\n');
  const htmlContent = `
      <div style="margin:0;background:#f3f7f9;padding:28px;font-family:Arial,sans-serif;color:#132238">
        <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #dbe4ec;border-radius:16px;overflow:hidden">
          <div style="height:7px;background:#0f766e"></div>
          <div style="padding:30px">
            <div style="font-size:20px;font-weight:700;color:#081527">Dott Media</div>
            <div style="margin-top:4px;color:#0f766e;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${period} account report</div>
            <p style="margin:28px 0 18px;color:#5d6b7e">Hi ${company} team,</p>
            <div style="font-size:14px;line-height:1.7">${escaped}</div>
          </div>
          <div style="padding:16px 30px;background:#081527;color:#c7d9e1;font-size:11px">Dott Media • Intelligent Business Growth</div>
        </div>
      </div>`;
  if (brevoApiKey) {
    await sendWithBrevo({ to, subject, textContent, htmlContent });
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text: textContent, html: htmlContent });
}

export async function sendOperationalAlertEmail(to: string | string[], subject: string, body: string) {
  if (!config.smtp.host || !config.smtp.from || !config.smtp.user || !config.smtp.pass) {
    throw new Error('smtp_not_configured');
  }
  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text: body,
  });
}
