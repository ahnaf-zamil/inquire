export interface CrawlJob {
  url: string;
  depth: number;
  source: 'seed' | 'link' | 'reindex';
  enqueuedAt: number;
}

export interface IndexedUrl {
  url: string;
  lastIndexed: number;
  firstIndexed: number;
}

export interface ExtractedContent {
  title: string;
  content: {
    h1: string[];
    h2: string[];
    h3: string[];
    h4: string[];
    h5: string[];
    h6: string[];
    paragraphs: string[];
    fullText: string;
  };
  metadata: {
    description?: string;
    keywords?: string[];
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
  };
  wordCount: number;
  contentHash: string;
}

export interface CrawlStats {
  totalCrawled: number;
  totalIndexed: number;
  totalFailed: number;
  totalSkipped: number;
  queueLength: number;
  reindexQueueLength: number;
  indexedUrlCount: number;
}

export interface PageDocument {
  url: string;
  domain: string;
  title: string;
  content: {
    h1: string[];
    h2: string[];
    h3: string[];
    h4: string[];
    h5: string[];
    h6: string[];
    paragraphs: string[];
    fullText: string;
  };
  metaDescription?: string;
  metaKeywords?: string[];
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  depth: number;
  contentType: 'static' | 'javascript';
  wordCount: number;
  language?: string;
  firstIndexed: number;
  lastIndexed: number;
  updatedAt: number;
  contentHash: string;
}