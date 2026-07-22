export const CATEGORIES = [
  'Politics',
  'World',
  'Economics',
  'Technology',
  'Science',
  'Health',
  'Environment',
  'Culture',
  'Sports',
  'Crime & Justice',
];

// Max cosine distance (article embedding <=> category embedding) accepted
// as a real match. Above this, an article is treated as uncategorized
// rather than forced into the closest (but unrelated) label.
export const CATEGORY_THRESHOLD = 0.6;
