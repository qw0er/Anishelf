import { loadDeploymentConfig } from "./config/deployment.js";
import { DomainError } from "./errors.js";

try {
  await loadDeploymentConfig();
  process.stdout.write("Anishelf deployment configuration loaded. HTTP server is not implemented yet.\n");
} catch (error) {
  const message = error instanceof DomainError ? error.message : "Unexpected startup failure.";
  process.stderr.write(`Anishelf startup failed: ${message}\n`);
  process.exitCode = 1;
}
