SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

REMOTE ?= origin
CURRENT_BRANCH := $(shell git branch --show-current)
REPO_NAME := $(notdir $(CURDIR))
BASE_PATH ?= /$(REPO_NAME)/
GH_PAGES_BRANCH ?= gh-pages
GH_PAGES_WORKTREE ?= .gh-pages-worktree
DEPLOY_MESSAGE ?= Deploy $(shell git rev-parse --short HEAD) to $(GH_PAGES_BRANCH)

.PHONY: help lint test run typecheck check build validate push deploy deploy-gh-pages clean-gh-pages

help:
	@echo "Targets:"
	@echo "  make lint              Run ESLint"
	@echo "  make test              Run Vitest"
	@echo "  make run               Run the dev server locally"
	@echo "  make typecheck         Run vue-tsc"
	@echo "  make build             Build static app with BASE_PATH=$(BASE_PATH)"
	@echo "  make validate          Run lint, tests, typecheck, and build"
	@echo "  make push              git add ., git commit, git push origin HEAD"
	@echo "  make deploy            Validate, build, and push dist to $(GH_PAGES_BRANCH)"
	@echo "  make deploy-gh-pages   Alias for make deploy"
	@echo ""
	@echo "Overrides:"
	@echo "  BASE_PATH=/ make deploy-gh-pages"
	@echo "  REMOTE=upstream GH_PAGES_BRANCH=pages make deploy-gh-pages"

lint:
	npm run lint

test:
	npm test

run:
	npm run dev

typecheck:
	npm run typecheck

check: lint test typecheck

build:
	BASE_PATH="$(BASE_PATH)" npm run build

validate: lint test typecheck build

push:
	git add .
	git commit
	git push origin HEAD

deploy: deploy-gh-pages

deploy-gh-pages: validate
	git diff --quiet
	git diff --cached --quiet
	git worktree prune
	rm -rf "$(GH_PAGES_WORKTREE)"
	if git show-ref --verify --quiet "refs/heads/$(GH_PAGES_BRANCH)"; then \
		git worktree add "$(GH_PAGES_WORKTREE)" "$(GH_PAGES_BRANCH)"; \
	elif git ls-remote --exit-code --heads "$(REMOTE)" "$(GH_PAGES_BRANCH)" >/dev/null 2>&1; then \
		git fetch "$(REMOTE)" "$(GH_PAGES_BRANCH):$(GH_PAGES_BRANCH)"; \
		git worktree add "$(GH_PAGES_WORKTREE)" "$(GH_PAGES_BRANCH)"; \
	else \
		git worktree add --detach "$(GH_PAGES_WORKTREE)" HEAD; \
		git -C "$(GH_PAGES_WORKTREE)" switch --orphan "$(GH_PAGES_BRANCH)"; \
	fi
	rsync -a --delete --exclude ".git" dist/ "$(GH_PAGES_WORKTREE)/"
	touch "$(GH_PAGES_WORKTREE)/.nojekyll"
	git -C "$(GH_PAGES_WORKTREE)" add -A
	if git -C "$(GH_PAGES_WORKTREE)" diff --cached --quiet; then \
		echo "No gh-pages changes to deploy."; \
	else \
		git -C "$(GH_PAGES_WORKTREE)" commit -m "$(DEPLOY_MESSAGE)"; \
		git -C "$(GH_PAGES_WORKTREE)" push "$(REMOTE)" "$(GH_PAGES_BRANCH)"; \
	fi
	git worktree remove "$(GH_PAGES_WORKTREE)"

clean-gh-pages:
	git worktree remove --force "$(GH_PAGES_WORKTREE)" 2>/dev/null || true
