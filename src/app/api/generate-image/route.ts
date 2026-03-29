import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { DEFAULT_MODEL } from '@/lib/constants';

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
  scene: 'Manga page layout with multiple panels divided by black gutters, sequential storytelling, each panel captures a different beat of the scene, dramatic angles, speed lines, high contrast black and white ink with screentone shading',
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
    ? `\nIMPORTANT: Match this visual style: ${request.imageStyle}`
    : '';

  const systemPrompt = request.type === 'scene'
    ? `You are a manga storyboard artist. Given a scene description, produce an image generation prompt for a full manga PAGE with multiple panels. Describe the panel layout, what each panel shows (camera angle, characters, action), and manga techniques (speed lines, dramatic shadows, reaction close-ups, establishing wide shots). The panels should tell the scene as sequential visual storytelling. Output ONLY the prompt, nothing else.${styleDirective}`
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
    userPrompt = `Create a manga page prompt for this scene: "${request.summary}". Location: ${request.locationName}. Characters: ${charDescs || 'none specified'}. World: ${request.worldSummary}.

Describe a manga PAGE with 3-5 panels arranged vertically. For each panel describe: the camera angle (close-up, wide shot, over-shoulder, bird's eye), what's shown, and the emotion. The panels should flow as sequential storytelling — each panel captures a different beat of the scene. Include manga techniques: speed lines for action, dramatic shadows, reaction shots, establishing shots.`;
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

  try {
    const body = await req.json() as ImageRequest;

    // Step 1: Get or craft the visual prompt
    const visualPrompt = await describeVisually(openrouterKey, body);
    if (!visualPrompt) return NextResponse.json({ error: 'Failed to generate visual description' }, { status: 500 });

    // Build prompt: style → subject → composition → safety (consistent across all types)
    // Style ALWAYS leads — even with custom imagePrompt — to ensure visual consistency
    const parts: string[] = [];
    if (body.imageStyle) parts.push(body.imageStyle);
    parts.push(visualPrompt);
    parts.push(COMPOSITION[body.type]);
    parts.push('No text, no letters, no watermarks');
    const finalPrompt = parts.join('. ');
    const aspectRatio = ASPECT_RATIO[body.type];

    // Step 2: Generate image with Seedream 4.5
    const response = await fetch(REPLICATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${replicateToken}`,
        'Prefer': 'wait',
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
      return NextResponse.json({ error: `Replicate error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    const replicateUrl = Array.isArray(data.output) ? data.output[0] : data.output;

    if (!replicateUrl) {
      const status = data.status ?? 'unknown';
      const logs = data.logs ?? '';
      console.error('[generate-image] Empty output from Replicate:', { status, logs: logs.slice(0, 500), error: data.error });
      return NextResponse.json({ error: `No image generated (status: ${status}${data.error ? `, error: ${data.error}` : ''})` }, { status: 500 });
    }

    // Fetch the image and convert to base64 data URL so it persists in localStorage
    const imgRes = await fetch(replicateUrl);
    if (!imgRes.ok) return NextResponse.json({ error: 'Failed to fetch generated image' }, { status: 500 });
    const imgBuffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get('content-type') || 'image/webp';
    const base64 = Buffer.from(imgBuffer).toString('base64');
    const imageUrl = `data:${contentType};base64,${base64}`;

    return NextResponse.json({ imageUrl, visualPrompt });
  } catch (err) {
    console.error('[generate-image] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
