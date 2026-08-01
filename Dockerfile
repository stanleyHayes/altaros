# One image, every service. Which one it runs is a flag, per ADR-004: the eight
# services have genuinely separate boundaries but deploy as one binary until
# traffic justifies splitting, and splitting is then a deploy-config change
# (same image, different -service) rather than a rebuild.
#
#   docker run altar-os:latest -service=gateway
#   docker run altar-os:latest -service=finance

# --- build ------------------------------------------------------------------
FROM golang:1.26-bookworm AS build

WORKDIR /src

# Dependencies first, as their own layer: they change far less often than the
# source, so a code-only edit reuses the download.
COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/

# CGO off for a static binary the distroless base can run.
# -trimpath keeps build-machine paths out of stack traces.
# The ldflags strip the symbol table and DWARF data, which is most of the size.
ARG VERSION=dev
ARG COMMIT=unknown
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
      -o /out/altar ./cmd/altar

# --- runtime ----------------------------------------------------------------
# Distroless: no shell, no package manager, no busybox. A compromised process
# has nothing to pivot with, and the image has no OS packages to patch — which
# for a service handling giving data is the difference between a vulnerability
# report and an incident.
FROM gcr.io/distroless/static-debian12:nonroot

# Non-root by default rather than by policy: the base image's `nonroot` user is
# already set, so a deployment that forgets a securityContext is still safe.
USER nonroot:nonroot

COPY --from=build /out/altar /altar

# Documentation only; the actual port comes from PORT.
EXPOSE 8080

ENV APP_ENV=production \
    PORT=8080

# No shell in the image, so this is exec form by necessity as well as by
# preference: it makes the binary PID 1, which is what receives SIGTERM and
# triggers the graceful shutdown the service already implements.
ENTRYPOINT ["/altar"]
CMD ["-service=gateway"]
