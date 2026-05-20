COMPOSE = docker compose
API     = http://localhost:8080

.PHONY: up dev down build logs scrape articles test

up:
	$(COMPOSE) up --build

dev:
	$(COMPOSE) up --build -d
	@echo "Waiting for all services to be ready..."
	@until curl -sf $(API)/health > /dev/null 2>&1; do sleep 2; done
	@echo "Services ready. Scraping articles (this may take 1-2 min)..."
	@curl -s -X POST $(API)/api/scrape | python3 -m json.tool
	@echo "Done. Open http://localhost:3000"

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

scrape:
	curl -s -X POST $(API)/api/scrape | python3 -m json.tool

articles:
	curl -s $(API)/api/articles | python3 -m json.tool

test:
	@echo "\n--- Health checks ---"
	@curl -sf $(API)/health               && echo " api-gateway  OK" || echo " api-gateway  FAIL"
	@curl -sf http://localhost:5001/health && echo " news-service OK" || echo " news-service FAIL"
	@curl -sf http://localhost:5002/health && echo " scraper      OK" || echo " scraper      FAIL"
	@curl -sf http://localhost:5003/health && echo " summarizer   OK" || echo " summarizer   FAIL"
	@curl -sf http://localhost:5004/health && echo " fact-checker OK" || echo " fact-checker FAIL"
	@echo "\n--- Fact-checker direct test ---"
	@curl -s -X POST http://localhost:5004/analyze \
		-H "Content-Type: application/json" \
		-d '{"title":"Ukraine war latest","content":"Russian forces advanced near Kharkiv today.","summary":""}' \
		| python3 -m json.tool
