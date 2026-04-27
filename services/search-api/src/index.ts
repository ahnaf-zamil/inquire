import Fastify from 'fastify';
import { config } from 'dotenv';
import { searchRoutes } from './routes/search';
import { autocompleteRoutes } from './routes/autocomplete';
import { loadSynonyms } from './preprocessor/synonyms';

config();

const fastify = Fastify({
  logger: true
});

const PORT = parseInt(process.env.PORT || '3001');

fastify.get('/health', async () => {
  return { status: 'ok' };
});

fastify.register(searchRoutes);
fastify.register(autocompleteRoutes);

const start = async () => {
  try {
    console.log('Loading query preprocessor...');
    loadSynonyms();

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Search API running on http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();