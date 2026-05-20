.PHONY: dev install bump-version-minor bump-version-patch format-backend run-api test-api test-frontend-docker test-e2e-docker test-docker build-docker
dev:
	@set -e; \
	trap 'printf "\n↪ shutting down…\n"; kill 0; exit 0' INT TERM; \
	npm run dev & \
	NPM_PID=$$!; \
	DEBUG=true poetry run gunicorn --config gunicorn.conf.py api.main:app & \
	GUNICORN_PID=$$!; \
	wait $$NPM_PID $$GUNICORN_PID || { kill $$NPM_PID $$GUNICORN_PID 2>/dev/null || true; }

install:
	@set -e; \
	npm install; \
	poetry lock && poetry install

bump-version-minor:
	@set -e; \
	# Uses "version" command in package.json to bump python version
	npm version minor;

bump-version-patch:
	@set -e; \
	# Uses "version" command in package.json to bump python version
	npm version patch;

format-backend:
	@set -e; \
	poetry run black api/;

run-api:
	@set -e; \
	poetry run gunicorn --config gunicorn.conf.py api.main:app;

test-api:
	@set -e; \
	poetry run python -c "from api.main import app; print('✅ FastAPI app loads successfully')";

test-frontend-docker:
	@set -e; \
	docker compose -f compose.dev.yaml run --rm --no-deps vite npm run test

test-e2e-docker:
	@set -e; \
	docker compose -f compose.dev.yaml run --rm playwright

test-docker: test-frontend-docker test-e2e-docker

build-docker:
	@set -e; \
	docker buildx build -t "the-tuul:latest" \
	--cache-from "the-tuul:latest" \
	.