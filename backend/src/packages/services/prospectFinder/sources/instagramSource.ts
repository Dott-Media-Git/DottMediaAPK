import axios from 'axios';
import { ProspectDiscoveryParams, ProspectSeed } from '../types';

type InstagramParams = ProspectDiscoveryParams & { hashtag?: string };

/**
 * Uses Meta Graph API when available, otherwise falls back to curated mocks.
 */
export async function searchInstagramProspects(params: InstagramParams): Promise<ProspectSeed[]> {
  if (process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ID) {
    try {
      const response = await queryInstagramApi(params);
      if (response.length) return response;
    } catch (error) {
      console.warn('Instagram API lookup failed, using mock list', error);
    }
  }
  return mockInstagramProspects(params);
}

async function queryInstagramApi(params: InstagramParams): Promise<ProspectSeed[]> {
  if (!process.env.INSTAGRAM_ACCESS_TOKEN || !process.env.INSTAGRAM_BUSINESS_ID) return [];
  const hashtag = params.hashtag ?? params.industry?.replace(/\s+/g, '') ?? 'automation';
  const url = `https://graph.facebook.com/v18.0/ig_hashtag_search?user_id=${process.env.INSTAGRAM_BUSINESS_ID}&q=${encodeURIComponent(hashtag)}&access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`;
  const response = await axios.get(url);
  const hashtags: Array<Record<string, unknown>> = response.data?.data ?? [];
  if (!hashtags.length) return [];
  const hashtagId = hashtags[0]?.id;
  if (!hashtagId) return [];
  const mediaUrl = `https://graph.facebook.com/v18.0/${hashtagId}/top_media?user_id=${process.env.INSTAGRAM_BUSINESS_ID}&fields=caption,permalink,username&access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`;
  const mediaResponse = await axios.get(mediaUrl);
  const media = (mediaResponse.data?.data as Array<Record<string, unknown>>) ?? [];

  return media.slice(0, params.limit ?? 20).map(item => ({
    id: `ig-${item.id}`,
    name: (item['username'] as string) ?? 'Instagram Prospect',
    company: item['caption']?.toString().split('|')[0]?.trim(),
    industry: params.industry,
    profileUrl: item['permalink'] as string,
    channel: 'instagram',
  }));
}

function mockInstagramProspects(params: InstagramParams): ProspectSeed[] {
  const industry = params.industry ?? 'automation';
  return [
    {
      id: `mock-ig-${industry}-1`,
      name: 'Makena Creative',
      company: 'Makena Luxury Homes',
      position: 'Founder',
      industry,
      profileUrl: 'https://instagram.com/makena.lux',
      location: params.country ?? 'Kenya',
      channel: 'instagram',
    },
    {
      id: `mock-ig-${industry}-2`,
      name: 'Nomsa Studio',
      company: 'Nomsa Digital',
      position: 'Director',
      industry,
      profileUrl: 'https://instagram.com/nomsa.digital',
      location: 'South Africa',
      channel: 'instagram',
    },
  ];
}
