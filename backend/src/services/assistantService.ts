import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openAI.apiKey });

type AssistantContext = {
  company?: string;
  currentScreen?: string;
  analytics?: {
    leads?: number;
    engagement?: number;
    conversions?: number;
    feedbackScore?: number;
  };
};

export class AssistantService {
  async answer(question: string, context: AssistantContext) {
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
