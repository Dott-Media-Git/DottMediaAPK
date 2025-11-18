export type OrgPlan = 'Free' | 'Pro' | 'Enterprise';

export type OrgRole = 'Owner' | 'Admin' | 'Agent' | 'Viewer';

export type OrgLocale = {
  lang: string;
  tz: string;
  currency: string;
};

export type OrgDocument = {
  name: string;
  logoUrl?: string;
  plan: OrgPlan;
  locale: OrgLocale;
  createdAt: number;
  ownerUid: string;
};

export type OrgUserDocument = {
  orgId: string;
  uid: string;
  role: OrgRole;
  invitedBy?: string;
  createdAt: number;
};

export type OrgSettingsDocument = {
  channels: Record<
    'whatsapp' | 'instagram' | 'facebook' | 'linkedin' | 'web',
    {
      enabled: boolean;
      phoneNumberId?: string;
      tokenRef?: string;
      pageId?: string;
      orgId?: string;
      widgetKeyRef?: string;
    }
  >;
  features: {
    leadGen: boolean;
    crm: boolean;
    support: boolean;
    booking: boolean;
    outbound: boolean;
    contentEngagement: boolean;
    retargeting: boolean;
  };
  booking: {
    provider: 'google' | 'calendly';
    calendarId?: string;
    calendlyApiKeyRef?: string;
  };
  knowledgeBase: { sources: string[] };
  webWidget: {
    theme: string;
    accent: string;
    position: 'left' | 'right';
  };
};
