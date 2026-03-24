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
    const { prompt, systemPrompt, model, maxTokens, stream, temperature } = body as {
      prompt: string;
      systemPrompt?: string;
      model?: string;
      maxTokens?: number;
      stream?: boolean;
      temperature?: number;
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
                    const token = chunk.choices?.[0]?.delta?.content ?? '';
                    if (token) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
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
    console.log('[generate] model:', data.model);
    console.log('[generate] finish_reason:', data.choices?.[0]?.finish_reason);
    console.log('[generate] usage:', JSON.stringify(data.usage));
    console.log('[generate] content length:', data.choices?.[0]?.message?.content?.length ?? 0);
    const content = data.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
