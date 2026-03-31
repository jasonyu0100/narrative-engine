import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const CHUNK_SIZE = 4000; // leave headroom under 4096

/** Split text into chunks ≤ CHUNK_SIZE characters, breaking on sentence boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > CHUNK_SIZE) {
    // Find last sentence boundary within the limit
    const slice = remaining.slice(0, CHUNK_SIZE);
    const lastBreak = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf('\n'),
    );
    const cutAt = lastBreak > CHUNK_SIZE / 2 ? lastBreak + 1 : CHUNK_SIZE;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function synthesiseChunk(text: string, voice: string, model: string, apiKey: string): Promise<ArrayBuffer> {
  const res = await fetch(OPENAI_TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text, voice }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS failed: ${err}`);
  }

  return res.arrayBuffer();
}

export async function POST(req: NextRequest) {
  const apiKey = resolveKey(req, 'x-openai-key', 'OPENAI_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenAI API key required' }, { status: 401 });
  }

  try {
    const body = await req.json() as { voice?: string; model?: string; text: string };
    const voice = body.voice || 'nova';
    const model = body.model || 'tts-1';
    const chunks = chunkText(body.text);

    // Synthesise all chunks in parallel
    const buffers = await Promise.all(
      chunks.map((chunk) => synthesiseChunk(chunk, voice, model, apiKey))
    );

    // Concatenate MP3 buffers (MP3 is safely byte-concatenable)
    const totalBytes = buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const buf of buffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    return new NextResponse(combined, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(totalBytes),
      },
    });
  } catch (err) {
    console.error('[generate-audio]', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
