// Tests live next to the code they cover under netlify/ (the functions'
// helpers). babel-jest only strips types (ts-jest can't drive the repo's
// TypeScript 7) — `yarn typecheck` remains the only type gate. The babel
// presets are scoped to this transform so no root babel config leaks into
// Vite or Netlify builds.
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/netlify"],
  transform: {
    "^.+\\.ts$": [
      "babel-jest",
      {
        presets: [
          ["@babel/preset-env", { targets: { node: "current" } }],
          "@babel/preset-typescript",
        ],
      },
    ],
  },
};
