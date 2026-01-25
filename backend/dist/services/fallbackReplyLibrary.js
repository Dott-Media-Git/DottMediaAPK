const library = {
    message: {
        default: [
            'Thanks for reaching out to Dott Media! Want a quick demo or pricing overview?',
            'Appreciate the message. We can share a short Dott Media AI Sales Agent walkthrough and next steps.',
            'Glad you connected with Dott Media. Tell us your goal and we will recommend the best AI setup.',
            'Thanks for contacting Dott Media! If you want, we can set up a quick demo and send details.',
        ],
        instagram: [
            'Thanks for reaching out! Want a quick Dott Media AI demo or details?',
            'Appreciate the message. We can share a short Dott Media AI overview and next steps.',
        ],
        facebook: [
            'Thanks for the message! Want a quick Dott Media AI demo or more details?',
            'Appreciate you reaching out. We can share a short Dott Media AI walkthrough.',
        ],
        whatsapp: [
            'Thanks for reaching out to Dott Media. Want a quick demo or details?',
            'Appreciate the message. We can share a short Dott Media AI overview and next steps.',
        ],
        threads: [
            'Thanks for reaching out! Want a quick Dott Media AI demo or details?',
            'Appreciate the message. We can share a short Dott Media AI overview and next steps.',
        ],
        linkedin: [
            'Thanks for connecting with Dott Media. Happy to share a brief AI automation overview or set a quick demo.',
            'Appreciate the note. We can send a short Dott Media AI Sales Agent walkthrough if helpful.',
        ],
        web: [
            'Thanks for reaching out to Dott Media! Want a quick demo or pricing overview?',
            'Appreciate the message. We can share a short Dott Media AI Sales Agent walkthrough and next steps.',
        ],
    },
    comment: {
        default: [
            'Thanks for the comment! DM us if you want a quick Dott Media AI demo.',
            'Appreciate the support. Happy to share Details through https://api.whatsapp.com/send/?phone=0775067216&text&type=phone_number&app_absent=0',
            'Thanks for engaging! We can share a short demo link if you want.',
        ],
        instagram: [
            'Thanks for the comment! DM us if you want a quick Dott Media AI demo.',
            'Appreciate the support. Happy to share Details through https://api.whatsapp.com/send/?phone=0775067216&text&type=phone_number&app_absent=0',
        ],
        facebook: [
            'Thanks for the comment! Send us a message if you want a quick Dott Media AI demo.',
            'Appreciate the support. Happy to share Details through https://api.whatsapp.com/send/?phone=0775067216&text&type=phone_number&app_absent=0',
        ],
        linkedin: [
            'Thanks for the note. Happy to share a brief overview in a message.',
            'Appreciate the comment. We can share a short Dott Media AI demo link if you want.',
        ],
    },
};
const pickRandom = (items) => items[Math.floor(Math.random() * items.length)];
export function pickFallbackReply(options) {
    const channel = options.channel || 'web';
    const kind = options.kind;
    const pool = library[kind]?.[channel] ?? library[kind]?.default ?? [];
    if (!pool.length) {
        return 'Thanks for reaching out to Dott Media! We will follow up shortly.';
    }
    return pickRandom(pool);
}
