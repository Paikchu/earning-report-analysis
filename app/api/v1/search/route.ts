import { searchCompanyDirectory } from "@/lib/site-data";
import { parseSecurityTypes } from "@/lib/symbol-directory";

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const query = parameters.get("q") ?? "";
  const types = parseSecurityTypes(parameters.get("types"));
  return Response.json({ results: searchCompanyDirectory(query, 8, types) }, { headers: {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
    vary: "Origin",
  } });
}
