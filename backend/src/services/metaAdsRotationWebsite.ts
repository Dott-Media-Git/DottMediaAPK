export const carMarketWebsite = 'https://cmp.dott-media.org/';
export const carMarketWebsiteHeadline = 'Visit Car Market Place Website';

export function buildCarMarketWebsiteCreative(input: {
  pageId: string;
  instagramId?: string;
  imageHash: string;
  caption?: string;
}) {
  const caption = (input.caption ?? '')
    .replace(/https?:\/\/[^\s<>]+/gi, '')
    .trim()
    .slice(0, 1700)
    .trimEnd();
  return {
    page_id: input.pageId,
    ...(input.instagramId ? { instagram_user_id: input.instagramId } : {}),
    link_data: {
      link: carMarketWebsite,
      name: carMarketWebsiteHeadline,
      message: [caption, carMarketWebsiteHeadline].filter(Boolean).join('\n\n'),
      image_hash: input.imageHash,
      call_to_action: { type: 'LEARN_MORE', value: { link: carMarketWebsite } },
    },
  };
}
