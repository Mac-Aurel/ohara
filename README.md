# Ohara

Ohara est un agrégateur d'actualités en microservices. Il scrape des flux RSS, résume les articles, vérifie les faits avec un LLM, fournit du contexte historique et des recommandations de lecture.

## Fonctionnalités

- Scraping de 4 sources RSS (BBC, Reuters, The Guardian, Le Monde)
- Résumé automatique des articles (sumy/LexRank)
- Fact-checking par IA avec verdict et analyse des claims (Gemini Flash)
- Contexte historique généré pour chaque article
- Recommandations de livres liés au sujet (Open Library)
- Clustering des articles par histoire (similarité Jaccard sur les titres)
- Interface React avec filtre par source et rafraîchissement automatique

## Stack technique

| Composant | Technologie |
|---|---|
| Frontend | React 18, Vite |
| API Gateway | Node.js, Express |
| News Service | Node.js, Express, PostgreSQL |
| Scraper | Python 3.11, FastAPI, feedparser |
| Summarizer | Python 3.11, FastAPI, sumy |
| Fact Checker | Python 3.11, FastAPI, Gemini Flash API |
| Base de données | PostgreSQL 16 |

## Prérequis

- Docker et Docker Compose v2
- Une clé API Gemini (gratuite sur [aistudio.google.com](https://aistudio.google.com))

## Installation

```bash
git clone https://github.com/Mac-Aurel/ohara.git
cd ohara
cp .env.example .env
# Ajouter GEMINI_API_KEY dans .env
make dev
```

Le frontend est accessible sur `http://localhost:3000`.

## Commandes

```bash
make dev        # Lance tout en arrière-plan et scrape au démarrage
make up         # Lance tout avec les logs en direct
make down       # Arrête tous les services
make scrape     # Lance un scraping manuel
make articles   # Affiche les articles en JSON
make test       # Vérifie que tous les services répondent
make logs       # Suit les logs en direct
```

## Architecture

```
Browser
  |
Frontend React (port 3000)
  |
API Gateway (port 8080)
  |-- /api/articles  --> news-service (5001) --> PostgreSQL
  |-- /api/scrape    --> scraper (5002)
  |                        |-- summarizer (5003)
  |                        |-- fact-checker (5004) --> Groq, Wikipedia, Open Library
  |-- /api/auth      --> auth-service (5005)        [à venir]
  |-- /api/debates   --> debate-service (5006)       [à venir]
```

## Configuration

Le projet lit les variables d'environnement depuis un fichier `.env` à la racine :

```
GEMINI_API_KEY=AIza...
```

## Sources RSS

Les sources sont définies dans `scraper/main.py` et peuvent être modifiées directement dans `RSS_SOURCES`.

## Déploiement

Pour un déploiement en production sans frais :

- Frontend: Vercel
- Backend: Oracle Cloud Free Tier (VM ARM, toujours gratuite)
- Base de données: Neon (PostgreSQL serverless gratuit)
- Scheduling: cron-job.org (POST vers `/api/scrape` toutes les 30 minutes)

Voir l'issue [#11](https://github.com/Mac-Aurel/ohara/issues/11) pour les étapes détaillées.

## Roadmap

- Migration Groq vers Gemini Flash (issue [#13](https://github.com/Mac-Aurel/ohara/issues/13))
- Auth utilisateurs avec JWT (issue [#4](https://github.com/Mac-Aurel/ohara/issues/4))
- Débats threadés sous chaque article (issue [#5](https://github.com/Mac-Aurel/ohara/issues/5))
- Déploiement cloud (issue [#11](https://github.com/Mac-Aurel/ohara/issues/11))
