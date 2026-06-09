import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export interface LeadAnalysis {
  score: number;
  priority: 'high' | 'medium' | 'low';
  issues: Array<{
    category: string;
    severity: 'critical' | 'moderate' | 'minor';
    description: string;
    recommendation: string;
  }>;
  recommendations: string[];
  summary: string;
}

/**
 * Extract JSON from Claude's response, handling markdown code fences
 * (```json ... ``` or ``` ... ```) that Claude sometimes wraps output in.
 */
function extractJson(text: string): any {
  let cleaned = text.trim();

  // Strip markdown code fence
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Fallback: find first { and last } if there's still surrounding text
  if (!cleaned.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.slice(start, end + 1);
    }
  }

  return JSON.parse(cleaned);
}

/**
 * Call a function with exponential backoff on rate-limit errors.
 * Retries 3 times with 2s, 4s, 8s delays.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.response?.status;
      const isRateLimit = status === 429 || status === 529 || status === 503;
      const isOverloaded = error?.message?.includes('overloaded');

      if (i === attempts - 1 || (!isRateLimit && !isOverloaded)) {
        throw error;
      }

      const delay = Math.pow(2, i + 1) * 1000;
      console.warn(`[AI] Rate-limited, retrying in ${delay}ms (attempt ${i + 1}/${attempts})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export class AIService {
  async analyzeLead(leadData: {
    businessName: string;
    category?: string;
    address?: string;
    phone?: string;
    website?: string;
    snippet?: string;
    rating?: number;
    totalReviews?: number;
    businessStatus?: string;
  }): Promise<LeadAnalysis> {
    try {
      const prompt = `Analyze this business for Google Business Profile cleanup opportunities:

Business: ${leadData.businessName}
Category: ${leadData.category || 'Unknown'}
Address: ${leadData.address || 'Not provided'}
Phone: ${leadData.phone || 'Not provided'}
Website: ${leadData.website || 'Not provided'}
Description: ${leadData.snippet || 'No description available'}
Google Rating: ${leadData.rating ? `${leadData.rating}/5 (${leadData.totalReviews || 0} reviews)` : 'Not available'}
Business Status: ${leadData.businessStatus || 'Unknown'}

Evaluate this business for GBP cleanup needs and provide a score from 0-100 where:
- 0-40: High priority (critical issues, likely needs significant cleanup)
- 41-70: Medium priority (some issues, moderate cleanup needed)
- 71-100: Low priority (minor issues, minimal cleanup needed)

Consider factors like:
- Missing or incomplete business information
- Poor online presence indicators
- Potential for improved local search visibility
- Likely business hours, photo, and description completeness
- Google rating and review count (low reviews = opportunity)
- Business operational status

Respond with JSON in this exact format:
{
  "score": number,
  "priority": "high" | "medium" | "low",
  "issues": [
    {
      "category": string,
      "severity": "critical" | "moderate" | "minor",
      "description": string,
      "recommendation": string
    }
  ],
  "recommendations": [string],
  "summary": string
}`;

      const response = await withRetry(() => anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: "You are a Google Business Profile optimization expert. Analyze businesses and provide actionable recommendations for improving their local search presence. Always respond with valid JSON only, no other text.",
        messages: [
          { role: "user", content: prompt }
        ],
      }));

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const result = extractJson(text);

      return {
        score: Math.max(0, Math.min(100, result.score || 50)),
        priority: ['high', 'medium', 'low'].includes(result.priority) ? result.priority : 'medium',
        issues: Array.isArray(result.issues) ? result.issues : [],
        recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
        summary: result.summary || 'Analysis completed'
      };
    } catch (error: any) {
      console.error('AI analysis error:', error);
      throw new Error(`AI analysis failed: ${error.message}`);
    }
  }

  async generateOutreachEmail(leadData: {
    businessName: string;
    category?: string;
    issues: Array<{ category: string; description: string; recommendation: string }>;
    ownerName?: string;
  }): Promise<{ subject: string; content: string }> {
    try {
      const noticed = leadData.issues.length
        ? leadData.issues.map(issue => `- ${issue.category}: ${issue.description}`).join('\n')
        : '(none provided — open with a warm, specific-sounding observation about this type of business instead)';

      const prompt = `Write a short, personal cold outreach email from ClearEdge to a local business owner.

Business: ${leadData.businessName}
Category: ${leadData.category || 'Business'}
Owner: ${leadData.ownerName || 'there'}

Things we noticed about their Google Business Profile (use ONE of these, naturally, as a soft opener — do NOT list them all or sound like an audit report):
${noticed}

About ClearEdge: we help local businesses (1) sharpen their Google Business Profile so it actually drives calls, and (2) use AI to take the repetitive, low-value busywork off the owner's plate — the operational stuff that eats hours but doesn't grow the business. Use broad, relatable examples like inventory, bookkeeping, time-keeping, scheduling, invoicing, follow-ups, review requests, and data entry (pick the 1–2 most relevant to their business type — don't list them all). We bring the power of AI to small and mid-sized businesses.

The email MUST:
1. Open with a genuine, specific observation about THEIR business or GBP (use one noticed item) so the first line earns the read.
2. Pivot to one curious, human question — the core hook: what is the task they spend the most time on that brings the least value? Frame it as something AI could probably take off their hands.
3. In a single sentence, say ClearEdge helps local businesses do exactly that: a stronger Google presence plus AI that automates the time-wasters.
4. Close with a LOW-FRICTION call to action: invite a one-line reply (e.g. "what's the one thing you'd love to never do again?"). Do NOT ask for a call, demo, or meeting.
5. Sound like a real person wrote it — warm, conversational, concise (UNDER 130 words). No buzzwords, no "I hope this email finds you well," no bullet points in the body, no hard sell.

Respond with JSON in this format:
{
  "subject": string,
  "content": string
}
The subject should be short and curious, not salesy — e.g. "quick question about ${leadData.businessName}".`;

      const response = await withRetry(() => anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: "You are an outreach specialist for ClearEdge, a company that helps small and local businesses improve their Google Business Profile AND brings the power of AI to automate the time-consuming, low-value tasks that eat an owner's day. You write short, consultative, genuinely human emails that open a conversation — never salesy, never templated. Always respond with valid JSON only, no other text.",
        messages: [
          { role: "user", content: prompt }
        ],
      }));

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const result = extractJson(text);

      return {
        subject: result.subject || `Quick question about ${leadData.businessName}`,
        content: result.content || `Hi ${leadData.ownerName || 'there'} — I came across ${leadData.businessName} and had a quick question: what's the task you spend the most time on that brings you the least value? At ClearEdge we help local businesses sharpen their Google presence and use AI to take that kind of busywork off your plate. Curious — what's the one thing you'd love to never do again?`
      };
    } catch (error: any) {
      console.error('AI email generation error:', error);
      throw new Error(`Email generation failed: ${error.message}`);
    }
  }

  /**
   * Generate a LinkedIn outreach message from a pre-built prompt.
   * Caller is responsible for template interpolation (see promptEngine.ts).
   * Returns the message text plus token usage for cost tracking.
   */
  async generateLinkedInMessage(prompt: string): Promise<{
    text: string;
    inputTokens?: number;
    outputTokens?: number;
  }> {
    const message = await withRetry(() =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      })
    );

    const block = message.content[0];
    const text = block && block.type === 'text' ? block.text : '';

    return {
      text,
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
    };
  }
}

export const aiService = new AIService();
