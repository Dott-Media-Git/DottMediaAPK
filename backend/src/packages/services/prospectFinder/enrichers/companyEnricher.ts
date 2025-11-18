import axios from 'axios';
import { Prospect } from '../types';

const ENRICHER_ENDPOINT = process.env.COMPANY_ENRICHER_URL ?? 'https://company.clearbit.com/v2/companies/find';

/**
 * Adds simple company metadata so ranker has richer context.
 */
export async function enrichProspects(prospects: Prospect[]): Promise<Prospect[]> {
  const enriched: Prospect[] = [];
  for (const prospect of prospects) {
    if (!prospect.company) {
      enriched.push({
        ...prospect,
        companySize: prospect.companySize ?? 'unknown',
        companySummary: prospect.companySummary ?? 'Emerging brand exploring automation.',
      });
      continue;
    }

    const enrichment = await lookupCompany(prospect.company);
    enriched.push({
      ...prospect,
      companyDomain: enrichment?.domain ?? prospect.companyDomain,
      companySize: enrichment?.size ?? prospect.companySize ?? '50-200',
      companySummary: enrichment?.description ?? prospect.companySummary ?? 'High-growth team evaluating AI.',
    });
  }
  return enriched;
}

type Enrichment = {
  domain?: string;
  size?: string;
  description?: string;
};

async function lookupCompany(company: string): Promise<Enrichment | null> {
  if (!process.env.COMPANY_ENRICHER_API_KEY) {
    return {
      domain: `${company.replace(/\s+/g, '').toLowerCase()}.com`,
      size: '20-50',
      description: 'Growth-focused team with appetite for automation.',
    };
  }

  try {
    const response = await axios.get(ENRICHER_ENDPOINT, {
      params: { domain: company },
      headers: {
        Authorization: `Bearer ${process.env.COMPANY_ENRICHER_API_KEY}`,
      },
    });
    return {
      domain: response.data?.domain,
      size: response.data?.metrics?.employees_range,
      description: response.data?.description,
    };
  } catch (error) {
    console.warn(`Company enrichment failed for ${company}`, error);
    return null;
  }
}
