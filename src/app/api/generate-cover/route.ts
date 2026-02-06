import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
  }

  try {
    const { title, description, worldSummary } = await req.json() as {
      title: string;
      description?: string;
      worldSummary?: string;
    };

    // Build an evocative image prompt from narrative context
    const context = [description, worldSummary].filter(Boolean).join('. ');
    const imagePrompt = `Cinematic wide-angle digital painting, book cover art style. ${title}. ${context}. Dramatic lighting, rich atmosphere, high detail, no text, no letters, no words, no watermarks.`;

    // Call Replicate Seedream 4.5 with sync mode
    const response = await fetch('https://api.replicate.com/v1/models/bytedance/seedream-3.0/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
        'Prefer': 'wait',
      },
      body: JSON.stringify({
        input: {
          prompt: imagePrompt,
          num_outputs: 1,
          aspect_ratio: '3:4',
          output_format: 'webp',
          output_quality: 80,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[generate-cover] Replicate error:', errorText);
      return NextResponse.json({ error: `Replicate error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();

    // Replicate returns output as an array of URLs
    const imageUrl = Array.isArray(data.output) ? data.output[0] : data.output;

    if (!imageUrl) {
      return NextResponse.json({ error: 'No image generated' }, { status: 500 });
    }

    return NextResponse.json({ imageUrl });
  } catch (err) {
    console.error('[generate-cover] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
