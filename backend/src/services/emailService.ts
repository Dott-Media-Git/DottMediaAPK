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
const brevoSmsSender = (process.env.BREVO_SMS_SENDER?.trim() || 'DottMedia').slice(0, 11);

const sendWithBrevo = async (input: {
  to: string;
  subject: string;
  textContent: string;
  htmlContent: string;
  tags?: string[];
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
      tags: input.tags ?? ['transactional'],
      headers: {
        'X-Mailer': 'Dott Media Transactional',
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
      },
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

export const verifyBrevoTransport = async () => {
  if (!brevoApiKey) return { ready: false, reason: 'brevo_not_configured' };
  try {
    const response = await fetch('https://api.brevo.com/v3/account', {
      headers: { accept: 'application/json', 'api-key': brevoApiKey },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string };
      return { ready: false, reason: `brevo_${response.status}:${payload.message ?? 'account_check_failed'}` };
    }
    return { ready: true, reason: 'brevo_ready' };
  } catch (error) {
    return { ready: false, reason: (error as Error).message };
  }
};

export async function sendPhoneVerificationSms(to: string, code: string) {
  if (!brevoApiKey) throw new Error('brevo_not_configured');
  const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: brevoSmsSender,
      recipient: to,
      content: `Your Dott Media verification code is ${code}. It expires in 10 minutes.`,
      type: 'transactional',
      tag: 'phone-verification',
    }),
  });
  const payload = await response.json().catch(() => ({})) as { messageId?: number; message?: string };
  if (!response.ok) {
    const message = payload.message ?? 'send_failed';
    if (response.status === 402 || /credit/i.test(message)) {
      throw new Error('Brevo SMS credits are not available. Add SMS credits in Brevo, then try sending the code again.');
    }
    throw new Error(`Brevo SMS failed (${response.status}): ${message}`);
  }
  return payload.messageId ?? null;
}

export async function sendWorkspaceLiveEmail(to: string, company: string) {
  const subject = 'Your Dott Media workspace is live';
  const textContent = [
    `Hi ${company} team,`,
    '',
    'Your Dott Media workspace is live. You can start automating tasks right away.',
    '',
    'Dott Media',
  ].join('\n');
  const htmlContent = `<p>Hi ${company} team,</p><p>Your Dott Media workspace is live. You can start automating tasks right away.</p><p>Dott Media</p>`;
  if (brevoApiKey) {
    await sendWithBrevo({ to, subject, textContent, htmlContent, tags: ['transactional', 'workspace'] });
  } else {
    await transporter.sendMail({ from: config.smtp.from, to, subject, text: textContent, html: htmlContent });
  }
  return;
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

export async function sendAccountVerificationEmail(to: string, displayName: string, verificationUrl: string) {
  {
    const safeName = displayName.trim() || 'there';
    const escapedName = safeName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedUrl = verificationUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const escapedTo = to.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const subject = 'Confirm your email address';
    const textContent = [
      `Hi ${safeName},`,
      '',
      'Please confirm your email address to finish setting up your Dott Media account.',
      '',
      `Confirm email: ${verificationUrl}`,
      '',
      'This link expires automatically. If you did not create this account, you can ignore this email.',
      '',
      'Dott Media',
    ].join('\n');
    const htmlContent = `
      <div style="margin:0;background:#f6f8fb;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#172033">
        <div style="max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
          <div style="padding:32px 36px">
            <div style="font-size:18px;font-weight:700;color:#111827">Dott Media</div>
            <h1 style="margin:28px 0 12px;font-size:24px;line-height:1.25;color:#111827">Confirm your email address</h1>
            <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4b5563">
              Hi ${escapedName},<br><br>
              Please confirm your email address to finish setting up your Dott Media account.
            </p>
            <a href="${escapedUrl}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">Confirm email</a>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.55;color:#6b7280">
              This message was sent to ${escapedTo}. If the button does not work, paste this link into your browser:
            </p>
            <p style="word-break:break-all;margin:8px 0 0;font-size:12px;line-height:1.5;color:#6b7280">${escapedUrl}</p>
            <p style="margin:20px 0 0;font-size:13px;line-height:1.55;color:#6b7280">
              If you did not create a Dott Media account, you can ignore this email.
            </p>
          </div>
          <div style="padding:16px 36px;background:#f9fafb;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">Dott Media</div>
        </div>
      </div>`;
    if (brevoApiKey) {
      await sendWithBrevo({ to, subject, textContent, htmlContent, tags: ['transactional', 'email-verification'] });
    } else {
      await transporter.sendMail({ from: config.smtp.from, to, subject, text: textContent, html: htmlContent });
    }
    return;
  }
  const safeName = displayName.trim() || 'there';
  const escapedName = safeName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedUrl = verificationUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const subject = 'Verify your Dott Media email';
  const textContent = [
    `Hi ${safeName},`,
    '',
    'Confirm your email address to securely activate your Dott Media account.',
    '',
    `Verify email: ${verificationUrl}`,
    '',
    'If you did not create this account, you can ignore this email.',
  ].join('\n');
  const htmlContent = `
    <div style="margin:0;background:#f3f7f9;padding:32px 16px;font-family:Arial,sans-serif;color:#132238">
      <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #dbe4ec;border-radius:18px;overflow:hidden">
        <div style="height:7px;background:#0f766e"></div>
        <div style="padding:36px 38px">
          <div style="font-size:20px;font-weight:700;color:#081527">Dott Media</div>
          <div style="margin-top:5px;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#0f766e;font-weight:700">Sales &amp; Marketing Agent</div>
          <h1 style="margin:30px 0 12px;font-size:28px;line-height:1.2;color:#081527">Verify your email</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#5d6b7e">
            Hi ${escapedName},<br><br>
            Confirm your email address to securely activate your Dott Media account.
          </p>
          <a href="${escapedUrl}" style="display:inline-block;padding:14px 27px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-size:15px;font-weight:700">Verify Email</a>
          <p style="margin:25px 0 0;font-size:12px;line-height:1.55;color:#7b8796">
            This button is intended for ${to}. If you did not create a Dott Media account, you can safely ignore this email.
          </p>
        </div>
        <div style="padding:18px 38px;background:#081527;color:#c7d9e1;font-size:11px">Dott Media &bull; Intelligent Business Growth</div>
      </div>
    </div>`;
  if (brevoApiKey) {
    await sendWithBrevo({ to, subject, textContent, htmlContent });
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text: textContent, html: htmlContent });
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
