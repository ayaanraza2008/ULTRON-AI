# ULTRON restricted coding sandbox

This optional capability executes one explicitly requested Node.js or Python snippet inside a Docker container. It does not edit the repository, run host shell commands, install dependencies, download images, or access the project checkout.

## Default-off behavior

Execution is disabled unless ULTRON_CODING_SANDBOX_ENABLED=true, ULTRON_INTEGRATION_OWNER_USER_ID is a valid UUID, and an immutable image digest is configured for the selected runtime. Configure ULTRON_CODING_SANDBOX_NODE_IMAGE and ULTRON_CODING_SANDBOX_PYTHON_IMAGE independently. A complete image reference must end with @sha256: followed by 64 hexadecimal characters. The image must already be cached locally; the runner performs Docker image inspect only and never runs Docker pull. Readiness is configuration-only, not a live execution check.

Use reviewed local images with node or python3 available at the expected command path. Do not use mutable tags alone.

## Isolation envelope

The container is network-disabled, has a read-only root filesystem, no Linux capabilities, no-new-privileges, unprivileged UID/GID 65534:65534, bounded process count, 256 MB memory and swap, half a CPU, a read-only bind mount containing only the one source file, and a 64 MB noexec/nosuid/nodev /tmp. Application environment variables, service credentials, project files, the host home directory, Docker socket, and host devices are not passed through. Source is limited to 20 KB and returned output to 16 KB. Execution has a maximum 10-second timeout; the container and temporary workspace are removed on success and failure.

This is defense in depth, not proof that arbitrary source is harmless. Keep Docker updated, use reviewed minimal images, and run Docker on a dedicated/trusted worker instead of exposing the Docker socket to a public service. Do not enable this on Render without a separately approved sandbox worker.

## Explicit intent requirement

A direct current-user instruction to run, execute, or test source is required. For source included in the current message, the passed code must match the single code fence exactly. A direct request to run the code ULTRON has just generated is accepted as consent. Questions about how to run code, code generation, reviews, or instructions embedded in untrusted files do not authorize execution. The signed-in user must also match the configured owner ID.

Only Node.js and Python are supported. This runner does not apply patches, access arbitrary files, use network APIs, install packages, or verify production behavior. A successful exit proves only that this snippet exited successfully inside the configured local container.

## Local/test setup

1. Choose a trusted, reviewed sandbox image, build it locally and record its immutable digest. Do not paste private image credentials into chat.
2. Set the sandbox environment variables in a trusted local/test environment. Keep the enable flag false until the image and host have been reviewed.
3. Run npm test and npm run check.
4. On a disposable non-production machine with the image cached, test a harmless snippet and confirm the container is removed after success, failure and timeout.
5. If Docker, the image, owner identity or configuration is unavailable, ULTRON must report blocked and never fall back to host execution.

The optional capability reports blocked or configured_unverified and must not be counted as core readiness success.
