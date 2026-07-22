import { pool } from '../db/index.js';
import { getEmbedding } from '../lib/embeddings.js';
import { CATEGORIES } from '../lib/categories.js';

async function replaceCategories(categories) {
  await pool.query('TRUNCATE TABLE categories');
  for (const category of categories) {
    const embedding = await getEmbedding(category);
    await pool.query(
      'INSERT INTO categories (category, embedding) VALUES ($1, $2)',
      [category, `[${embedding.join(',')}]`],
    );
    console.log(`  ok  ${category}`);
  }
}

async function main() {
  let exitCode = 0;
  try {
    console.log(`Seeding ${CATEGORIES.length} fixed categories...`);
    await replaceCategories(CATEGORIES);
    console.log('Seed complete.');
  } catch (err) {
    console.error('Seed failed:', err.message);
    exitCode = 1;
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

main();
