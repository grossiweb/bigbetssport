# Big Ball Sports — developer Makefile
# Works on Linux, macOS, and Windows (via Git Bash / WSL).

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose -f infra/docker-compose.yml
PG_EXEC := $(COMPOSE) exec -T postgres psql -U bbs -d bbs
MIGRATION_DIR := infra/postgres/migrations

.PHONY: help dev down logs ps migrate seed test lint build clean reset platform-dev platform-build platform-start

help:
	@echo "Big Ball Sports — available targets:"
	@echo "  make dev       — start Docker stack (postgres, redis, prometheus, grafana)"
	@echo "  make down      — stop Docker stack"
	@echo "  make logs      — tail logs from all services"
	@echo "  make ps        — list running services"
	@echo "  make migrate   — apply all SQL migrations in order"
	@echo "  make seed      — seed sports & leagues (idempotent)"
	@echo "  make test      — run test suites across all packages"
	@echo "  make lint      — lint all packages"
	@echo "  make build     — type-check / build all packages"
	@echo "  make clean     — remove build artefacts and node_modules"
	@echo "  make reset     — DESTROY docker volumes and rebuild (interactive)"

dev:
	$(COMPOSE) --profile dev up -d
	@echo ""
	@echo "Services starting. Wait ~10s, then:"
	@echo "  make migrate   # apply schema"
	@echo "  make seed      # insert sports & leagues"

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

migrate:
	@echo "Applying migrations from $(MIGRATION_DIR)..."
	@for f in $$(ls $(MIGRATION_DIR)/*.sql | sort); do \
		echo "  → $$f"; \
		$(PG_EXEC) < $$f || exit 1; \
	done
	@echo "Migrations applied."

seed:
	pnpm --filter @bbs/shared exec tsx scripts/seed-sports.ts

test:
	pnpm -r test

lint:
	pnpm -r lint

build:
	pnpm -r build

clean:
	rm -rf node_modules packages/*/node_modules
	rm -rf packages/*/dist
	rm -rf coverage packages/*/coverage
	find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete

reset:
	@read -p "This will DELETE all Postgres and Redis data. Continue? [y/N] " ans; \
	  if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
	    $(COMPOSE) down -v; \
	    $(COMPOSE) --profile dev up -d; \
	  else \
	    echo "Aborted."; \
	  fi

# --- Developer platform (packages/platform) ------------------------------

platform-dev:
	pnpm --filter @bbs/platform dev

platform-build:
	pnpm --filter @bbs/platform build:next

platform-start:
	pnpm --filter @bbs/platform start
