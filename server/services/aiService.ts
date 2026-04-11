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
      const prompt = `Generate a professional outreach email for a Google Business Profile consulting service.

Business: ${leadData.businessName}
Category: ${leadData.category || 'Business'}
Owner: ${leadData.ownerName || 'Business Owner'}

Key issues identified:
${leadData.issues.map(issue => `- ${issue.category}: ${issue.description}`).join('\n')}

Create a personalized, professional email that:
1. Introduces our GBP consulting services
2. Mentions specific issues we identified (without being too technical)
3. Highlights potential benefits of optimization
4. Includes a clear call-to-action
5. Maintains a consultative, helpful tone (not salesy)
6. Keeps it concise (under 200 words)

Respond with JSON in this format:
{
  "subject": string,
  "content": string
}`;

      const response = await withRetry(() => anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: "You are a professional business consultant specializing in Google Business Profile optimization. Write compelling but professional outreach emails. Always respond with valid JSON only, no other text.",
        messages: [
          { role: "user", content: prompt }
        ],
      }));

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const result = extractJson(text);

      return {
        subject: result.subject || `Improve ${leadData.businessName}'s Google Business Profile`,
        content: result.content || 'Professional consultation available for your Google Business Profile optimization.'
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
