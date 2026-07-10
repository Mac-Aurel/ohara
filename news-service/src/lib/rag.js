export async function askNewsbook({ question, articleId, quotedComment }) {
  const response = await fetch(`${process.env.RAG_SERVICE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question,
      article_id: articleId,
      quoted_comment: quotedComment ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(`rag-service responded with HTTP ${response.status}`);
  }

  return response.json();
}
