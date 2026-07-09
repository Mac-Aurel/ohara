import { pool } from '../db/index.js';
import { getEmbedding } from '../lib/embeddings.js';

async function fetchArticlesMissingEmbedding() {
  const { rows } = await pool.query(
    'SELECT id, title FROM articles WHERE embedding IS NULL',
  );
  return rows;
}

async function saveArticleEmbedding(articleId, embedding) {
  await pool.query(
    'UPDATE articles SET embedding = $1 WHERE id = $2',
    [`[${embedding.join(',')}]`, articleId],
  );
}

async function backfillArticle(article) {
  const embedding = await getEmbedding(article.title);
  await saveArticleEmbedding(article.id, embedding);
}

async function backfillMissingEmbeddings() {
  const articles = await fetchArticlesMissingEmbedding();
  console.log(`Found ${articles.length} article(s) without an embedding.`);

  let failures = 0;
  for (const article of articles) {
    try {
      await backfillArticle(article);
      console.log(`  ok    #${article.id} ${article.title}`);
    } catch (err) {
      failures += 1;
      console.error(`  fail  #${article.id} ${article.title} — ${err.message}`);
    }
  }

  console.log(`Backfill done: ${articles.length - failures} succeeded, ${failures} failed.`);
  return failures;
}

async function main() {
  let exitCode = 0;
  try {
    const failures = await backfillMissingEmbeddings();
    exitCode = failures > 0 ? 1 : 0;
  } catch (err) {
    console.error('Backfill aborted:', err.message);
    exitCode = 1;
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

main();
