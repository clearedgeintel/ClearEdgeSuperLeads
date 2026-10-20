import Anthropic from "@anthropic-ai/sdk";
import type { BusinessData } from "@shared/sites";
import { withRetry } from "../../lib/retry";
import { trackApiCall } from "../../lib/apiTracker";
import type { EnrichContext, EnrichmentProvider } from "./index";
import { sitesModel } from "./model";
import { parseFirstJsonObject, normalize } from "./shared";

// Cold-input enrichment: one Anthropic call with the server-side web_search
// tool. The model researches the business and returns a single JSON object
// matching BusinessData. Testimonials are NOT requested from the model — they
// are filled server-side with the labeled sample set.

const SYSTEM_PROMPT = `You are a research assistant for ClearEdge Intelligence. You build a one-page
demo website for a local business that a sales rep will show as "look what I already built for you."

Research the business using its Google Business Profile, its own website, and reputable listings.
Use the web_search tool as needed. Then return ONLY one JSON object (no prose, no markdown fences)
matching exactly this TypeScript type:

{
  "name": string,            // official business name
  "category": string,        // e.g. "Roofing Contractor", "Property Management"
  "city": string,
  "state": string,           // 2-letter code if US
  "phone": string | null,    // verified phone, else null — NEVER invent
  "website": string | null,  // their existing site if any, else null
  "rating": number | null,   // e.g. 4.7 — only if verified, else null
  "reviewCount": number | null, // only if verified, else null
  "tagline": string,         // <= 10 words, benefit-driven, paraphrased
  "about": string,           // 2-3 sentences, paraphrased — copy no text from any source
  "services": [ { "name": string, "desc": string } ], // 4-6 items, desc <= 12 words
  "serviceAreas": string[],  // 3-6 nearby cities/areas
  "hours": string,           // short string, or "Call for hours"
  "yearsInBusiness": string | null, // e.g. "15+ years", else null
  "brandColor": string       // hex color suited to the trade, e.g. "#b91c1c"
}

Hard rules:
- NEVER fabricate phone, rating, or reviewCount. If you cannot verify a value, use null.
- Paraphrase everything. Do NOT copy sentences or review text verbatim from any source.
- Respect the length limits above.
- Output the JSON object and nothing else.`;

const TOOLS: Anthropic.ToolUnion[] = [{ type: "web_search_20260209", name: "web_search" }];

export class WebSearchProvider implements EnrichmentProvider {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      // Reads ANTHROPIC_API_KEY from the environment.
      this.client = new Anthropic();
    }
    return this.client;
  }

  async lookup(nameHint: string, locHint?: string, ctx: EnrichContext = {}): Promise<BusinessData> {
    const model = sitesModel();
    const client = this.getClient();

    const userPrompt = `Research this business and return the JSON object.\nBusiness: ${nameHint}${
      locHint ? `\nLocation hint: ${locHint}` : ""
    }`;
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];

    const call = async () => {
      const response = await withRetry(
        () =>
          client.messages.create({
            model,
            max_tokens: 4000,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages,
          }),
        { label: "sites.enrich.webSearch" }
      );
      await trackApiCall({
        provider: "claude",
        endpoint: "sites.enrich.webSearch",
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        workspaceId: ctx.workspaceId ?? undefined,
        leadId: ctx.leadId ?? undefined,
      });
      return response;
    };

    let response = await call();

    // Server-side tool sampling loop: resume on pause_turn.
    let guard = 0;
    while (response.stop_reason === "pause_turn" && guard++ < 6) {
      messages.push({ role: "assistant", content: response.content });
      response = await call();
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const raw = parseFirstJsonObject(text);
    if (!raw) {
      throw new Error(
        "Could not research that business automatically. Try the full Google Maps place URL, or a more specific name and city."
      );
    }

    return normalize(raw, { name: nameHint });
  }
}
