import nodemailer from 'nodemailer';
import { config } from '../config.js';
const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
    },
});
export async function sendWorkspaceLiveEmail(to, company) {
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
export async function sendMonthlyPerformanceReportEmail(to, company, report) {
    await transporter.sendMail({
        from: config.smtp.from,
        to,
        subject: `Monthly performance report - ${company}`,
        text: [
            `Hi ${company} team,`,
            '',
            report,
            '',
            '-- Dott Media',
        ].join('\n'),
    });
}
