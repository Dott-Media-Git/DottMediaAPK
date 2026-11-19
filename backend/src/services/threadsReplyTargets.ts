// Existing businesses configured before owner-controlled settings were added.
export const LEGACY_THREADS_REPLY_USER_IDS = [
  'ouwaugr76lhdQ6IJbTuoCK9yMV93', 'cMPZQccGggbhZe9dbvtxFmBehP02',
  '80bYIeiuukNFtUvXTUobXmfC7pu1', 'LVR7p3WzdFM51ds92Kacf6S40og2',
  '1zvY9nNyXMcfxdPQEyx0bIdK7r53', 'acmVetCcOiTHeGk5D7eDYieamDF3',
  'D1iNgjLKNRaQhH35M0NmGfw1LVD2', 'vzdH1DnfFLVjlY8bBgC26WACmmw2',
];
export const getLegacyThreadsReplyUserIds = () => Array.from(new Set([
  ...LEGACY_THREADS_REPLY_USER_IDS,
  ...(process.env.THREADS_COMMENT_POLL_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean),
]));
