# Ohara

Ohara est un agrégateur d'actualités en microservices. Il scrape des flux RSS, résume les articles, vérifie les faits avec un LLM, fournit du contexte historique ancré sur Wikipedia et des recommandations de lecture.

## Fonctionnalités

- Scraping de 4 sources RSS (BBC, Reuters, The Guardian, Le Monde)
- Résumé automatique des articles (sumy/LexRank)
- **Fact-checking par IA** : verdict + analyse des claims (Groq / Llama 3.1)
- **Contexte historique** : généré à partir de sources Wikipedia réelles
- **Recommandations de livres** : suggérées par le LLM, enrichies via Open Library (année, lien)
- Clustering des articles par histoire (similarité Jaccard sur les titres)
- Interface React avec badges de verdict, sections dépliables, filtre par source, rafraîchissement automatique

## Stack technique

| Composant | Technologie |
|---|---|
| Frontend | React 18, Vite, Nginx |
| API Gateway | Node.js, Express |
| News Service | Node.js, Express, PostgreSQL |
| Scraper | Python 3.11, FastAPI, feedparser |
| Summarizer | Python 3.11, FastAPI, sumy/LexRank |
| Fact Checker | Python 3.11, FastAPI, Groq (Llama 3.1), Wikipedia API, Open Library |
| Base de données | PostgreSQL 16 |
| Orchestration | Docker Compose v2 |

## Prérequis

- Docker et Docker Compose v2
- Une clé API Groq ([console.groq.com](https://console.groq.com))

## Installation

```bash
git clone https://github.com/Mac-Aurel/ohara.git
cd ohara
cp .env.example .env
# Ajouter GROQ_API_KEY dans .env
make dev
```

Le frontend est accessible sur `http://localhost:3000`.

## Commandes

```bash
make dev        # Build, démarre tout en arrière-plan et scrape au démarrage
make up         # Build + démarre avec les logs en direct
make down       # Arrête tous les services
make scrape     # Lance un scraping manuel
make articles   # Affiche les articles en JSON
make test       # Health check de tous les services + test fact-checker direct
make logs       # Suit les logs en direct
```

## Architecture

```
Browser
  │
Frontend React (port 3000, Nginx)
  │
API Gateway (port 8080)
  ├── /api/articles  ──► news-service (5001) ──► PostgreSQL
  ├── /api/scrape    ──► scraper (5002)
  │                         ├── summarizer (5003)          [local, LexRank]
  │                         └── fact-checker (5004)
  │                                 ├── Groq API           [verdict + contexte + livres]
  │                                 ├── Wikipedia API      [sources historiques]
  │                                 └── Open Library API   [métadonnées livres]
  ├── /api/users     ──► news-service (5001)               [register/login JWT]
  ├── /api/rag       ──► rag-service (5005)                [recherche + chat]
  └── /api/debates   ──► debate-service (5006)             [à venir]
```

### Pipeline de traitement par scrape

1. **Fetch RSS** — 4 sources en parallèle (`asyncio.gather`)
2. **Résumé** — tous les articles en parallèle (sumy local)
3. **Sauvegarde** — séquentielle (prévient la race condition sur le clustering story_id)
4. **Clustering** — regroupement par `story_id` (Jaccard ≥ 0.3), 1 représentant par story
5. **Fact-check** — 1 appel Groq par story (Wikipedia + LLM + Open Library en parallèle)

## Configuration

```bash
# .env (ne jamais commiter)
GROQ_API_KEY=gsk_...   # https://console.groq.com
```

## Sources RSS

Définies dans `scraper/main.py` → `RSS_SOURCES` :

| Source | URL |
|---|---|
| BBC | https://feeds.bbci.co.uk/news/world/rss.xml |
| Reuters | https://feeds.reuters.com/reuters/topNews |
| The Guardian | https://www.theguardian.com/world/rss |
| Le Monde | https://www.lemonde.fr/rss/une.xml |

## Déploiement cloud (cible, sans frais)

| Service | Rôle |
|---|---|
| Vercel | Frontend React (CDN global) |
| Oracle Cloud ARM | Backend Docker Compose (VM 4 OCPU / 24 GB, always free) |
| Neon | PostgreSQL serverless (500 MB, sans expiry) |
| cron-job.org | POST `/api/scrape` toutes les 30 min |

Voir issue [#11](https://github.com/Mac-Aurel/ohara/issues/11) pour les étapes détaillées.

## Roadmap

| Feature | Issue | Statut |
|---|---|---|
| Auth utilisateurs JWT | [#4](https://github.com/Mac-Aurel/ohara/issues/4) | ✅ fait |
| Débats threadés | [#5](https://github.com/Mac-Aurel/ohara/issues/5) | ⬜ à faire |
| Frontend v2 (débats + auth) | [#6](https://github.com/Mac-Aurel/ohara/issues/6) | 🔄 en cours |
| Scheduling cron-job.org | [#10](https://github.com/Mac-Aurel/ohara/issues/10) | ⬜ à faire |
| Déploiement Oracle Cloud | [#11](https://github.com/Mac-Aurel/ohara/issues/11) | ⬜ à faire |
