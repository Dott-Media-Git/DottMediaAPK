## Automation Knowledge Base

### Endpoints
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/knowledge` | List the latest resources |
| `POST` | `/api/knowledge/url` | Body: `{ url, tags? }` |
| `POST` | `/api/knowledge/document` | Body: `{ title, content, tags? }` |

All resources land in Firestore `/knowledge_base` with summaries + tags. During every conversation, `ConversationService` queries `KnowledgeBaseService.getRelevantSnippets` and injects the top snippets into the GPT system prompt so the agent answers with the company’s documentation.

### Admin Experience
On the mobile **Controls** screen → “Automation Knowledge Base” card:
1. Paste a URL (e.g., blog post, SOP) → backend fetches and summarises it.
2. Paste raw notes/transcripts → stored as “document” entries.

### AgentSetup
If you prefer code, call:
```js
const agent = initLeadAgent({ apiUrl, widgetSecret });
await agent.configure({ goal: 'Short follow-up', knowledgeUrl: 'https://...' });
```

### Limits
- URLs: first ~1200 characters stored.
- Documents: first ~2000 characters stored.
- Snippets are keyword-matched; adjust tags for better recall.
