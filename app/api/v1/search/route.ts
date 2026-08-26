import { searchCompanyDirectory } from "@/lib/site-data";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ results: searchCompanyDirectory(query) }, { headers: {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
    vary: "Origin",
  } });
}
