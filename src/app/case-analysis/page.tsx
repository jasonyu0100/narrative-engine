"use client";

import { SlidesPlayer } from "@/components/slides/SlidesPlayer";
import { PropositionClassificationProvider } from "@/hooks/usePropositionClassification";
import { assetManager } from "@/lib/asset-manager";
import { resolveEntrySequence } from "@/lib/narrative-utils";
import { useStore, withDerivedEntities } from "@/lib/store";
import type { NarrativeState } from "@/types/narrative";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ExamplePage() {
  const router = useRouter();
  const { dispatch } = useStore();
  const [narrative, setNarrative] = useState<NarrativeState | null>(null);
  const [resolvedKeys, setResolvedKeys] = useState<string[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(
          `/works/harry_potter_and_the_sorcerer_s_stone.inktide`,
        );
        if (!r.ok) throw new Error("Failed to load");
        const arrayBuffer = await r.arrayBuffer();
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(arrayBuffer);
        const narrativeFile = zip.file("narrative.json");
        if (!narrativeFile)
          throw new Error("Missing narrative.json in package");
        const text = await narrativeFile.async("text");
        const data = JSON.parse(text) as NarrativeState;

        // Import embeddings from package into IndexedDB so classification can resolve them
        const embeddingsFolder = zip.folder("embeddings");
        if (embeddingsFolder) {
          const files = Object.values(embeddingsFolder.files).filter(
            (f) => !f.dir && f.name.endsWith(".bin"),
          );
          for (const file of files) {
            const fileName = file.name.split("/").pop()!;
            const embId = fileName.replace(".bin", "");
            const buffer = await file.async("arraybuffer");
            const float32Array = new Float32Array(buffer);
            await assetManager.storeEmbedding(
              Array.from(float32Array),
              "text-embedding-3-small",
              embId,
            );
          }
        }

        const rootBranch = Object.values(data.branches).find(
          (b) => b.parentBranchId === null,
        );
        const keys = rootBranch
          ? resolveEntrySequence(data.branches, rootBranch.id)
          : Object.keys(data.scenes);
        const allKeys = [
          ...Object.keys(data.scenes),
          ...Object.keys(data.worldBuilds),
        ];
        setNarrative(withDerivedEntities(data, keys));
        setResolvedKeys(allKeys);
      } catch {
        setError(true);
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="fixed inset-0 z-100 bg-bg-base flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-dim mb-4">Failed to load example data.</p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 rounded-lg bg-white/10 text-text-primary text-sm hover:bg-white/15"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!narrative) {
    return (
      <div className="fixed inset-0 z-100 bg-bg-base flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-white/20 border-t-amber-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-dim text-sm">
            Loading example analysis&hellip;
          </p>
        </div>
      </div>
    );
  }

  return (
    <PropositionClassificationProvider
      narrative={narrative}
      resolvedKeys={resolvedKeys}
    >
      <SlidesPlayer
        narrative={narrative}
        resolvedKeys={resolvedKeys}
        onClose={() => {
          dispatch({ type: "SET_ACTIVE_NARRATIVE", id: narrative.id });
          router.push(`/series/${narrative.id}`);
        }}
      />
    </PropositionClassificationProvider>
  );
}
