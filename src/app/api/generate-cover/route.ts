import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { logError, logInfo, logWarning } from '@/lib/system-logger';

export async function POST(req: NextRequest) {
  const apiToken = resolveKey(req, 'x-replicate-key', 'REPLICATE_API_TOKEN');
  if (!apiToken) {
    return NextResponse.json({ error: 'Replicate API token required' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const { title, description, rules, imageStyle, coverPrompt } = await req.json() as {
      title: string;
      description?: string;
      rules?: string[];
      imageStyle?: string;
      coverPrompt?: string;
    };
    logInfo('Cover generation request received', {
      source: 'image-generation',
      operation: 'cover-request',
      details: { title, hasCustomPrompt: !!coverPrompt?.trim(), hasCustomStyle: !!imageStyle },
    });

    // Build prompt: style leads → subject → context → safety
    const styleDirective = imageStyle || 'Cinematic wide-angle digital painting, book cover art style';
    const parts: string[] = [styleDirective];

    if (coverPrompt?.trim()) {
      parts.push(coverPrompt.trim());
    } else {
      parts.push(title);
      if (description) parts.push(description);
      if (rules?.length) parts.push(`World rules: ${rules.join('. ')}`);
      parts.push('Dramatic lighting, rich atmosphere, high detail');
    }

    parts.push('No text, no letters, no words, no watermarks');
    const imagePrompt = parts.join('. ');

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
      logError('Replicate prediction request failed', errorText, {
        source: 'image-generation',
        operation: 'cover-replicate-create',
        details: { status: response.status, title },
      });
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
        logError(`Replicate prediction ${completedPrediction.status}`, completedPrediction.error || 'Unknown error', {
          source: 'image-generation',
          operation: 'cover-replicate-poll',
          details: { status: completedPrediction.status, attempts, title },
        });
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
        logError('Failed to poll Replicate prediction status', `HTTP ${pollRes.status}`, {
          source: 'image-generation',
          operation: 'cover-replicate-poll',
          details: { attempts, title },
        });
        return NextResponse.json({ error: 'Failed to poll prediction status' }, { status: 500 });
      }

      completedPrediction = await pollRes.json();
    }

    if (completedPrediction.status !== 'succeeded') {
      logWarning('Cover generation timed out', `status=${completedPrediction.status} after ${attempts} attempts`, {
        source: 'image-generation',
        operation: 'cover-replicate-poll',
        details: { attempts, maxAttempts, title },
      });
      return NextResponse.json({ error: 'Cover generation timed out' }, { status: 500 });
    }

    const replicateUrl = Array.isArray(completedPrediction.output) ? completedPrediction.output[0] : completedPrediction.output;

    if (!replicateUrl) {
      logError('Empty output from Replicate', JSON.stringify(completedPrediction).slice(0, 500), {
        source: 'image-generation',
        operation: 'cover-replicate-result',
        details: { title },
      });
      return NextResponse.json({ error: 'No image URL in completed prediction' }, { status: 500 });
    }

    logInfo('Cover generated successfully', {
      source: 'image-generation',
      operation: 'cover-success',
      details: { title, durationMs: Date.now() - startedAt, attempts },
    });
    // Return the Replicate URL directly - client will download and store in IndexedDB
    return NextResponse.json({ imageUrl: replicateUrl });
  } catch (err) {
    logError('Cover generation failed', err, {
      source: 'image-generation',
      operation: 'cover-request',
      details: { durationMs: Date.now() - startedAt },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
