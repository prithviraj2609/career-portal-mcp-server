import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is unavailable; run this verifier through npm");
}
const result = spawnSync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"],
  { encoding: "utf8" },
);
if (result.status !== 0) {
  if (result.error) throw result.error;
  process.stderr.write(result.stderr ?? "npm pack verification failed\n");
  process.exit(result.status ?? 1);
}

const reports = JSON.parse(result.stdout);
const paths = reports.flatMap((report) =>
  report.files.map((file) => file.path),
);
const forbidden = paths.filter((path) =>
  /(^|\/)(?:node_modules|tests?|coverage|fixtures?|resumes?)(?:\/|$)|(?:^|\/)\.env$|(?:^|\/).*\.(?:enc|key|tmp|log|tsbuildinfo)$/i.test(
    path,
  ),
);
if (forbidden.length > 0) {
  throw new Error(`Forbidden package paths: ${forbidden.join(", ")}`);
}
if (
  !paths.includes("dist/index.js") ||
  !paths.includes("dist/secure-launcher.js") ||
  !paths.includes("README.md") ||
  !paths.includes("LICENSE")
) {
  throw new Error("Package is missing required runtime or documentation files");
}

process.stdout.write(
  `${JSON.stringify({
    verified: true,
    packageFiles: paths.length,
  })}\n`,
);
