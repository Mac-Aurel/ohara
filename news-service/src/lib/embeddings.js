// E5 models expect a "query: " prefix on every input, including for
// non-retrieval uses like clustering/classification (see model card).
export async function getEmbedding(text) {
  const response = await fetch(`${process.env.EMBEDDINGS_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'intfloat/multilingual-e5-small',
      input: `query: ${text}`
    })
  });

  const data = await response.json();

  return data.data[0].embedding;
}
