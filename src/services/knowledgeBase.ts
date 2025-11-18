const buildUrl = (path: string) => {
  const base = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL;
  if (!base) throw new Error('Missing API URL for knowledge base');
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
};

const defaultHeaders = {
  'Content-Type': 'application/json'
};

export const listKnowledge = async () => {
  const response = await fetch(buildUrl('/api/knowledge'));
  if (!response.ok) {
    throw new Error('Failed to load knowledge base');
  }
  return response.json();
};

export const addKnowledgeUrl = async (url: string, tags?: string[]) => {
  const response = await fetch(buildUrl('/api/knowledge/url'), {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ url, tags })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? 'Failed to save URL');
  }
  return response.json();
};

export const addKnowledgeDocument = async (title: string, content: string, tags?: string[]) => {
  const response = await fetch(buildUrl('/api/knowledge/document'), {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ title, content, tags })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? 'Failed to save document');
  }
  return response.json();
};
