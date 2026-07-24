import { getChatGPTUser } from "@/app/chatgpt-auth";
import { handleQuoteRequest } from "@/lib/yahoo-quotes";

export async function GET(request: Request) {
  return handleQuoteRequest(request, await getChatGPTUser());
}
