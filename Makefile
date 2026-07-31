.DEFAULT_GOAL := help
.PHONY: help contracts contracts-check build vet test run fmt fmt-check infra-up infra-down infra-logs check

GO       ?= go
SERVICE  ?= gateway
PORT     ?= 8090

# node_modules can contain vendored Go packages (flatted ships one), and Go
# does not ignore it the way it ignores _ and . directories. Scope every Go
# command to our own packages.
PKGS     := $(shell $(GO) list ./... | grep -v '/node_modules/')
GOFILES  := $(shell find . -name '*.go' -not -path './node_modules/*')

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- contracts (WP-04) ---

contracts: ## Regenerate Go contract types from packages/shared-types
	@node tools/gen-go-contracts/generate.mjs

contracts-check: ## Fail if the Go contracts drift from shared-types (CI)
	@node tools/gen-go-contracts/generate.mjs --check

## --- Go ---

build: ## Build every Go package
	@$(GO) build $(PKGS)

vet: ## Run go vet
	@$(GO) vet $(PKGS)

test: ## Run Go tests
	@$(GO) test $(PKGS) -count=1

run: ## Run one service: make run SERVICE=gateway PORT=8090
	@PORT=$(PORT) $(GO) run ./cmd/altar -service=$(SERVICE)

fmt: ## Format our Go files
	@gofmt -w $(GOFILES)

fmt-check: ## Fail if any of our Go files are not gofmt'd
	@unformatted="$$(gofmt -l $(GOFILES))"; \
	if [ -n "$$unformatted" ]; then \
	  echo "Not gofmt'd:"; echo "$$unformatted"; exit 1; \
	fi

check: contracts-check fmt-check vet build test ## Everything CI runs for the Go side

## --- local infrastructure (WP-03) ---

infra-up: ## Start MongoDB, Redis and Kafka
	@docker compose up -d
	@docker compose ps --format '  {{.Name}} | {{.State}} | {{.Health}}'

infra-down: ## Stop infrastructure (data volumes survive)
	@docker compose down

infra-logs: ## Tail infrastructure logs
	@docker compose logs -f --tail=50
