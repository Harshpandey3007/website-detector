
const pathParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const json = (properties: object, required: string[] = []) => ({
  required: true,
  content: { "application/json": { schema: { type: "object", required, properties } } },
});
 
export const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Website Change Detector API",
    version: "1.0.0",
    description: "Monitors public web pages with headless Chromium and alerts on meaningful changes. Click Authorize and paste your x-api-key.",
  },
  servers: [{ url: process.env.PUBLIC_URL || "/" }],
  components: { securitySchemes: { ApiKey: { type: "apiKey", in: "header", name: "x-api-key" } } },
  security: [{ ApiKey: [] }],
  paths: {
    "/monitors": {
      get: { summary: "List your monitors", responses: { 200: { description: "Array of monitors" } } },
      post: {
        summary: "Create a monitor (SSRF-checked, quota-limited)",
        requestBody: json({
          url: { type: "string", example: "https://example.com" },
          name: { type: "string", example: "Example homepage" },
          intervalMins: { type: "integer", minimum: 15, maximum: 1440, example: 60 },
          sensitivity: { type: "integer", minimum: 0, maximum: 100, default: 5 },
          ignoreSelectors: { type: "string", nullable: true, example: ".ads, #clock" },
          watchSelectors: { type: "string", nullable: true, example: ".price" },
        }, ["url", "name", "intervalMins"]),
        responses: { 201: { description: "Created" }, 400: { description: "Validation or SSRF error" }, 403: { description: "Monitor quota reached" } },
      },
    },
    "/monitors/{id}": {
      get: { summary: "Get one monitor", parameters: [pathParam("id")], responses: { 200: { description: "Monitor" }, 404: { description: "Not found" } } },
      delete: { summary: "Delete a monitor and its history", parameters: [pathParam("id")], responses: { 200: { description: "Deleted" }, 404: { description: "Not found" } } },
    },
    "/monitors/{id}/check": {
      post: { summary: "Queue an immediate check", parameters: [pathParam("id")], responses: { 200: { description: "Queued" } } },
    },
    "/monitors/{id}/history": {
      get: { summary: "Snapshots, newest first (max 200)", parameters: [pathParam("id")], responses: { 200: { description: "Snapshots" } } },
    },
    "/monitors/{id}/compare/{v1}/{v2}": {
      get: {
        summary: "Word-level text diff between two snapshots",
        parameters: [pathParam("id"), pathParam("v1"), pathParam("v2")],
        responses: { 200: { description: "Diff HTML, summary and change ratio" }, 404: { description: "Not found" } },
      },
    },
    "/alerts": { get: { summary: "Your 100 most recent alerts", responses: { 200: { description: "Alerts" } } } },
    "/keys": {
      post: {
        summary: "Admin: mint a per-user API key (shown once)",
        requestBody: json({ name: { type: "string", example: "alice" } }, ["name"]),
        responses: { 201: { description: "Key created" }, 403: { description: "Admin only" } },
      },
    },
  },
};
 

