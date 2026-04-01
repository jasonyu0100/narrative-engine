import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { DEFAULT_MODEL, MAX_TOKENS_DEFAULT, DEFAULT_TEMPERATURE } from '@/lib/constants';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(req: NextRequest) {
  const apiKey = resolveKey(req, 'x-openrouter-key', 'OPENROUTER_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenRouter API key required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { prompt, systemPrompt, model, maxTokens, stream, temperature, reasoningBudget, jsonMode } = body as {
      prompt: string;
      systemPrompt?: string;
      model?: string;
      maxTokens?: number;
      stream?: boolean;
      temperature?: number;
      reasoningBudget?: number;
      jsonMode?: boolean;
    };

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Narrative Engine',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          { role: 'user' as const, content: prompt },
        ],
        temperature: temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: maxTokens || MAX_TOKENS_DEFAULT,
        ...(stream ? { stream: true } : {}),
        ...(reasoningBudget && reasoningBudget > 0 ? { reasoning: { max_tokens: reasoningBudget } } : {}),
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `OpenRouter error: ${errorText}` }, { status: response.status });
    }

    // Streaming mode: pipe SSE chunks through to client
    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'No response body' })}\n\n`));
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') {
                  if (trimmed === 'data: [DONE]') {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  }
                  continue;
                }
                if (trimmed.startsWith('data: ')) {
                  try {
                    const chunk = JSON.parse(trimmed.slice(6));
                    const delta = chunk.choices?.[0]?.delta;
                    const token = delta?.content ?? '';
                    // Forward reasoning tokens separately so the client can capture them
                    const reasoning = delta?.reasoning ?? delta?.reasoning_content ?? '';
                    if (token) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                    }
                    if (reasoning) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ reasoning })}\n\n`));
                    }
                  } catch {
                    // skip malformed chunks
                  }
                }
              }
            }
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming mode: existing behavior
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    // Extract reasoning content if present (OpenRouter returns it in message.reasoning or reasoning_details)
    const message = data.choices?.[0]?.message;
    const reasoning = message?.reasoning
      ?? message?.reasoning_content
      ?? (Array.isArray(message?.reasoning_details) ? message.reasoning_details.map((d: { content?: string }) => d.content ?? '').join('') : null);
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? null;
    return NextResponse.json({ content, ...(reasoning ? { reasoning } : {}), ...(reasoningTokens != null ? { reasoningTokens } : {}) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
