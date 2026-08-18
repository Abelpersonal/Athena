// Side-effect imports: each template registers itself on import.
// Add a new template by creating a file here and importing it below —
// no switch statement to extend.
import "./summarizeText.js";
import "./extractKeyPoints.js";
import "./decomposeTopic.js";
import "./generateSearchQueries.js";
import "./generateContentionQueries.js";
import "./extractGroundedKeyPoints.js";
import "./synthesizeSubtopic.js";
import "./restructureLayers.js";
import "./depthAuditScore.js";
import "./classifyVolatility.js";

export * from "./registry.js";
export * from "./summarizeText.js";
export * from "./extractKeyPoints.js";
export * from "./decomposeTopic.js";
export * from "./generateSearchQueries.js";
export * from "./extractGroundedKeyPoints.js";
export * from "./synthesizeSubtopic.js";
export * from "./restructureLayers.js";
export * from "./depthAuditScore.js";
export * from "./classifyVolatility.js";
