.PHONY: dev install bump-version-minor bump-version-patch format format-backend format-frontend lint-backend run-api test-api test-frontend-docker test-e2e-docker test-docker build-docker
dev:
	@set -e; \
	trap 'printf "\n↪ shutting down…\n"; kill 0; exit 0' INT TERM; \
	pnpm run dev & \
	VITE_PID=$$!; \
	DEBUG=true LYRICS_PROVIDER=$${LYRICS_PROVIDER-lrclib} poetry run gunicorn --config gunicorn.conf.py api.main:app & \
	GUNICORN_PID=$$!; \
	wait $$VITE_PID $$GUNICORN_PID || { kill $$VITE_PID $$GUNICORN_PID 2>/dev/null || true; }

install:
	@set -e; \
	pnpm install; \
	poetry lock && poetry install --with ml

bump-version-minor:
	@set -e; \
	# Uses "version" command in package.json to bump python version
	pnpm version minor;

bump-version-patch:
	@set -e; \
	# Uses "version" command in package.json to bump python version
	pnpm version patch;

format-backend:
	@set -e; \
	poetry run ruff check --fix .; \
	poetry run ruff format .;

format-frontend:
	@set -e; \
	pnpm run format;

format: format-backend format-frontend

run-api:
	@set -e; \
	poetry run gunicorn --config gunicorn.conf.py api.main:app;

lint-backend:
	@set -e; \
	poetry run ruff check .; \
	poetry run ruff format --check .;

test-api:
	@set -e; \
	poetry run python -c "from api.main import app; print('✅ FastAPI app loads successfully')";

test-frontend-docker:
	@set -e; \
	docker compose -f compose.dev.yaml run --rm --no-deps vite pnpm run test

test-e2e-docker:
	@set -e; \
	docker compose -f compose.dev.yaml run --rm playwright

test-docker: test-frontend-docker test-e2e-docker

build-docker:
	@set -e; \
	docker buildx build -t "the-tuul:latest" \
	--cache-from "the-tuul:latest" \
	.