# Prusament → Spoolman

A mobile-friendly Czech interface for importing Prusament spools into your own Spoolman. Scan a QR label, read an NFC tag in a compatible browser, or paste a Prusament URL/ID. Review the imported details, choose an existing filament or create one, set the remaining filament weight, and confirm the import.

The backend talks to Spoolman; API credentials never need to be included in the browser build. Imports retain spool identifiers in Spoolman custom fields and check for an existing spool before creating another. There is no local database or persistent volume. A single application replica serializes imports; keep one replica to avoid concurrent duplicate creation across instances.

## Run locally

Requires Node.js 22 and npm.

```sh
npm ci
cp .env.example .env
# Edit .env with the URL reachable from this machine, then export it:
set -a
. ./.env
set +a
npm run build
npm start
```

Open <http://localhost:8080>. `SPOOLMAN_URL` is the Spoolman base URL, for example `http://192.168.1.20:7912`, without `/api/v1`; a reverse-proxy path prefix is supported. It must be reachable by the backend. Set `SPOOLMAN_PUBLIC_URL` when links opened on the phone need a different address.

For a live development preview, run these in separate terminals after exporting the environment:

```sh
npm run dev
```

```sh
npm run dev:ui
```

Open <http://localhost:5173>. The frontend proxies API requests to port 8080 and updates when source files change. Vite listens on the LAN too; put a trusted HTTPS proxy in front of port 5173 for phone camera/NFC testing. Check changes with `npm run typecheck`, `npm test`, and `npm run build`.

The committed lockfile makes `npm ci` installs reproducible. Dependency installation requires npm registry access.

## Preview without Spoolman

```sh
npm ci
npm run build
DEMO_MODE=true npm start
```

Open <http://localhost:8080> and select the **demo →** example under the manual input. Demo mode previews an example label and simulates saving without writing to Spoolman. Production defaults to `DEMO_MODE=false`.

## Runtime configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listener on all interfaces |
| `SPOOLMAN_URL` | unset | Required for real imports; backend Spoolman base URL |
| `SPOOLMAN_PUBLIC_URL` | `SPOOLMAN_URL` | Optional browser-facing Spoolman base URL |
| `SPOOLMAN_API_KEY` | unset | Optional backend authentication credential |
| `SPOOLMAN_API_HEADER` | `X-API-Key` | Header used for that credential |
| `NODE_EXTRA_CA_CERTS` | unset | Optional path to a PEM CA bundle for a private HTTPS CA |
| `REQUEST_TIMEOUT_MS` | `15000` | Timeout in milliseconds for each Spoolman API request |
| `DEMO_MODE` | `false` | Set exactly `true` to simulate imports |

The server does not automatically load `.env`; export it as shown above or pass it using the container runtime. Restart the server after changing configuration or a custom CA bundle. The Spoolman credential must permit reading vendors, filaments and spools, and creating custom spool fields, vendors, filaments and spools as needed.

## Container

```sh
docker build -t prusament-import:0.1.0 .
docker run --rm --name prusament-import -p 8080:8080 \
  --env-file .env prusament-import:0.1.0
```

The multistage image builds the UI and backend, installs production dependencies, and runs as the non-root `node` user. It supports both CPU architectures through the Node 22 base image:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t registry.example.com/prusament-import:0.1.0 --push .
```

For a private CA, mount a PEM bundle read-only and set its path, for example `-v /path/ca.crt:/etc/spoolman/ca.crt:ro -e NODE_EXTRA_CA_CERTS=/etc/spoolman/ca.crt`. `localhost` inside a container refers to that container; use a reachable Spoolman hostname or address.

## Kubernetes / Helm

Build and push an image to a registry your cluster can access, then install the local chart. The Spoolman URL is a deployment parameter and is required unless demo mode is explicitly enabled:

```sh
helm upgrade --install importer ./deploy/helm/prusament \
  --namespace prusament --create-namespace \
  --set image.repository=registry.example.com/prusament-import \
  --set image.tag=0.1.0 \
  --set-string spoolman.url=http://spoolman.spoolman.svc.cluster.local:7912 \
  --set-string spoolman.publicUrl=https://spoolman.home.arpa
kubectl -n prusament port-forward service/importer-prusament 8080:8080
```

Open <http://localhost:8080> for access from the machine running the port-forward. To publish on the home network, enable ingress and configure DNS, your ingress controller, and optional TLS through a values file:

```yaml
# home-values.yaml
image:
  repository: registry.example.com/prusament-import
  tag: "0.1.0"
spoolman:
  url: http://spoolman.spoolman.svc.cluster.local:7912
  publicUrl: https://spoolman.home.arpa
  # Optional existing secrets, created separately:
  apiKeySecret:
    name: spoolman-api
    key: api-key
  customCA:
    existingSecret: spoolman-ca
    key: ca.crt
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: prusament.home.arpa
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: prusament-tls
      hosts:
        - prusament.home.arpa
```

Remove the optional `apiKeySecret` and `customCA` sections when not needed. The CA secret contains the PEM bundle under the selected key; the chart mounts it and sets `NODE_EXTRA_CA_CERTS`. TLS ingress uses an existing TLS secret. Install with:

```sh
helm upgrade --install importer ./deploy/helm/prusament \
  --namespace prusament --create-namespace -f home-values.yaml
```

The chart uses one replica with `Recreate` updates, a ClusterIP service by default, non-root execution, a read-only root filesystem, and an ephemeral `/tmp`; it does not create a PVC. Liveness uses `/api/health/live`; readiness uses `/api/health/ready`. Readiness checks runtime configuration; the UI connection status separately reports whether Spoolman responds. Configure `imagePullSecrets` for a private registry.

Render and validate configuration before installation:

```sh
helm lint ./deploy/helm/prusament -f home-values.yaml
helm template importer ./deploy/helm/prusament -f home-values.yaml
# Chart-only preview with no configured Spoolman:
helm template importer ./deploy/helm/prusament --set demoMode=true
```

## Argo CD

[deploy/argocd/application.example.yaml](deploy/argocd/application.example.yaml) is an example for review; **do not apply it as-is**. It tracks `main` over SSH and enables automatic sync and self-healing without automatic pruning. Before use, configure the Spoolman service URL, ingress hostname and class, and an existing TLS secret for your cluster. Supply any Spoolman API key or CA through existing Kubernetes Secrets as described above.

GitHub Actions builds and publishes GHCR images with commit SHA tags and release tags. Wait for a successful image publishing run, obtain its published image digest from GHCR, and replace the all-zero placeholder with that digest. The chart accepts `image.digest` as `sha256:` followed by 64 lowercase hexadecimal characters; it takes precedence over `image.tag` and renders `repository@digest`. Without a digest it renders `repository:tag`. The chart defaults to `ghcr.io/blondak/prusament2spoolman`.

Argo CD watches Git, not the image registry: publishing a new image alone does not update the deployment. Commit a new digest to Git to deploy it. For live settings, a separate private GitOps repository is recommended; configure its Application to reference the chart and its environment-specific values, and protect secrets separately.

Register the source repository in Argo CD with a read-only GitHub SSH deploy key and verify its host key. That Git credential is separate from GHCR image pull authentication. GitHub packages can initially be private even for a public repository; explicitly check and set the package visibility if public pulls are intended. For a private package, create a suitable registry pull Secret in the destination namespace and set `imagePullSecrets` in chart values. Do not put credentials in the Application or Git values.

## Phone access

Deploy this unauthenticated app only on your trusted home LAN or behind your VPN. Users who can access it can import into the configured Spoolman. Use HTTPS with a certificate trusted by your phone for camera/NFC access; ordinary remote HTTP is unsuitable for those browser features. NFC depends on browser/device support; QR scanning and manual entry provide alternatives. A phone connecting through a VPN still needs DNS resolution, network access to the app, and a trusted HTTPS certificate.

Raw browser NFC access is limited to the NDEF records exposed by Web NFC. The application does not write to the physical tag. Unknown or incomplete labels produce a review warning or error; inspect imported weights and filament details before confirming. If a network error leaves the save result uncertain, check Spoolman before retrying.

## Samostatná ukázka rozhraní

`npm run preview:export` vytvoří `preview.html`, kterou lze otevřít přímo v prohlížeči. Jde o interaktivní ukázku s pevnými testovacími daty; neprovádí síťové zápisy. Kamera/NFC vyžadují skutečné HTTPS nasazení.

## Stav ověření

- Prošly testy QR/OpenPrintTag parseru, klienta Spoolmanu a HTTP API (demo import, validace, původ požadavků a readiness).
- Prošly `npm run typecheck`, `npm test` a `npm run build` s deklarovanými závislostmi a aktuálním lockfile.
- Helm lint a render prošly, včetně připnutí image na digest a odmítnutí neplatného digestu.
- Docker build a GitHub Actions se dosud nespouštěly. Reálný Spoolman a fyzické QR/NFC zůstávají k ověření.
- Tato relace blokuje síť a otevření portů. Lokální ověření API používá Fastify inject bez síťového listeneru.
