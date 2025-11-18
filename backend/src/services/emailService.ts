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
