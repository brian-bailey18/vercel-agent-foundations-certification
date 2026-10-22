import { createAgentUIStreamResponse } from "ai";
import { shoppingAgent } from "@/lib/agent";

export const POST = async (req: Request) => {
  const { messages } = await req.json();
  return createAgentUIStreamResponse({ agent: shoppingAgent, uiMessages: messages });
};