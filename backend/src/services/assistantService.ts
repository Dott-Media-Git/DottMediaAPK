import OpenAI from 'openai';
import { config } from '../config';
import { AnalyticsService } from './analyticsService';

const openai = new OpenAI({ apiKey: config.openAI.apiKey });
const analyticsService = new AnalyticsService();

type AssistantContext = {
  userId?: string;
  company?: string;
  currentScreen?: string;
  subscriptionStatus?: string;
  connectedChannels?: string[];
  analytics?: {
    leads?: number;
    engagement?: number;
    conversions?: number;
    feedbackScore?: number;
  };
};

export class AssistantService {
  private shouldProvideWeeklySummary(question: string) {
    const normalized = question.toLowerCase();
    const weekMention = /\b(week|weekly|this week|last week)\b/.test(normalized);
    const metricMention = /\b(performance|summary|stats|kpi|metrics|engagement|leads|conversions)\b/.test(normalized);
    return weekMention && metricMention;
  }

  private computeAverage(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private formatDelta(label: string, current: number, previous: number, unit: string) {
    const diff = current - previous;
    const absDiff = Math.abs(diff);
    const roundedCurrent = Number.isInteger(current) ? current : Number(current.toFixed(1));
    const formattedCurrent = unit ? `${roundedCurrent}${unit}` : `${roundedCurrent}`;
    if (previous === 0) {
      if (current === 0) {
        return `${label} flat at ${formattedCurrent}`;
      }
      return `${label} up from 0 to ${formattedCurrent}`;
    }
    if (diff > 0) {
      return `${label} up ${Number(absDiff.toFixed(1))}${unit} (now ${formattedCurrent})`;
    }
    if (diff < 0) {
      return `${label} down ${Number(absDiff.toFixed(1))}${unit} (now ${formattedCurrent})`;
    }
    return `${label} flat at ${formattedCurrent}`;
  }

  private async buildWeeklySummary(userId: string) {
    const summary = await analyticsService.getSummary(userId);
    const history = Array.isArray(summary.history) ? summary.history : [];
    if (!history.length) {
      return "I don't have live analytics yet. Once activity starts, I'll summarize weekly performance here.";
    }

    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const last7 = sorted.slice(-7);
    const prev7 = sorted.slice(-14, -7);

    const current = {
      leads: Math.round(last7.reduce((sum, day) => sum + day.leads, 0)),
      engagement: Number(this.computeAverage(last7.map(day => day.engagement)).toFixed(1)),
      conversions: Math.round(last7.reduce((sum, day) => sum + day.conversions, 0)),
    };

    if (!prev7.length) {
      return `This week so far: engagement ${current.engagement}%, leads ${current.leads}, conversions ${current.conversions}. I need at least one full prior week to compare trends.`;
    }

    const previous = {
      leads: Math.round(prev7.reduce((sum, day) => sum + day.leads, 0)),
      engagement: Number(this.computeAverage(prev7.map(day => day.engagement)).toFixed(1)),
      conversions: Math.round(prev7.reduce((sum, day) => sum + day.conversions, 0)),
    };

    const engagementLine = this.formatDelta('Engagement', current.engagement, previous.engagement, '%');
    const leadsLine = this.formatDelta('Leads', current.leads, previous.leads, '');
    const conversionsLine = this.formatDelta('Conversions', current.conversions, previous.conversions, '');
    return `Weekly performance: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`;
  }

  async answer(question: string, context: AssistantContext) {
    if (context.userId && this.shouldProvideWeeklySummary(question)) {
      try {
        return { type: 'text', text: await this.buildWeeklySummary(context.userId) };
      } catch (error) {
        console.error('Weekly summary failed', error);
      }
    }

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'navigate',
          description: 'Navigate the user to a specific screen in the app',
          parameters: {
            type: 'object',
            properties: {
              screen: {
                type: 'string',
                enum: [
                  'Dashboard',
                  'BotAnalytics',
                  'CreateContent',
                  'SchedulePost',
                  'PostingHistory',
                  'Inbound',
                  'Engagement',
                  'FollowUps',
                  'WebLeads',
                  'AccountIntegrations',
                  'Controls',
                  'Support',
                  'Admin',
                ],
                description: 'The name of the screen to navigate to',
              },
            },
            required: ['screen'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_insights',
          description: 'Get specific analytical insights about performance',
          parameters: {
            type: 'object',
            properties: {
              metric: {
                type: 'string',
                enum: ['leads', 'engagement', 'conversions', 'feedback'],
                description: 'The metric to analyze',
              },
            },
            required: ['metric'],
          },
        },
      },
    ];

    const systemPrompt = [
      'You are Dotti, an AI sales agent and assistant inside the Dott Media CRM mobile app.',
      'Your goal is to help the user manage their marketing automation, analyze data, and navigate the app.',
      'You have access to tools to control the app. Use them when the user asks to go somewhere or needs specific data.',
      'Keep answers conversational, professional, and concise (under 3 sentences unless detailed analysis is asked).',
      context.company ? `User Company: ${context.company}` : '',
      context.currentScreen ? `User is currently viewing: ${context.currentScreen}` : '',
      context.subscriptionStatus ? `Subscription status: ${context.subscriptionStatus}` : '',
      context.connectedChannels?.length ? `Connected channels: ${context.connectedChannels.join(', ')}` : 'Connected channels: none listed',
      context.analytics
        ? `Current Snapshot: Leads=${context.analytics.leads ?? 'n/a'}, Engagement=${context.analytics.engagement ?? 'n/a'}%, Conversions=${context.analytics.conversions ?? 'n/a'}, Feedback=${context.analytics.feedbackScore ?? 'n/a'}/5`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 300,
      });

      const message = completion.choices[0].message;

      // If the model wants to call a tool, return a structured response for the frontend to handle
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        if (toolCall.type === 'function' && toolCall.function?.name) {
          let params: unknown = {};
          try {
            params = JSON.parse(toolCall.function.arguments || '{}');
          } catch (parseError) {
            console.error('Failed to parse tool arguments', parseError);
          }

          if (toolCall.function.name === 'get_insights' && context.userId) {
            return { type: 'text', text: await this.buildWeeklySummary(context.userId) };
          }

          return {
            type: 'action',
            action: toolCall.function.name,
            params,
            text: "I'm taking care of that for you.",
          };
        }
      }

      return {
        type: 'text',
        text: message.content || "I'm not sure how to help with that, but I'm learning!",
      };
    } catch (error) {
      console.error('OpenAI Error:', error);
      return {
        type: 'text',
        text: 'I encountered a temporary issue connecting to my brain. Please try again shortly.',
      };
    }
  }
}
