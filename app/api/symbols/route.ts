import { getChatGPTUser } from "@/app/chatgpt-auth";
import { portfolioViewModel, symbolDirectory, symbolSearchEntries } from "@/lib/site-data";
import { searchSecurities } from "@/lib/symbol-directory";

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return Response.json({ error: "未登录。" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const heldSymbols = new Set(portfolioViewModel.positionGroups.map((group) => group.symbol));
  return Response.json({
    results: searchSecurities(symbolSearchEntries, query, heldSymbols, 10),
    directoryUpdatedAt: symbolDirectory.generatedAt,
  });
}
