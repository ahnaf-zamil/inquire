import { Client } from '@elastic/elasticsearch';
import { config } from 'dotenv';
import readline from 'readline';

config();

const esClient = new Client({
  node: process.env.ES_HOST || 'http://localhost:9200',
  maxRetries: 3,
});

const ES_INDEX = process.env.ES_INDEX || 'crawled_pages';
const TEMP_INDEX = `${ES_INDEX}-mapped`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

const settings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  refresh_interval: '1s',
  analysis: {
    analyzer: {
      search_analyzer: {
        type: 'custom' as const,
        tokenizer: 'standard',
        filter: ['lowercase', 'stemmer', 'stop', 'my_synonym_graph', 'word_delimiter'],
      },
      autocomplete: {
        type: 'custom' as const,
        tokenizer: 'edge_ngram_tokenizer',
        filter: ['lowercase'],
      },
    },
    tokenizer: {
      edge_ngram_tokenizer: {
        type: 'edge_ngram' as const,
        min_gram: 2,
        max_gram: 10,
        token_chars: ['letter', 'digit'],
      },
    },
    filter: {
      stemmer: {
        type: 'stemmer' as const,
        language: 'english',
      },
      my_synonym_graph: {
        type: 'synonym_graph' as const,
        synonyms: [
          'js, javascript',
          'react, reactjs',
          'ts, typescript',
          'node, nodejs, node.js',
          'frontend, front-end, front end',
          'backend, back-end, back end',
          'css, styles, styling',
          'html, markup',
          'api, apis, endpoint, endpoints',
          'db, database, databases',
          'book, ebook, e-book, e book, books',
          'document, doc, docs',
          'video, videos, vid',
          'image, images, img, pic, pictures',
          'website, web site, web',
          'webpage, web page',
          'download, dl',
          'login, log in, signin, sign in',
          'logout, log out, signout, sign out',
          'search, find, lookup',
          'fix, patch, repair',
          'bug, issue, defect, error',
          'config, configuration, cfg',
          'deploy, deployment, release',
          'server, service, svc',
          'client, frontend',
          'python, py',
          'golang, go',
          'rust, rs',
          'java, jvm',
          'csharp, c#',
          'vue, vuejs',
          'angular, ng',
        ],
      },
      word_delimiter: {
        type: 'word_delimiter_graph' as const,
      },
    },
  },
};

const mappings = {
  properties: {
    url: { type: 'keyword' as const },
    domain: { type: 'keyword' as const },

    all_text: {
      type: 'text' as const,
      analyzer: 'search_analyzer',
      search_analyzer: 'search_analyzer',
      fields: {
        highlight: {
          type: 'text' as const,
          analyzer: 'standard',
        },
      },
    },

    title: {
      type: 'text' as const,
      analyzer: 'search_analyzer',
      copy_to: 'all_text',
      fields: { keyword: { type: 'keyword' as const } },
    },

    title_autocomplete: {
      type: 'text' as const,
      analyzer: 'autocomplete',
    },

    content: {
      properties: {
        h1: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
        h2: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
        h3: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
        h4: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
        h5: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
        h6: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
        paragraphs: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
        fullText: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
      },
    },

    metaDescription: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
    metaKeywords: { type: 'keyword' as const },
    ogTitle: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
    ogDescription: { type: 'text' as const, analyzer: 'search_analyzer', copy_to: 'all_text' },
    ogImage: { type: 'keyword' as const },

    depth: { type: 'integer' as const },
    contentType: { type: 'keyword' as const },
    wordCount: { type: 'integer' as const },
    language: { type: 'keyword' as const },

    firstIndexed: { type: 'date' as const },
    lastIndexed: { type: 'date' as const },
    updatedAt: { type: 'date' as const },

    contentHash: { type: 'keyword' as const },
  },
};

async function indexExists(index: string): Promise<boolean> {
  const exists = await esClient.indices.exists({ index });
  return Boolean(exists);
}

async function main(): Promise<void> {
  if (!(await indexExists(ES_INDEX))) {
    console.error(`Index "${ES_INDEX}" does not exist. Nothing to reindex.`);
    rl.close();
    process.exit(1);
  }

  const count = await esClient.count({ index: ES_INDEX });
  console.log(`\n⚠️  Reindexing "${ES_INDEX}" (${count.count} docs) into "${TEMP_INDEX}" with new mapping.\n`);

  const answer = await ask('Type "REINDEX" to confirm: ');
  if (answer.trim() !== 'REINDEX') {
    console.log('\n❌ Cancelled.\n');
    rl.close();
    return;
  }

  console.log('\n🗑️  Removing stale temp index...');
  try {
    await esClient.indices.delete({ index: TEMP_INDEX });
  } catch (e: any) {
    if (e.meta?.statusCode !== 404) throw e;
  }

  console.log('📦 Creating temp index with new mapping...');
  await esClient.indices.create({
    index: TEMP_INDEX,
    body: { settings, mappings } as any,
  });

  console.log('🔁 Reindexing documents...');
  const result = await esClient.reindex({
    wait_for_completion: true,
    body: {
      source: { index: ES_INDEX },
      dest: { index: TEMP_INDEX },
    },
  });
  console.log('   Reindexed', result.created, 'docs');

  console.log('🗑️  Deleting old index...');
  await esClient.indices.delete({ index: ES_INDEX });

  console.log('🔗 Creating index alias...');
  await esClient.indices.putAlias({
    index: TEMP_INDEX,
    name: ES_INDEX,
  });

  console.log('\n✅ Reindex complete!\n');
  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    rl.close();
    process.exit(1);
  });
