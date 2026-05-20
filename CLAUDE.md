# Journalism — News Aggregator

## Conventions

- Ne jamais ajouter `Co-Authored-By: Claude` ou toute mention de Claude dans les messages de commit.

Agrégateur d'actualités en microservices : scraping de flux RSS → résumé automatique → stockage PostgreSQL → API REST → frontend React.

## Architecture

```
[Frontend React :3000]
        |
[API Gateway :8080]  ← proxy unique vers les services
   /api/articles  →  [news-service :5001]  →  [PostgreSQL]
   /api/scrape    →  [scraper :5002]       →  appelle news-service + summarizer
   /api/summarize →  [summarizer :5003]
```

| Service | Techno | Fichier principal |
|---|---|---|
| `postgres` | PostgreSQL 16 | — |
| `news-service` | Node.js 20 + Express + pg | `news-service/src/index.js` |
| `scraper` | Python 3.11 + FastAPI + feedparser | `scraper/main.py` |
| `summarizer` | Python 3.11 + FastAPI + sumy (LexRank) | `summarizer/main.py` |
| `api-gateway` | Node.js 20 + Express + http-proxy-middleware | `api-gateway/src/index.js` |
| `frontend` | React 18 + Vite | `frontend/src/App.jsx` |

## Lancer le projet

```bash
docker-compose up --build        # premier lancement
docker-compose up                # relances suivantes
```

Frontend accessible sur http://localhost:3000

Pour scraper manuellement :
```bash
curl -X POST http://localhost:8080/api/scrape
```

## Sources RSS configurées

`scraper/main.py` — `RSS_SOURCES` :

| Nom | URL |
|---|---|
| BBC | https://feeds.bbci.co.uk/news/world/rss.xml |
| Reuters | https://feeds.reuters.com/reuters/topNews |
| The Guardian | https://www.theguardian.com/world/rss |
| Le Monde | https://www.lemonde.fr/rss/une.xml |

## Etat actuel

### Fait
- [x] Tous les services scaffoldés et dockerisés
- [x] `docker-compose.yml` complet (réseaux, healthcheck Postgres, dépendances)
- [x] `news-service` : CRUD articles (GET list, GET by id, POST, DELETE) avec pagination et filtre `?source=`
- [x] `scraper` : scraping RSS multi-sources, appel au summarizer, sauvegarde dans news-service
- [x] `summarizer` : résumé extractif local via sumy/LexRank (2 phrases par défaut)
- [x] `api-gateway` : proxy avec logs morgan
- [x] `frontend` : liste des articles, bouton "Actualiser les sources", états loading/erreur/vide
- [x] Déduplication des articles par URL (`ON CONFLICT (url) DO UPDATE`)

### A faire
- [ ] **Scheduling automatique** du scraper (cron ou APScheduler dans le service) — aujourd'hui il faut cliquer sur le bouton
- [ ] **Tests** — aucun test unitaire ni d'intégration nulle part
- [ ] **Filtrage par source** dans le frontend (le backend supporte `?source=` mais l'UI ne l'expose pas)
- [ ] **Pagination** dans le frontend (le backend supporte `?page=&limit=` mais l'UI charge tout)
- [ ] **Gestion des erreurs Postgres** plus robuste côté news-service (retry, circuit breaker)
- [ ] **Auth** (pas d'authentification sur les endpoints DELETE notamment)
- [ ] **Variables d'environnement** externalisées dans un `.env` (mot de passe Postgres hardcodé dans docker-compose)

## Structure des fichiers

```
Journalism/
├── docker-compose.yml
├── CLAUDE.md
├── Journalism_Presentation.pptx
├── api-gateway/
│   ├── Dockerfile
│   ├── package.json
│   └── src/index.js
├── frontend/
│   ├── Dockerfile
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css
│       └── components/
│           ├── Header.jsx
│           ├── ArticleList.jsx
│           └── ArticleCard.jsx
├── news-service/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── routes/articles.js
│       └── db/index.js
├── scraper/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
└── summarizer/
    ├── Dockerfile
    ├── requirements.txt
    └── main.py
```

## Schema base de données

Table `articles` (créée automatiquement au démarrage de news-service) :

```sql
CREATE TABLE IF NOT EXISTS articles (
  id           SERIAL PRIMARY KEY,
  title        TEXT        NOT NULL,
  content      TEXT,
  summary      TEXT,
  url          TEXT        UNIQUE,
  source       TEXT,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```
