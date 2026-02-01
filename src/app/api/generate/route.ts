import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { prompt, systemPrompt, model } = body as {
      prompt: string;
      systemPrompt?: string;
      model?: string;
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
        model: model || 'google/gemini-2.0-flash-001',
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          { role: 'user' as const, content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 8000,
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
