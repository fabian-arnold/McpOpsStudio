import { createApiApplication } from "./application.js";
import { assertScopedCursor } from "./api-operation-helpers.js";
import { closeApiResources, connectApiResources } from "./resources.js";

import { registerAuthRoutes } from "./routes-auth.js";
import { registerProjectsRoutes } from "./routes-projects.js";
import { registerProjectSettingsRoutes } from "./routes-project-settings.js";
import { registerProjectAdminRoutes } from "./routes-project-admin.js";
import { registerUsersRoutes } from "./routes-users.js";
import { registerDiscoveryRoutes } from "./routes-discovery.js";
import { registerOverviewRoutes } from "./routes-overview.js";
import { registerEndpointsRoutes } from "./routes-endpoints.js";
import { registerEndpointSettingsRoutes } from "./routes-endpoint-settings.js";
import { registerFunctionsRoutes } from "./routes-functions.js";
import { registerFunctionDetailRoutes } from "./routes-function-detail.js";
import { registerBindingsRoutes } from "./routes-bindings.js";
import { registerSecretsRoutes } from "./routes-secrets.js";
import { registerEndpointAuthRoutes } from "./routes-endpoint-auth.js";
import { registerAuthPoliciesRoutes } from "./routes-auth-policies.js";
import { registerLibrariesTemplatesRoutes } from "./routes-libraries-templates.js";
import { registerDeploymentCreateRoutes } from "./routes-deployment-create.js";
import { registerDeploymentReleaseRoutes } from "./routes-deployment-release.js";
import { registerDeploymentHistoryRoutes } from "./routes-deployment-history.js";
import { registerManifestsRoutes } from "./routes-manifests.js";
import { registerOAuthRoutes } from "./routes-oauth.js";
import { registerPlatformMcpRoutes } from "./platform-mcp.js";

await connectApiResources();
const app = await createApiApplication({ assertScopedCursor });
app.addHook("onClose", async () => {
  await closeApiResources();
});

await registerAuthRoutes(app);
await registerOAuthRoutes(app);
await registerPlatformMcpRoutes(app);
await registerProjectsRoutes(app);
await registerProjectSettingsRoutes(app);
await registerProjectAdminRoutes(app);
await registerUsersRoutes(app);
await registerDiscoveryRoutes(app);
await registerOverviewRoutes(app);
await registerEndpointsRoutes(app);
await registerEndpointSettingsRoutes(app);
await registerFunctionsRoutes(app);
await registerFunctionDetailRoutes(app);
await registerBindingsRoutes(app);
await registerSecretsRoutes(app);
await registerEndpointAuthRoutes(app);
await registerAuthPoliciesRoutes(app);
await registerLibrariesTemplatesRoutes(app);
await registerDeploymentCreateRoutes(app);
await registerDeploymentReleaseRoutes(app);
await registerDeploymentHistoryRoutes(app);
await registerManifestsRoutes(app);

export { app };
