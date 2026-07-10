import { useEffect, useRef, useState } from 'react';

const DEBOUNCE_MS = 400;

export default function SearchBar({ onResults }) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const trimmed = query.trim();

    if (!trimmed) {
      onResults(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/rag/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        onResults({ query: trimmed, results: data.results ?? [], error: false });
      } catch {
        onResults({ query: trimmed, results: [], error: true });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [query, onResults]);

  return (
    <div className="search-wrap">
      <input
        type="text"
        className="search-input"
        placeholder="Rechercher"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </div>
  );
}
