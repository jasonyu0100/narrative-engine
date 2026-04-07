import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';

export async function POST(req: NextRequest) {
  const apiToken = resolveKey(req, 'x-replicate-key', 'REPLICATE_API_TOKEN');
  if (!apiToken) {
    return NextResponse.json({ error: 'Replicate API token required' }, { status: 401 });
  }

  try {
    const { title, description, rules, imageStyle, coverPrompt } = await req.json() as {
      title: string;
      description?: string;
      rules?: string[];
      imageStyle?: string;
      coverPrompt?: string;
    };

    // Use custom prompt if provided, otherwise build from narrative context
    let imagePrompt: string;
    if (coverPrompt?.trim()) {
      imagePrompt = `${coverPrompt.trim()}. No text, no letters, no words, no watermarks.`;
    } else {
      const context = [description, rules?.length ? `World rules: ${rules.join('. ')}` : ''].filter(Boolean).join('. ');
      const styleDirective = imageStyle || 'Cinematic wide-angle digital painting, book cover art style';
      imagePrompt = `${styleDirective}. ${title}. ${context}. Dramatic lighting, rich atmosphere, high detail, no text, no letters, no words, no watermarks.`;
    }

    // Call Replicate Seedream 4.5 (create prediction)
    const response = await fetch('https://api.replicate.com/v1/models/bytedance/seedream-4.5/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        input: {
          prompt: imagePrompt,
          aspect_ratio: '3:4',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[generate-cover] Replicate error:', errorText);
      return NextResponse.json({ error: `Replicate error: ${errorText}` }, { status: response.status });
    }

    const prediction = await response.json();

    // Poll for completion (max 60 seconds)
    let pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;
    let attempts = 0;
    const maxAttempts = 60;
    let completedPrediction = prediction;

    while (attempts < maxAttempts) {
      if (completedPrediction.status === 'succeeded') break;
      if (completedPrediction.status === 'failed' || completedPrediction.status === 'canceled') {
        return NextResponse.json({
          error: `Cover generation ${completedPrediction.status}: ${completedPrediction.error || 'Unknown error'}`
        }, { status: 500 });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const pollRes = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${apiToken}` },
      });

      if (!pollRes.ok) {
        return NextResponse.json({ error: 'Failed to poll prediction status' }, { status: 500 });
      }

      completedPrediction = await pollRes.json();
    }

    if (completedPrediction.status !== 'succeeded') {
      return NextResponse.json({ error: 'Cover generation timed out' }, { status: 500 });
    }

    const replicateUrl = Array.isArray(completedPrediction.output) ? completedPrediction.output[0] : completedPrediction.output;

    if (!replicateUrl) {
      console.error('[generate-cover] Empty output from Replicate:', completedPrediction);
      return NextResponse.json({ error: 'No image URL in completed prediction' }, { status: 500 });
    }

    // Return the Replicate URL directly - client will download and store in IndexedDB
    return NextResponse.json({ imageUrl: replicateUrl });
  } catch (err) {
    console.error('[generate-cover] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
