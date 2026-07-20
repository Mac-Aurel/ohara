# Ohara

Ohara est un agrégateur d'actualités construit en microservices. Il va chercher des flux RSS, résume les articles, vérifie les faits avec un LLM, ajoute du contexte historique appuyé sur Wikipedia et propose des recommandations de lecture. Le tout est servi par une interface React (typographie en majuscules, palette noir et blanc, cards épurées).

## Fonctionnalités

- Scraping de 4 sources RSS (BBC, Reuters, The Guardian, Le Monde), avec récupération automatique de l'image de l'article et du corps complet de la page
- Résumé automatique des articles (sumy/LexRank)
- Fact-checking par IA : verdict + analyse des claims (Groq / Llama 3.1)
- Contexte historique généré à partir de vraies sources Wikipedia, jamais inventé
- Recommandations de livres suggérées par le LLM puis enrichies via Open Library (année, lien)
- Clustering des articles par histoire grâce à des embeddings sémantiques, pour regrouper plusieurs sources qui couvrent le même événement
- Recherche sémantique et chat conversationnel sur le corpus d'articles (RAG)
- Authentification JWT (inscription, connexion, profil avec centres d'intérêt)
- Rafraîchissement automatique du flux toutes les 2h côté serveur, plus un bouton manuel pour forcer un scrape
- Débats threadés sous chaque article (réponses imbriquées, suppression de ses propres commentaires) ; mentionner `@newsbook` dans un message pose une question au RAG, scopée à l'article courant, et la réponse est postée automatiquement dans le fil avec ses sources
- Articles à enregistrer pour plus tard (bouton sur les cards et la page article, liste dédiée sur `/saved`)
- Filtre par catégorie multi-sélection sur le fil d'accueil

## Architecture

```
Navigateur
  │
Frontend React (Vite en dev, Nginx en prod, port 3000)
  │
API Gateway (port 8080), reverse proxy vers les services internes
  ├── /api/articles ──► news-service (5001) ──► PostgreSQL + pgvector
  ├── /api/scrape   ──► scraper (5002)
  │                        ├── summarizer (5003)      résumé local, LexRank
  │                        └── fact-checker (5004)
  │                                ├── Groq API        verdict, contexte, livres
  │                                ├── Wikipedia API    sources historiques
  │                                └── Open Library API métadonnées livres
  ├── /api/users  ──► news-service (5001)              register / login JWT
  ├── /api/comments ─► news-service (5001)              débats threadés, @newsbook
  └── /api/rag    ──► rag-service (5005)                recherche + chat
```

Chaque service tourne dans son propre conteneur Docker et communique avec les autres en HTTP interne, via le réseau `db_net` de Docker Compose. Le frontend, lui, ne parle jamais directement aux services internes : tout passe par l'API Gateway, qui fait juste du reverse proxy (aucune logique métier dedans).

## Comment chaque partie fonctionne

### scraper (Python, FastAPI)

Le scraper lit 4 flux RSS en parallèle avec `feedparser`, en prenant les 10 dernières entrées de chaque source. Avant de faire quoi que ce soit de coûteux, il demande à news-service quelles URLs existent déjà en base (`POST /articles/existing-urls`) et jette tout ce qui est déjà connu. C'est important : sans ce filtre, chaque scrape retraiterait les mêmes articles à chaque cycle, en repayant un résumé et un fact-check pour rien, et en écrasant au passage le fact-check déjà calculé.

Pour les articles vraiment nouveaux, le scraper va chercher la page complète de l'article (le flux RSS ne donne souvent qu'un teaser tronqué) et en extrait le corps avec `trafilatura`. Il en profite pour récupérer une image : d'abord dans le flux RSS lui-même (`media:thumbnail`, `media:content` ou une enclosure image, selon ce que la source expose), et si rien n'est trouvé, il retombe sur la balise `og:image` de la page HTML. Quand aucune des deux ne donne d'image, le frontend affiche à la place un bloc de couleur uni avec le nom de la catégorie, pour que chaque card ait toujours un visuel.

Les articles sont ensuite résumés (appel au summarizer), sauvegardés en base, puis regroupés par histoire. Le fact-check ne tourne qu'une fois par histoire, sur l'article le plus complet du groupe, et son résultat est propagé à tous les articles de cette histoire. Enfin, le scraper déclenche l'indexation RAG en tâche de fond (fire and forget).

Le scraper lui-même reste stateless : il n'a aucune notion de planification, il ne fait que répondre à `POST /scrape` quand on le lui demande. C'est volontaire, pour pouvoir un jour faire tourner plusieurs instances du scraper derrière un load balancer sans qu'elles se marchent dessus en se déclenchant chacune de leur côté.

### scheduler (conteneur curl, docker-compose)

Le déclenchement automatique du scrape ne vit pas dans le scraper, il vit dans un service à part qui ne fait qu'une chose : dormir, puis appeler `POST /api/scrape` via l'API Gateway, en boucle, toutes les 2h par défaut (`INTERVAL_SECONDS`). C'est l'équivalent local de ce que fera cron-job.org une fois le projet déployé publiquement (cron-job.org a besoin d'une URL joignable depuis internet, ce que `localhost` n'est pas). Le bouton manuel "Actualiser les sources" reste disponible dans le frontend en complément, pour forcer un scrape sans attendre le prochain cycle.

### summarizer (Python, FastAPI)

Le plus petit des services. Il prend du texte et en sort un résumé extractif avec l'algorithme LexRank (bibliothèque sumy), en local, sans appel LLM. Rapide et gratuit, mais ça ne fait que sélectionner les phrases les plus représentatives du texte, pas de la vraie génération.

### fact-checker (Python, FastAPI)

C'est ici que se passe l'essentiel du travail intelligent. Pour un article donné, le service commence par chercher des pages Wikipedia pertinentes à partir de mots-clés extraits du titre. Ces extraits Wikipedia sont ensuite injectés dans le prompt envoyé à Groq (modèle Llama 3.1), avec pour consigne explicite de ne s'appuyer que sur ces sources pour le contexte historique, pas d'inventer. Un seul appel LLM renvoie à la fois le verdict de fact-check (avec le détail des claims vérifiées), le contexte historique et une liste de recommandations de livres.

Les livres suggérés par le LLM sont ensuite passés à l'API Open Library pour récupérer de vraies métadonnées (année de publication, lien) plutôt que de faire confiance aveuglément à ce que le modèle a inventé.

### rag-service (Python, FastAPI)

Ce service gère la recherche sémantique et le chat. Quand un nouvel article est indexé, son contenu est découpé en morceaux d'environ 450 tokens (sans chevauchement, un choix qui n'a montré aucun bénéfice mesurable ici tout en coûtant plus cher à indexer), chaque morceau est transformé en embedding et stocké dans `article_chunks`.

La recherche combine deux méthodes de scoring qui se complètent : une recherche vectorielle (similarité cosinus sur les embeddings) et une recherche par mots-clés classique (`tsvector` Postgres), fusionnées avec du reciprocal rank fusion pour donner un score final. Le chat, lui, récupère les meilleurs extraits pour une question donnée puis demande à Groq de répondre en se basant uniquement sur ces extraits, en citant ses sources par numéro. S'il ne trouve rien de pertinent, il répond littéralement qu'il ne sait pas plutôt que d'improviser.

### news-service (Node.js, Express, PostgreSQL)

Le cœur de la persistance. Il expose les routes articles, utilisateurs, chunks et commentaires, et porte toute la logique de clustering par histoire : quand un article est sauvegardé, son titre + résumé sont transformés en embedding puis comparés au centroïde (la moyenne des embeddings) de chaque histoire déjà en base — pas au seul article le plus proche, pour éviter qu'une histoire dérive par chaînage (A rejoint B, C rejoint A, et se retrouve associé à B sans lien réel avec lui). Si la similarité avec le centroïde le plus proche dépasse 0.86, l'article rejoint ce `story_id`, sinon il en reçoit un nouveau. C'est ce qui permet d'afficher plusieurs sources qui couvrent la même actualité comme une seule histoire plutôt que comme des doublons.

Le fact-check d'une histoire n'est calculé qu'une fois, sur l'article le plus complet du groupe scrapé dans le même run, et propagé aux seuls autres articles de ce même run (pas à `WHERE story_id = X` en base) — pour qu'un mauvais rapprochement ne puisse pas écraser le fact-check d'un article ancien et sans rapport.

La catégorisation fonctionne sur un principe voisin : dix catégories fixes (Politics, World, Economics, Technology, Science, Health, Environment, Culture, Sports, Crime & Justice) sont pré-calculées en embeddings une seule fois via un script de seed, et chaque article se voit attribuer la catégorie la plus proche au moment de la lecture, par une jointure SQL plutôt qu'un traitement séparé.

L'authentification est un JWT classique signé côté serveur (bcrypt pour les mots de passe, expiration à 7 jours), sans session côté serveur : le token est décodé côté client pour en extraire le nom d'utilisateur.

Les débats vivent dans une table `comments` (`parent_id` auto-référencé, suppression en cascade), pas dans un micro-service séparé. Quand un message contient `@newsbook`, news-service extrait la question, va chercher le commentaire parent si le message est une réponse (pour donner au RAG l'affirmation à vérifier), puis appelle directement `rag-service` en HTTP interne (les deux services partagent le réseau `db_net`, pas besoin de repasser par l'API Gateway) et poste la réponse comme un nouveau commentaire, avec `author = "Newsbook"` et `is_bot = true`. Un échec de cet appel n'empêche jamais le commentaire de l'utilisateur d'être publié.

Les articles enregistrés vivent dans une table de jointure `saved_articles` (`username`, `article_id`) plutôt qu'un tableau JSON sur `articles` comme les likes, parce qu'il faut pouvoir lister efficacement "mes articles enregistrés" — un scan de toutes les lignes `articles` pour y chercher un JSON ne passerait pas à l'échelle.

### api-gateway (Node.js, Express)

Volontairement très simple : un reverse proxy (`http-proxy-middleware`) qui redirige `/api/articles`, `/api/users`, `/api/comments`, `/api/scrape`, `/api/summarize` et `/api/rag` vers le bon service interne, en réécrivant le chemin. Aucune logique métier ne doit vivre ici, c'est juste la porte d'entrée unique du frontend.

### frontend (React, Vite)

Le design suit de près celui de raiseurvoice : police Geist en majuscules espacées, palette noir/blanc/gris, cards sans fioritures. La page d'accueil a un hero centré, une barre de recherche autonome (soulignée, pas de bouton chatbot mélangé avec la recherche classique) et une grille uniforme de cards, avec un filtre de catégories en multi-sélection. La page d'un article affiche l'image en bandeau plein cadre tout en haut, collée au header, avec le titre et les métadonnées centrés en dessous.

La recherche sémantique et le chat conversationnel (RAG) sont volontairement séparés dans l'interface : la recherche vit dans sa propre barre sur la page d'accueil, le chat vit dans un widget flottant à part (`ChatWidget`), pour ne pas mélanger deux usages différents dans un seul composant à onglets.

L'authentification côté client passe par un contexte React (`AuthProvider`) qui garde le token JWT dans le `localStorage` et décode le payload pour en tirer le nom d'utilisateur, sans jamais interroger le serveur juste pour ça.

Le débat sous chaque article (`DebateThread`) reconstruit un arbre côté client à partir d'une liste plate renvoyée par l'API (`parent_id` par commentaire), avec un formulaire unique qui bascule en mode "réponse à" plutôt qu'un champ par commentaire. Les articles enregistrés ont leur propre page (`/saved`), accessible depuis le header une fois connecté.

## Stack technique

| Composant | Technologie |
|---|---|
| Frontend | React 18, Vite, React Router, Nginx en prod |
| API Gateway | Node.js, Express, http-proxy-middleware |
| News Service | Node.js, Express, PostgreSQL, pgvector |
| Scraper | Python 3.11, FastAPI, feedparser, trafilatura |
| Summarizer | Python 3.11, FastAPI, sumy/LexRank |
| Fact Checker | Python 3.11, FastAPI, Groq (Llama 3.1), Wikipedia API, Open Library |
| RAG Service | Python 3.11, FastAPI, tiktoken, Groq |
| Embeddings | intfloat/multilingual-e5-small, servi par Infinity |
| Base de données | PostgreSQL 16 + extension pgvector |
| Orchestration | Docker Compose v2 |

## Prérequis

- Docker et Docker Compose v2
- Une clé API Groq, gratuite sur [console.groq.com](https://console.groq.com)

## Installation

```bash
git clone https://github.com/Mac-Aurel/ohara.git
cd ohara
cp .env.example .env
# ajouter GROQ_API_KEY et JWT_SECRET dans .env
make dev
```

Le frontend est accessible sur `http://localhost:3000`.

## Commandes

Un seul `Makefile` à la racine, qui détecte l'OS et utilise PowerShell sous Windows ou curl/python3 ailleurs.

```bash
make dev        # build, démarre tout en arrière-plan et scrape au démarrage
make up         # build + démarre avec les logs en direct
make down       # arrête tous les services
make scrape     # lance un scraping manuel
make articles   # affiche les articles en JSON
make test       # health check de tous les services + test fact-checker direct
make logs       # suit les logs en direct
```

### Développement du frontend seul

Pour itérer sur le frontend sans reconstruire l'image Docker à chaque changement, on peut le lancer avec Vite directement pendant que le reste tourne en Docker :

```bash
cd frontend
npm install
npm run dev
```

Le serveur de dev écoute sur `http://localhost:5173` et proxy `/api` vers `http://localhost:8080` (voir `vite.config.js`), donc l'API Gateway doit tourner en parallèle.

## Configuration

```bash
# .env (ne jamais commiter)
GROQ_API_KEY=gsk_...            # https://console.groq.com
JWT_SECRET=...                  # openssl rand -hex 32
```

## Sources RSS

Définies dans `scraper/main.py` → `RSS_SOURCES` :

| Source | URL |
|---|---|
| BBC | https://feeds.bbci.co.uk/news/world/rss.xml |
| Reuters | https://feeds.reuters.com/reuters/topNews |
| The Guardian | https://www.theguardian.com/world/rss |
| Le Monde | https://www.lemonde.fr/rss/une.xml |

Le flux Reuters ne renvoie actuellement plus aucune entrée (`feedparser` retourne une liste vide). Ce n'est pas un bug côté Ohara, c'est le flux lui-même qui semble mort ou déplacé, il faudra trouver une URL de remplacement.

## Déploiement cloud (cible, sans frais)

Le plan initial de l'issue [#11](https://github.com/Mac-Aurel/ohara/issues/11) éclatait le déploiement sur trois
services (Vercel, Neon, cron-job.org). Écart par rapport à la spec : la VM ARM Oracle Cloud gratuite
(4 OCPU / 24 GB) suffit largement pour les sept services, donc tout tourne finalement sur une seule VM —
Postgres, scheduler et frontend inclus — plutôt que d'être éclaté.

| Composant | Rôle |
|---|---|
| VM Oracle Cloud ARM (Ampere A1, always free) | Tous les services (`docker-compose.yml` + `docker-compose.prod.yml`) |
| Caddy | Reverse proxy devant le frontend, HTTPS automatique (Let's Encrypt) via un domaine DuckDNS |
| `BIND_ADDR=127.0.0.1` | Verrouille les ports de chaque service à l'intérieur de la VM ; seul Caddy (80/443) est exposé |

Voir issue [#11](https://github.com/Mac-Aurel/ohara/issues/11) pour le détail. Pas encore fait, le projet tourne
pour l'instant uniquement en local — reste à provisionner la VM côté Oracle Cloud et pointer un sous-domaine
DuckDNS dessus.

## État d'avancement

| Feature | Issue | Statut |
|---|---|---|
| Auth utilisateurs JWT | [#4](https://github.com/Mac-Aurel/ohara/issues/4) | fait, fermée |
| Clustering par embeddings | [#15](https://github.com/Mac-Aurel/ohara/issues/15) | fait, fermée |
| Scraping automatique périodique | [#10](https://github.com/Mac-Aurel/ohara/issues/10) | fait, fermée — scheduler interne à `docker-compose.yml` plutôt que cron-job.org (qui a besoin d'une URL publique, prévu pour après #11) |
| Débats threadés par article + `@newsbook` | [#5](https://github.com/Mac-Aurel/ohara/issues/5) | fait, fermée — dans `news-service`, pas un service séparé |
| Frontend v2 (fact-check, contexte, auth, débats) | [#6](https://github.com/Mac-Aurel/ohara/issues/6) | fait, fermée |
| Articles enregistrés | — | fait, pas d'issue dédiée |
| Filtre catégories multi-sélection | — | fait, pas d'issue dédiée |
| Flux RSS Reuters mort | [#17](https://github.com/Mac-Aurel/ohara/issues/17) | à faire |
| Déploiement Oracle Cloud | [#11](https://github.com/Mac-Aurel/ohara/issues/11) | config single-VM prête (`docker-compose.prod.yml`, `make prod`), reste à provisionner la VM |
