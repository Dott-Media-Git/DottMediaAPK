import axios from 'axios';
import { ProspectSeed, ProspectDiscoveryParams } from '../types';

type LinkedInParams = ProspectDiscoveryParams & { keyword?: string };

/**
 * Stubbed LinkedIn discovery with hooks for REST/Puppeteer integrations.
 */
export async function searchLinkedInProspects(params: LinkedInParams): Promise<ProspectSeed[]> {
  const hasApiAccess = Boolean(process.env.LINKEDIN_ACCESS_TOKEN);
  if (hasApiAccess) {
    try {
      const results = await queryLinkedInApi(params);
      if (results.length) return results;
    } catch (error) {
      console.warn('LinkedIn API lookup failed, falling back to mock data', error);
    }
  }

  return mockLinkedInProspects(params);
}

async function queryLinkedInApi(params: LinkedInParams): Promise<ProspectSeed[]> {
  if (!process.env.LINKEDIN_ACCESS_TOKEN) return [];
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const query = params.keyword ?? params.industry;
  if (!query) return [];

  const url = `https://api.linkedin.com/v2/search?q=keyword&query=${encodeURIComponent(query)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const elements = (response.data?.elements as Array<Record<string, unknown>>) ?? [];
  return elements.slice(0, params.limit ?? 25).map((element, index) => ({
    id: `li-${element['id'] ?? index}`,
    name: (element['firstName'] && element['lastName'] ? `${element['firstName']} ${element['lastName']}` : (element['name'] as string)) ?? 'LinkedIn Prospect',
    company: (element['companyName'] as string) ?? element['headline']?.toString()?.split(' at ')[1],
    position: (element['headline'] as string) ?? 'Leader',
    industry: params.industry,
    location: (element['locationName'] as string) ?? params.country,
    profileUrl: element['publicProfileUrl'] as string,
    channel: 'linkedin',
  }));
}

function mockLinkedInProspects(params: LinkedInParams): ProspectSeed[] {
  const industry = params.industry ?? 'AI';
  return [
    {
      id: `mock-li-${industry.toLowerCase()}-1`,
      name: 'Aisha Kintu',
      company: 'Kampala Realty Hub',
      position: 'Growth Director',
      industry,
      email: 'aisha.kintu+li@kampalarealty.com',
      profileUrl: 'https://linkedin.com/in/aishakintu',
      location: params.country ?? 'Uganda',
      channel: 'linkedin',
    },
    {
      id: `mock-li-${industry.toLowerCase()}-2`,
      name: 'Javier Mendez',
      company: 'Skyline Estates',
      position: 'Sales Manager',
      industry,
      email: 'javier@skylineestates.co',
      profileUrl: 'https://linkedin.com/in/javiermendez',
      location: 'Colombia',
      channel: 'linkedin',
    },
  ];
}
