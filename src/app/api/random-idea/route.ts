import { NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/lib/constants';

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
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: `You generate TV series premises that put a fresh twist on proven, commercially successful concepts. Think "what if Breaking Bad met X" or "Succession but in Y setting." Ground your ideas in familiar genres and archetypes audiences already love — crime, family drama, thriller, sci-fi, legal, medical, political — then add one unexpected element that makes it feel new. Be specific about characters, setting, and the central conflict. Do not include a title — just the premise in 1-2 sentences. Respond with only the premise text, nothing else.`,
          },
          {
            role: 'user',
            content: 'Give me a series premise that puts a fresh twist on a proven concept. Make it feel like a show that could actually get greenlit.',
          },
        ],
        temperature: 1.2,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `OpenRouter error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    return NextResponse.json({ idea: content });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
