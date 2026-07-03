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
  if (!config.smtp.host || !config.smtp.from || !config.smtp.user || !config.smtp.pass) {
    throw new Error('smtp_not_configured');
  }
  const escaped = report
    .split('\n')
    .map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .join('<br>');
  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: `${period} performance report - ${company}`,
    text: [
      `Hi ${company} team,`,
      '',
      report,
      '',
      '-- Dott Media',
    ].join('\n'),
    html: `
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
      </div>`,
  });
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
