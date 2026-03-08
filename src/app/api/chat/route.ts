import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { DEFAULT_MODEL } from '@/lib/constants';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(req: NextRequest) {
  const apiKey = resolveKey(req, 'x-openrouter-key', 'OPENROUTER_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenRouter API key required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { messages, systemPrompt } = body as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      systemPrompt: string;
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
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system' as const, content: systemPrompt },
          ...messages,
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `OpenRouter error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
