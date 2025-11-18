import { OrgSettingsDocument } from '../../types/org';

export function validateSettingsPatch(updates: Partial<OrgSettingsDocument>) {
  const next: Record<string, unknown> = {};
  if (updates.features) {
    next['features'] = { ...updates.features };
  }
  if (updates.booking) {
    next['booking'] = {
      ...updates.booking,
      provider: updates.booking.provider ?? 'google',
    };
  }
  if (updates.knowledgeBase) next['knowledgeBase'] = updates.knowledgeBase;
  if (updates.webWidget) next['webWidget'] = updates.webWidget;
  if (updates.channels) next['channels'] = updates.channels;
  return next;
}
