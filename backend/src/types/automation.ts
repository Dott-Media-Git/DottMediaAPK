export type SocialHandle = {
  platform: string;
  url?: string;
  username?: string;
};

export type ActivationPayload = {
  firebaseUid: string;
  company: {
    name: string;
    website?: string;
    size?: string;
  };
  contact: {
    name: string;
    email: string;
    phone?: string;
  };
  socials?: SocialHandle[];
};
