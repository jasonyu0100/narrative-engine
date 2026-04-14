import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { DEFAULT_MODEL } from '@/lib/constants';
import { logError, logInfo, logWarning } from '@/lib/system-logger';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REPLICATE_URL = 'https://api.replicate.com/v1/models/bytedance/seedream-4.5/predictions';

type ImageRequest =
  | { type: 'character'; name: string; role: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'location'; name: string; parentName?: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'scene'; summary: string; locationName: string; characterDescriptions: { name: string; visualDescription: string }[]; worldSummary: string; imageStyle?: string };

/** Composition guidance per image type */
/** Composition guidance per image type */
const COMPOSITION: Record<ImageRequest['type'], string> = {
  character: 'Single character portrait, head and shoulders, one subject only',
  location: 'Wide establishing shot, architectural or landscape composition',
  scene: 'Coloured manga page layout with multiple panels divided by black gutters, sequential storytelling, each panel captures a different beat of the scene, dramatic angles, speed lines, vibrant colours, cel shading',
};

/** Aspect ratio per image type */
const ASPECT_RATIO: Record<ImageRequest['type'], string> = {
  character: '3:4',
  location: '16:9',
  scene: '2:3',
};

/** Use LLM to craft a rich visual description for image generation */
async function describeVisually(openrouterKey: string, request: ImageRequest): Promise<string> {
  // If an imagePrompt already exists for character/location, use it directly
  if (request.type !== 'scene' && request.imagePrompt) {
    return request.imagePrompt;
  }

  const styleDirective = request.imageStyle
    ? `\nIMPORTANT: The primary visual style is: ${request.imageStyle}. The coloured manga format (panels, cel shading, sequential storytelling) augments this style.`
    : '';

  const systemPrompt = request.type === 'scene'
    ? `You are a manga storyboard artist. Given a scene description, produce an image generation prompt for a full COLOURED manga PAGE with multiple panels. If a custom style is specified, that style takes precedence and the manga format (panels, cel shading, sequential storytelling) augments it. Describe the panel layout, what each panel shows (camera angle, characters, action), colour palette, and manga techniques (speed lines, dramatic lighting, reaction close-ups, establishing wide shots). Output ONLY the prompt, nothing else.${styleDirective}`
    : `You are a visual description specialist. Given narrative context, produce a single concise image generation prompt (2-3 sentences max). Focus on visual details: appearance, clothing, atmosphere, lighting, color palette. Never include text, words, or watermarks in the description. Output ONLY the prompt, nothing else.${styleDirective}

COMPOSITION: ${COMPOSITION[request.type]}`;

  let userPrompt: string;
  if (request.type === 'character') {
    userPrompt = `Create a character portrait prompt for "${request.name}" (role: ${request.role}) in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else if (request.type === 'location') {
    const parent = request.parentName ? ` (inside ${request.parentName})` : '';
    userPrompt = `Create an establishing shot prompt for the location "${request.name}"${parent} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else {
    const charDescs = request.characterDescriptions
      .map((c) => `${c.name}: ${c.visualDescription}`)
      .join('. ');
    userPrompt = `Create a coloured manga page prompt for this scene: "${request.summary}". Location: ${request.locationName}. Characters: ${charDescs || 'none specified'}. World: ${request.worldSummary}.

Describe a manga PAGE with 3-5 panels arranged vertically. For each panel describe: the camera angle (close-up, wide shot, over-shoulder, bird's eye), what's shown, the colour palette, and the emotion. The panels should flow as sequential storytelling — each panel captures a different beat of the scene. Include manga techniques: speed lines for action, dramatic lighting, reaction shots, establishing shots. Use vibrant colours with cel shading.`;
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Narrative Engine',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 300,
    }),
  });

  if (!res.ok) throw new Error(`LLM error: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function POST(req: NextRequest) {
  const replicateToken = resolveKey(req, 'x-replicate-key', 'REPLICATE_API_TOKEN');
  const openrouterKey = resolveKey(req, 'x-openrouter-key', 'OPENROUTER_API_KEY');

  if (!replicateToken) return NextResponse.json({ error: 'Replicate API token required' }, { status: 401 });
  if (!openrouterKey) return NextResponse.json({ error: 'OpenRouter API key required' }, { status: 401 });

  const startedAt = Date.now();
  try {
    const body = await req.json() as ImageRequest;
    logInfo(`Image generation request received`, {
      source: 'image-generation',
      operation: 'request',
      details: { type: body.type, hasCustomStyle: !!body.imageStyle },
    });

    // Step 1: Get or craft the visual prompt
    const visualPrompt = await describeVisually(openrouterKey, body);
    if (!visualPrompt) {
      logWarning('Failed to generate visual description', 'empty visual prompt', {
        source: 'image-generation',
        operation: 'describe-visually',
        details: { type: body.type },
      });
      return NextResponse.json({ error: 'Failed to generate visual description' }, { status: 500 });
    }

    // Build prompt: style → subject → composition → safety (consistent across all types)
    // Style ALWAYS leads — even with custom imagePrompt — to ensure visual consistency
    const parts: string[] = [];
    if (body.imageStyle) parts.push(body.imageStyle);
    parts.push(visualPrompt);
    parts.push(COMPOSITION[body.type]);
    parts.push('No text, no letters, no watermarks');
    const finalPrompt = parts.join('. ');
    const aspectRatio = ASPECT_RATIO[body.type];

    // Step 2: Generate image with Seedream 4.5 (create prediction)
    const response = await fetch(REPLICATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${replicateToken}`,
      },
      body: JSON.stringify({
        input: {
          prompt: finalPrompt,
          aspect_ratio: aspectRatio,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Replicate prediction request failed', errorText, {
        source: 'image-generation',
        operation: 'replicate-create',
        details: { status: response.status, type: body.type },
      });
      return NextResponse.json({ error: `Replicate error: ${errorText}` }, { status: response.status });
    }

    const prediction = await response.json();

    // Step 3: Poll for completion (max 60 seconds)
    let pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds
    let completedPrediction = prediction;

    while (attempts < maxAttempts) {
      if (completedPrediction.status === 'succeeded') break;
      if (completedPrediction.status === 'failed' || completedPrediction.status === 'canceled') {
        logError(`Replicate prediction ${completedPrediction.status}`, completedPrediction.error || 'Unknown error', {
          source: 'image-generation',
          operation: 'replicate-poll',
          details: { status: completedPrediction.status, attempts, type: body.type },
        });
        return NextResponse.json({
          error: `Image generation ${completedPrediction.status}: ${completedPrediction.error || 'Unknown error'}`
        }, { status: 500 });
      }

      // Wait 1 second before polling
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const pollRes = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${replicateToken}` },
      });

      if (!pollRes.ok) {
        logError('Failed to poll Replicate prediction status', `HTTP ${pollRes.status}`, {
          source: 'image-generation',
          operation: 'replicate-poll',
          details: { attempts, type: body.type },
        });
        return NextResponse.json({ error: 'Failed to poll prediction status' }, { status: 500 });
      }

      completedPrediction = await pollRes.json();
    }

    if (completedPrediction.status !== 'succeeded') {
      logWarning('Image generation timed out', `status=${completedPrediction.status} after ${attempts} attempts`, {
        source: 'image-generation',
        operation: 'replicate-poll',
        details: { attempts, maxAttempts, type: body.type },
      });
      return NextResponse.json({ error: 'Image generation timed out' }, { status: 500 });
    }

    const replicateUrl = Array.isArray(completedPrediction.output) ? completedPrediction.output[0] : completedPrediction.output;

    if (!replicateUrl) {
      logError('Empty output from Replicate', JSON.stringify(completedPrediction).slice(0, 500), {
        source: 'image-generation',
        operation: 'replicate-result',
        details: { type: body.type },
      });
      return NextResponse.json({ error: 'No image URL in completed prediction' }, { status: 500 });
    }

    logInfo(`Image generated successfully`, {
      source: 'image-generation',
      operation: 'success',
      details: { type: body.type, durationMs: Date.now() - startedAt, attempts },
    });
    // Return the Replicate URL directly - client will download and store in IndexedDB
    return NextResponse.json({ imageUrl: replicateUrl, visualPrompt });
  } catch (err) {
    logError('Image generation failed', err, {
      source: 'image-generation',
      operation: 'request',
      details: { durationMs: Date.now() - startedAt },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
