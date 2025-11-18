import 'dotenv/config';
const required = (obj) => {
    Object.entries(obj).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            throw new Error(`Missing required env var: ${key}`);
        }
    });
    return obj;
};
const metaVerifyToken = process.env.META_VERIFY_TOKEN ?? process.env.VERIFY_TOKEN;
if (!metaVerifyToken) {
    throw new Error('Missing required env var: META_VERIFY_TOKEN or VERIFY_TOKEN');
}
export const config = {
    port: Number(process.env.PORT ?? 4000),
    make: required({
        baseUrl: process.env.MAKE_BASE_URL ?? 'https://api.make.com/v2',
        apiKey: process.env.MAKE_API_KEY ?? process.env.MAKE_API_TOKEN,
        webhookUrl: process.env.MAKE_WEBHOOK_URL,
        templateId: process.env.MAKE_SCENARIO_TEMPLATE_ID,
    }),
    channels: {
        metaVerifyToken,
        facebook: required({
            pageId: process.env.FACEBOOK_PAGE_ID,
            pageToken: process.env.FACEBOOK_PAGE_TOKEN,
        }),
        instagram: required({
            businessId: process.env.INSTAGRAM_BUSINESS_ID,
            accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
        }),
        threads: required({
            profileId: process.env.THREADS_PROFILE_ID,
            accessToken: process.env.THREADS_ACCESS_TOKEN,
        }),
    },
    linkedin: required({
        accessToken: process.env.LINKEDIN_ACCESS_TOKEN,
        organizationId: process.env.LINKEDIN_ORGANIZATION_ID,
    }),
    whatsapp: required({
        token: process.env.WHATSAPP_TOKEN,
        verifyToken: process.env.VERIFY_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    }),
    smtp: required({
        from: process.env.MAIL_FROM,
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 465),
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    }),
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    sentry: {
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENV ?? 'local',
    },
    openAI: required({
        apiKey: process.env.OPENAI_API_KEY,
    }),
    calendar: {
        timezone: process.env.DEFAULT_TIMEZONE ?? 'UTC',
        calendly: {
            apiKey: process.env.CALENDLY_API_KEY,
            schedulingLink: process.env.CALENDLY_SCHEDULING_LINK,
        },
        google: {
            serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT,
            calendarId: process.env.GOOGLE_CALENDAR_ID,
        },
    },
    security: {
        allowMockAuth: process.env.ALLOW_MOCK_AUTH === 'true',
    },
    widget: required({
        sharedSecret: process.env.WIDGET_SHARED_SECRET,
    }),
    followUps: {
        enableAuto: process.env.ENABLE_AUTO_FOLLOWUPS !== 'false',
    },
};
