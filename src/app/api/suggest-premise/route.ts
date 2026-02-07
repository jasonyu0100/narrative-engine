import { NextResponse } from 'next/server';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Narrative Engine',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You generate TV series concepts with a catchy title and a compelling premise. Think original shows that put a fresh twist on proven, commercially successful genres — crime, family drama, thriller, sci-fi, legal, medical, political. Be specific about characters, setting, and the central conflict.

Respond in exactly this JSON format:
{"title": "The Show Title", "premise": "1-2 sentence premise describing the world, characters, and central conflict."}

Respond with only the JSON, nothing else.`,
          },
          {
            role: 'user',
            content: 'Give me an original series concept with a title and premise.',
          },
        ],
        temperature: 1.2,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `OpenRouter error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';

    // Parse JSON from response, handling potential markdown code fences
    const jsonStr = content.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonStr);

    return NextResponse.json({
      title: parsed.title ?? '',
      premise: parsed.premise ?? '',
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
