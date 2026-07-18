import admin from 'firebase-admin';
import axios from 'axios';
import createHttpError from 'http-errors';
import { firestore } from '../db/firestore.js';
import { metaAdsService } from './metaAdsService.js';
import { getSecret, putSecret } from './secretVaultService.js';

const MCP_URL = 'https://mcp.facebook.com/ads';
const policies = firestore.collection('metaAdsPolicies');
const approvals = firestore.collection('metaAdsApprovals');
const audits = firestore.collection('metaAdsAudit');
const connections = firestore.collection('metaAdsMcpConnections');

export type MetaAdsAction = 'create_campaign_draft' | 'activate_ad' | 'pause_ad' | 'update_budget' | 'mcp_tool';

export type MetaAdsPolicy = {
  dailySpendLimitUsd: number;
  perActionLimitUsd: number;
  requireApproval: boolean;
  allowActivation: boolean;
  allowBudgetChanges: boolean;
};

const defaultPolicy: MetaAdsPolicy = {
  dailySpendLimitUsd: 100,
  perActionLimitUsd: 25,
  requireApproval: true,
  allowActivation: false,
  allowBudgetChanges: true,
};

const timestampToIso = (value: any) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return null;
};

const serialize = (doc: FirebaseFirestore.DocumentSnapshot) => {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    ...data,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    decidedAt: timestampToIso(data.decidedAt),
  };
};

const audit = async (userId: string, action: string, status: string, details: Record<string, unknown> = {}) => {
  await audits.add({
    userId,
    action,
    status,
    details,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

const callMcp = async (accessToken: string, method: string, params: Record<string, unknown> = {}) => {
  const response = await axios.post(
    MCP_URL,
    { jsonrpc: '2.0', id: Date.now(), method, params },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  );
  return response.data;
};

const getConnection = async (userId: string) => {
  const snap = await connections.doc(userId).get();
  const connection = snap.exists ? snap.data() ?? {} : {};
  const secret = await getSecret(userId, 'meta_ads_mcp_token', { decrypt: true }).catch(() => null);
  return { ...connection, accessToken: (secret as { value?: string } | null)?.value ?? '' };
};

const executeAction = async (userId: string, action: MetaAdsAction, payload: Record<string, any>) => {
  const connection = await getConnection(userId);
  const mcpAccessToken = String(connection.accessToken ?? '').trim();
  if (mcpAccessToken && payload.mcpTool) {
    try {
      const result = await callMcp(mcpAccessToken, 'tools/call', {
        name: payload.mcpTool,
        arguments: payload.mcpArguments ?? payload,
      });
      return { provider: 'meta_mcp', result };
    } catch (error) {
      console.warn('[meta-ads-mcp] tool call failed; using Graph fallback', error instanceof Error ? error.message : String(error));
    }
  }
  if (action === 'mcp_tool') throw createHttpError(400, 'Meta Ads MCP authorization is required for this tool');

  if (action === 'create_campaign_draft') {
    const run = await metaAdsService.boostPublishedPost({
      userId,
      platform: String(payload.platform ?? 'facebook'),
      postId: String(payload.postId ?? ''),
      caption: String(payload.caption ?? ''),
      imageUrl: payload.imageUrl ? String(payload.imageUrl) : undefined,
      adAccountId: payload.adAccountId ? String(payload.adAccountId) : undefined,
      dailyBudgetUsd: Number(payload.dailyBudgetUsd ?? 5),
      durationHours: Number(payload.durationHours ?? 24),
      whatsappNumber: payload.whatsappNumber ? String(payload.whatsappNumber) : undefined,
    });
    return { provider: 'meta_graph', result: run };
  }
  if (action === 'activate_ad' || action === 'pause_ad') {
    const result = await metaAdsService.updateAdStatus(
      userId,
      String(payload.adId ?? ''),
      action === 'activate_ad' ? 'ACTIVE' : 'PAUSED',
    );
    return { provider: 'meta_graph', result };
  }
  if (action === 'update_budget') {
    const result = await metaAdsService.updateAdSetDailyBudget(
      userId,
      String(payload.adSetId ?? ''),
      Number(payload.dailyBudgetUsd),
    );
    return { provider: 'meta_graph', result };
  }
  throw createHttpError(400, 'Unsupported Meta Ads action');
};

export const metaAdsControlService = {
  async listMcpTools(userId: string) {
    const connection = await getConnection(userId);
    const accessToken = String(connection.accessToken ?? '').trim();
    if (!accessToken) return { connected: false, tools: [], message: 'Meta Ads MCP authorization is required' };
    const payload = await callMcp(accessToken, 'tools/list');
    const tools = payload?.result?.tools ?? payload?.tools ?? [];
    return { connected: true, tools };
  },
  async getConnectionStatus(userId: string) {
    const [connection, accounts] = await Promise.all([
      getConnection(userId),
      metaAdsService.listAdAccounts(userId).catch(() => []),
    ]);
    const mcpAccessToken = String(connection.accessToken ?? '').trim();
    let mcpConnected = false;
    let mcpError: string | null = null;
    if (mcpAccessToken) {
      try {
        await callMcp(mcpAccessToken, 'tools/list');
        mcpConnected = true;
      } catch (error) {
        mcpError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      endpoint: MCP_URL,
      mcpConnected,
      mcpError,
      graphConnected: accounts.length > 0,
      accountCount: accounts.length,
      selectedAdAccountId: connection.selectedAdAccountId ?? null,
      provider: mcpConnected ? 'meta_mcp' : accounts.length ? 'meta_graph' : 'none',
    };
  },

  async saveConnection(userId: string, input: { accessToken?: string; selectedAdAccountId?: string }) {
    const update: Record<string, unknown> = {
      selectedAdAccountId: input.selectedAdAccountId ? String(input.selectedAdAccountId) : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (input.accessToken?.trim()) await putSecret(userId, 'meta_ads_mcp_token', input.accessToken.trim());
    await connections.doc(userId).set(update, { merge: true });
    await audit(userId, 'mcp_connection_updated', 'success', { selectedAdAccountId: update.selectedAdAccountId });
    return this.getConnectionStatus(userId);
  },

  async getPolicy(userId: string): Promise<MetaAdsPolicy> {
    const snap = await policies.doc(userId).get();
    return { ...defaultPolicy, ...(snap.exists ? snap.data() : {}) } as MetaAdsPolicy;
  },

  async savePolicy(userId: string, input: Partial<MetaAdsPolicy>) {
    const current = await this.getPolicy(userId);
    const policy: MetaAdsPolicy = {
      dailySpendLimitUsd: Math.max(1, Number(input.dailySpendLimitUsd ?? current.dailySpendLimitUsd)),
      perActionLimitUsd: Math.max(1, Number(input.perActionLimitUsd ?? current.perActionLimitUsd)),
      requireApproval: input.requireApproval ?? current.requireApproval,
      allowActivation: input.allowActivation ?? current.allowActivation,
      allowBudgetChanges: input.allowBudgetChanges ?? current.allowBudgetChanges,
    };
    if (policy.perActionLimitUsd > policy.dailySpendLimitUsd) {
      throw createHttpError(400, 'Per-action limit cannot exceed the daily spending limit');
    }
    await policies.doc(userId).set({ ...policy, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await audit(userId, 'policy_updated', 'success', policy as unknown as Record<string, unknown>);
    return policy;
  },

  async requestAction(userId: string, action: MetaAdsAction, payload: Record<string, any>, source = 'dotti') {
    const policy = await this.getPolicy(userId);
    const budget = Number(payload.dailyBudgetUsd ?? 0);
    if (budget > policy.perActionLimitUsd || budget > policy.dailySpendLimitUsd) {
      throw createHttpError(400, `Requested budget exceeds the configured $${policy.perActionLimitUsd} action limit`);
    }
    if (action === 'activate_ad' && !policy.allowActivation) {
      throw createHttpError(403, 'Ad activation is disabled in Meta Ads safety controls');
    }
    if (action === 'update_budget' && !policy.allowBudgetChanges) {
      throw createHttpError(403, 'Budget changes are disabled in Meta Ads safety controls');
    }
    if (!policy.requireApproval) {
      const execution = await executeAction(userId, action, payload);
      const ref = approvals.doc();
      const completed = {
        userId,
        action,
        payload,
        source,
        status: 'completed',
        execution,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(completed);
      await audit(userId, action, 'completed', { approvalId: ref.id, source, provider: execution.provider });
      return { id: ref.id, ...completed, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    const ref = approvals.doc();
    const record = {
      userId,
      action,
      payload,
      source,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(record);
    await audit(userId, action, 'pending_approval', { approvalId: ref.id, source, payload });
    return { id: ref.id, ...record, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  },

  async decideApproval(userId: string, approvalId: string, decision: 'approve' | 'reject') {
    const ref = approvals.doc(approvalId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.userId !== userId) throw createHttpError(404, 'Approval request not found');
    const record = snap.data() as { action: MetaAdsAction; payload: Record<string, any>; status: string };
    if (record.status !== 'pending') throw createHttpError(409, 'Approval request has already been decided');
    if (decision === 'reject') {
      await ref.set({ status: 'rejected', decidedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await audit(userId, record.action, 'rejected', { approvalId });
      return { id: approvalId, status: 'rejected' };
    }
    try {
      const execution = await executeAction(userId, record.action, record.payload);
      await ref.set({ status: 'completed', execution, decidedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await audit(userId, record.action, 'completed', { approvalId, provider: execution.provider, result: execution.result });
      return { id: approvalId, status: 'completed', execution };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ref.set({ status: 'failed', errorMessage: message, decidedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await audit(userId, record.action, 'failed', { approvalId, error: message });
      throw error;
    }
  },

  async listApprovals(userId: string, limit = 30) {
    const snap = await approvals.where('userId', '==', userId).limit(Math.min(Math.max(limit, 1), 100)).get();
    return snap.docs.map(serialize).sort((a: any, b: any) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  },

  async listAudit(userId: string, limit = 50) {
    const snap = await audits.where('userId', '==', userId).limit(Math.min(Math.max(limit, 1), 100)).get();
    return snap.docs.map(serialize).sort((a: any, b: any) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  },

  async reportingSummary(userId: string) {
    const performance = await metaAdsService.getPerformance(userId, 25);
    const { summary, currency } = performance;
    return {
      performance,
      text: `Meta Ads (${performance.lookbackDays} days): ${currency} ${summary.spend.toFixed(2)} spent, ${summary.impressions} impressions, ${summary.clicks} clicks, ${summary.leads} leads, ${summary.messages} messages, and ${summary.ctr.toFixed(2)}% CTR. ${summary.active} active, ${summary.paused} paused, ${summary.failed} needing attention.`,
    };
  },
};
