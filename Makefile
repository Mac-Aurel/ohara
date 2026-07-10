COMPOSE = docker compose
API     = http://localhost:8080

.PHONY: up dev down build logs scrape articles test

up:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

ifeq ($(OS),Windows_NT)

dev:
	$(COMPOSE) up --build -d
	@echo "Waiting for api-gateway..."
	@powershell -NoProfile -Command "$$ready = $$false; while (-not $$ready) { try { Invoke-WebRequest -UseBasicParsing '$(API)/health' | Out-Null; $$ready = $$true } catch { Start-Sleep -Seconds 2 } }"
	@echo "Waiting for scraper..."
	@powershell -NoProfile -Command "$$ready = $$false; while (-not $$ready) { try { Invoke-WebRequest -UseBasicParsing 'http://localhost:5002/health' | Out-Null; $$ready = $$true } catch { Start-Sleep -Seconds 2 } }"
	@echo "All services ready. Scraping articles (this may take 1-2 min)..."
	@powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post '$(API)/api/scrape' | ConvertTo-Json -Depth 100 } catch { $$_.Exception.Message }"
	@echo "Done. Open http://localhost:3000"

scrape:
	@powershell -NoProfile -Command "Invoke-RestMethod -Method Post '$(API)/api/scrape' | ConvertTo-Json -Depth 100"

articles:
	@powershell -NoProfile -Command "Invoke-RestMethod '$(API)/api/articles' | ConvertTo-Json -Depth 100"

test:
	@echo "\n--- Health checks ---"
	@powershell -NoProfile -Command "$$ok = $$true; try { Invoke-WebRequest -UseBasicParsing '$(API)/health' | Out-Null } catch { $$ok = $$false }; if ($$ok) { Write-Host ' api-gateway  OK' } else { Write-Host ' api-gateway  FAIL' }"
	@powershell -NoProfile -Command "$$ok = $$true; try { Invoke-WebRequest -UseBasicParsing 'http://localhost:5001/health' | Out-Null } catch { $$ok = $$false }; if ($$ok) { Write-Host ' news-service OK' } else { Write-Host ' news-service FAIL' }"
	@powershell -NoProfile -Command "$$ok = $$true; try { Invoke-WebRequest -UseBasicParsing 'http://localhost:5002/health' | Out-Null } catch { $$ok = $$false }; if ($$ok) { Write-Host ' scraper      OK' } else { Write-Host ' scraper      FAIL' }"
	@powershell -NoProfile -Command "$$ok = $$true; try { Invoke-WebRequest -UseBasicParsing 'http://localhost:5003/health' | Out-Null } catch { $$ok = $$false }; if ($$ok) { Write-Host ' summarizer   OK' } else { Write-Host ' summarizer   FAIL' }"
	@powershell -NoProfile -Command "$$ok = $$true; try { Invoke-WebRequest -UseBasicParsing 'http://localhost:5004/health' | Out-Null } catch { $$ok = $$false }; if ($$ok) { Write-Host ' fact-checker OK' } else { Write-Host ' fact-checker FAIL' }"
	@echo "\n--- Fact-checker direct test ---"
	@powershell -NoProfile -Command "Invoke-RestMethod -Method Post 'http://localhost:5004/analyze' -ContentType 'application/json' -Body '{\"title\":\"Ukraine war latest\",\"content\":\"Russian forces advanced near Kharkiv today.\",\"summary\":\"\"}' | ConvertTo-Json -Depth 100"

else

dev:
	$(COMPOSE) up --build -d
	@echo "Waiting for api-gateway..."
	@until curl -sf $(API)/health > /dev/null 2>&1; do sleep 2; done
	@echo "Waiting for scraper..."
	@until curl -sf http://localhost:5002/health > /dev/null 2>&1; do sleep 2; done
	@echo "All services ready. Scraping articles (this may take 1-2 min)..."
	@curl -s -X POST $(API)/api/scrape | python3 -m json.tool || true
	@echo "Done. Open http://localhost:3000"

scrape:
	@curl -s -X POST $(API)/api/scrape | python3 -m json.tool

articles:
	@curl -s $(API)/api/articles | python3 -m json.tool

test:
	@printf "\n--- Health checks ---\n"
	@curl -sf $(API)/health                && echo " api-gateway  OK" || echo " api-gateway  FAIL"
	@curl -sf http://localhost:5001/health && echo " news-service OK" || echo " news-service FAIL"
	@curl -sf http://localhost:5002/health && echo " scraper      OK" || echo " scraper      FAIL"
	@curl -sf http://localhost:5003/health && echo " summarizer   OK" || echo " summarizer   FAIL"
	@curl -sf http://localhost:5004/health && echo " fact-checker OK" || echo " fact-checker FAIL"
	@printf "\n--- Fact-checker direct test ---\n"
	@curl -s -X POST http://localhost:5004/analyze \
		-H "Content-Type: application/json" \
		-d '{"title":"Ukraine war latest","content":"Russian forces advanced near Kharkiv today.","summary":""}' \
		| python3 -m json.tool

endif
