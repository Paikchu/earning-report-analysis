import { readFile, readdir } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export function checkSourceBoundary(file: string, source: string): string[] {
  const contract = file.startsWith("shared/analysis-contract/");
  const pipeline = file.startsWith("workers/pipeline/");
  const web = /^(app|components|lib\/web|workers\/web)\//.test(file);
  if (!contract && !pipeline && !web) return [];
  const errors: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function dependency(specifier: string) {
    const target = specifier.startsWith("@/") ? specifier.slice(2)
      : specifier.startsWith(".") ? posix.normalize(posix.join(dirname(file), specifier)) : null;
    if (contract && (!target || !target.startsWith("shared/analysis-contract/"))) errors.push(`${file}: contract imports ${specifier}`);
    if (pipeline && target && !target.startsWith("workers/pipeline/") && !target.startsWith("shared/analysis-contract/")) errors.push(`${file}: Pipeline imports ${specifier}`);
    if (web && target?.startsWith("workers/pipeline/")) errors.push(`${file}: Web imports Pipeline ${specifier}`);
    if (web && /^(?:@\/)?db(?:\/|$)/.test(specifier)) errors.push(`${file}: Web imports analysis database`);
  }
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependency(node.argument.literal.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) dependency(argument.text);
      else errors.push(`${file}: nonliteral module loading bypasses ownership checks`);
    }
    if (contract && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isArrowFunction(node))) errors.push(`${file}: contract contains implementation code`);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (pipeline && /WEB_APP_ORIGIN|\/api\/internal\//.test(source)) errors.push(`${file}: Pipeline retains a Web callback`);
  if (contract && /\b(?:D1Database|D1PreparedStatement|Workflow|R2Bucket)\b/.test(source)) errors.push(`${file}: contract contains platform state`);
  return errors;
}

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? files(`${directory}/${entry.name}`)
    : Promise.resolve(/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [`${directory}/${entry.name}`] : [])))).flat();
}
export async function checkArchitecture(): Promise<string[]> {
  const paths = (await Promise.all(["app", "components", "lib", "shared", "workers"].map(files))).flat();
  return (await Promise.all(paths.map(async (file) => checkSourceBoundary(file, await readFile(file, "utf8"))))).flat();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await checkArchitecture();
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Architecture boundaries passed: Web → contract ← Pipeline; no reverse imports or callbacks.");
}
