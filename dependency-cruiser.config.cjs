/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      severity: "error",
      comment: "Cycles make initialization order and ownership ambiguous.",
      from: {},
      to: { circular: true },
    },
    {
      name: "packages-must-not-depend-on-apps",
      severity: "error",
      comment: "Reusable packages must remain independent of deployable apps.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-must-not-depend-on-other-apps",
      severity: "error",
      comment: "Deployable roles communicate through contracts, not source imports.",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "shared-is-foundational",
      severity: "error",
      comment: "The shared contract package cannot depend on higher-level packages.",
      from: { path: "^packages/shared/" },
      to: { path: "^packages/(?!shared/)" },
    },
    {
      name: "runtime-sdk-is-foundational",
      severity: "error",
      comment: "The runtime SDK cannot depend on infrastructure packages.",
      from: { path: "^packages/runtime-sdk/" },
      to: { path: "^packages/(?!runtime-sdk/|shared/)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: "(^|/)(dist|coverage|node_modules|\\.next|\\.turbo)/",
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "default"],
    },
  },
};
