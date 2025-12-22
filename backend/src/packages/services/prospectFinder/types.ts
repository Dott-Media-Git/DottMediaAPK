export type ProspectChannel = 'linkedin' | 'instagram' | 'web' | 'csv' | 'whatsapp';

export interface Prospect {
  id: string;
  name: string;
  company?: string;
  companyDomain?: string;
  companySize?: string;
  companySummary?: string;
  position?: string;
  industry?: string;
  location?: string;
  email?: string;
  phone?: string;
  profileUrl?: string;
  latestMediaId?: string;
  channel: ProspectChannel;
  score: number;
  createdAt: number;
  status?: 'new' | 'contacted' | 'converted' | 'replied' | 'not_interested' | 'skipped';
  lastContactedAt?: number;
  lastReplyAt?: number;
  lastMessagePreview?: string;
  lastChannel?: string;
  notes?: string;
  tags?: string[];
}

export type ProspectSeed = Omit<Prospect, 'id' | 'score' | 'createdAt' | 'status' | 'lastContactedAt'> & {
  id?: string;
  createdAt?: number;
};

export type ProspectDiscoveryParams = {
  industry: string;
  country?: string;
  keyword?: string;
  limit?: number;
  csvPath?: string;
  businessQuery?: string;
  channelHints?: Partial<Record<ProspectChannel, number>>;
};

export type ProspectRankingContext = {
  targetIndustry?: string;
  targetCountry?: string;
};
