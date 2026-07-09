export async function getEmbedding(text) {
  const response = await fetch(`${process.env.EMBEDDINGS_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'BAAI/bge-small-en-v1.5',
      input: text
    })
  });

  const data = await response.json();

  return data.data[0].embedding;
}
