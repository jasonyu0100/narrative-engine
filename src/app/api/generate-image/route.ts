import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { DEFAULT_MODEL } from '@/lib/constants';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REPLICATE_URL = 'https://api.replicate.com/v1/models/bytedance/seedream-4.5/predictions';

type ImageRequest =
  | { type: 'character'; name: string; role: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'location'; name: string; parentName?: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'scene'; summary: string; locationName: string; characterDescriptions: { name: string; visualDescription: string }[]; worldSummary: string; imageStyle?: string };

/** Use LLM to craft a rich visual description for image generation */
async function describeVisually(openrouterKey: string, request: ImageRequest): Promise<string> {
  // If an imagePrompt already exists for character/location, use it directly
  if (request.type !== 'scene' && request.imagePrompt) {
    return request.imagePrompt;
  }

  const styleDirective = request.imageStyle
    ? `\nIMPORTANT: Match this visual style: ${request.imageStyle}`
    : '';

  const systemPrompt = `You are a visual description specialist. Given narrative context, produce a single concise image generation prompt (2-3 sentences max). Focus on visual details: appearance, clothing, atmosphere, lighting, color palette. Never include text, words, or watermarks in the description. Output ONLY the prompt, nothing else.${styleDirective}`;

  let userPrompt: string;
  if (request.type === 'character') {
    userPrompt = `Create a character portrait prompt for "${request.name}" (role: ${request.role}) in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}. IMPORTANT: Single character only, one person, head and shoulders portrait.`;
  } else if (request.type === 'location') {
    const parent = request.parentName ? ` (inside ${request.parentName})` : '';
    userPrompt = `Create an establishing shot prompt for the location "${request.name}"${parent} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else {
    const charDescs = request.characterDescriptions
      .map((c) => `${c.name}: ${c.visualDescription}`)
      .join('. ');
    userPrompt = `Create a scene image prompt for: "${request.summary}". Location: ${request.locationName}. Characters present: ${charDescs || 'none specified'}. World: ${request.worldSummary}.`;
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

    // Append style directive if present and not already baked into imagePrompt
    const styleAppend = body.imageStyle && !(body.type !== 'scene' && 'imagePrompt' in body && body.imagePrompt)
      ? `, ${body.imageStyle}`
      : '';
    const singleCharSuffix = body.type === 'character' ? ', solo character, one person only, single subject' : '';
    const suffix = singleCharSuffix + ', no text, no letters, no words, no watermarks';
    const aspectRatio = body.type === 'character' ? '3:4' : body.type === 'location' ? '16:9' : '16:9';

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
          prompt: visualPrompt + styleAppend + suffix,
          num_outputs: 1,
          aspect_ratio: aspectRatio,
          output_format: 'webp',
          output_quality: 80,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Replicate error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    const replicateUrl = Array.isArray(data.output) ? data.output[0] : data.output;

    if (!replicateUrl) return NextResponse.json({ error: 'No image generated' }, { status: 500 });

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
