import { adminFetch } from './base';

export type ComplianceIssue = {
  account: string;
  userId: string;
  channel: 'feed' | 'stories' | 'reels' | 'news' | string;
  severity: 'warning' | 'critical' | string;
  reason: string;
  intervalHours: number;
  lastRunAt: string | null;
  nextRun: string | null;
  minutesLate: number;
  action: string;
};

export type ComplianceReport = {
  id: string;
  label?: string | null;
  issues: ComplianceIssue[];
  issueCount: number;
  remediated: number;
  emailed: boolean;
  dueResult?: unknown;
  createdAt: string | null;
};

export type ComplianceState = {
  lastCheckAt: string | null;
  lastAlertAt: string | null;
  lastIssueCount: number;
  lastRemediatedCount: number;
};

export type ComplianceReportsPayload = {
  reports: ComplianceReport[];
  state: ComplianceState;
};

export const fetchComplianceReports = async (limit = 20): Promise<ComplianceReportsPayload> => {
  const payload = await adminFetch(`/admin/compliance/reports?limit=${encodeURIComponent(String(limit))}`);
  return {
    reports: Array.isArray(payload.reports) ? payload.reports : [],
    state: payload.state ?? {
      lastCheckAt: null,
      lastAlertAt: null,
      lastIssueCount: 0,
      lastRemediatedCount: 0,
    },
  };
};

export const runComplianceCheck = async () => {
  const payload = await adminFetch('/admin/compliance/run', { method: 'POST', body: '{}' });
  return payload.result;
};

export const runGlobalAutomationNow = async () => {
  return adminFetch('/admin/global-run', { method: 'POST', body: '{}' });
};

export const runComplianceIssueNow = async (issue: Pick<ComplianceIssue, 'userId' | 'channel'>) => {
  return adminFetch('/admin/compliance/run-issue', {
    method: 'POST',
    body: JSON.stringify({ userId: issue.userId, channel: issue.channel }),
  });
};
