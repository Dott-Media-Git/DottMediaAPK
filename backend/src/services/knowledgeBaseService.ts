import axios from 'axios';
import { load } from 'cheerio';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { extractKeywords } from '../utils/nlp';
import { helpDocIndex } from './helpDocsIndex';

export type KnowledgeResource = {
  id: string;
  type: 'url' | 'document';
  title: string;
  url?: string;
  summary: string;
  tags: string[];
  createdAt: admin.firestore.Timestamp;
};

type KnowledgeSnippetSource = {
  title: string;
  summary: string;
  url?: string;
  tags?: string[];
};

const knowledgeCollection = firestore.collection('knowledge_base');

const cleanText = (html: string) => {
  const $ = load(html);
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return text;
};

export class KnowledgeBaseService {
  async addUrlResource({ url, tags }: { url: string; tags?: string[] }) {
    const response = await axios.get(url);
    const text = cleanText(response.data);
    const summary = text.slice(0, 1200);
    const titleMatch = response.data.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || url;
    const docRef = knowledgeCollection.doc();
    const resource: KnowledgeResource = {
      id: docRef.id,
      type: 'url',
      title,
      url,
      summary,
      tags: tags ?? extractKeywords(`${title} ${summary}`, 8),
      createdAt: admin.firestore.Timestamp.now(),
    };
    await docRef.set(resource);
    return resource;
  }

  async addDocumentResource({
    title,
    content,
    tags,
  }: {
    title: string;
    content: string;
    tags?: string[];
  }) {
    const summary = content.slice(0, 2000);
    const docRef = knowledgeCollection.doc();
    const resource: KnowledgeResource = {
      id: docRef.id,
      type: 'document',
      title,
      summary,
      tags: tags ?? extractKeywords(`${title} ${summary}`, 8),
      createdAt: admin.firestore.Timestamp.now(),
    };
    await docRef.set(resource);
    return resource;
  }

  async listResources(limit = 25): Promise<KnowledgeResource[]> {
    const snapshot = await knowledgeCollection.orderBy('createdAt', 'desc').limit(limit).get();
    return snapshot.docs.map(doc => doc.data() as KnowledgeResource);
  }

  async getRelevantSnippets(query: string, limit = 3): Promise<Array<{ title: string; summary: string; url?: string }>> {
    const snapshot = await knowledgeCollection.orderBy('createdAt', 'desc').limit(75).get();
    const cleanQuery = query.toLowerCase();
    const keywords = extractKeywords(cleanQuery, 6);
    const firestoreResources: KnowledgeSnippetSource[] = snapshot.docs.map(doc => {
      const resource = doc.data() as KnowledgeResource;
      return {
        title: resource.title,
        summary: resource.summary,
        url: resource.url,
        tags: resource.tags ?? [],
      };
    });
    const helpResources: KnowledgeSnippetSource[] = helpDocIndex.map(doc => ({
      title: doc.title,
      summary: doc.summary,
      url: doc.url,
      tags: doc.tags,
    }));
    const resources = [...firestoreResources, ...helpResources];
    const scored = resources
      .map(resource => {
        const tags = resource.tags ?? [];
        const haystack = `${resource.title} ${resource.summary} ${tags.join(' ')}`.toLowerCase();
        const score =
          keywords.reduce((acc, keyword) => (haystack.includes(keyword) ? acc + 2 : acc), 0) + (haystack.includes(cleanQuery) ? 4 : 0);
        return { resource, score };
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => ({
        title: entry.resource.title,
        summary: entry.resource.summary.slice(0, 600),
        url: entry.resource.url,
      }));
    return scored;
  }
}
