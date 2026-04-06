'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { importFromPackage, getPackageInfo, validatePackage, formatBytes, type ImportOptions } from '@/lib/package-import';
import type { PackageManifest } from '@/lib/package-export';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useStore } from '@/lib/store';

type Props = {
  onClose: () => void;
};

type PreviewState = {
  file: File;
  manifest: PackageManifest;
  sizes: {
    narrative: number;
    embeddings: number;
    audio: number;
    images: number;
    total: number;
  };
  format: 'zip' | 'json';
};

export function ImportPackageModal({ onClose }: Props) {
  const router = useRouter();
  const { dispatch } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [options, setOptions] = useState<ImportOptions>({
    importEmbeddings: true,
    importAudio: true,
    importImages: true,
  });

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ status: '', percent: 0 });
  const [error, setError] = useState('');

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    // Validate package
    const validation = await validatePackage(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid package file');
      return;
    }

    // Get package info
    try {
      const info = await getPackageInfo(file);
      setPreview({
        file,
        manifest: info.manifest,
        sizes: info.sizes,
        format: info.format,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read package');
    }
  }

  async function handleImport() {
    if (!preview) return;

    setImporting(true);
    setError('');
    setProgress({ status: 'Starting...', percent: 0 });

    try {
      const narrative = await importFromPackage(preview.file, options, (status, percent) => {
        setProgress({ status, percent });
      });

      // Add to store
      dispatch({ type: 'LOADED_NARRATIVE', narrative });

      // Navigate to story
      router.push(`/series/${narrative.id}`);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-semibold text-text-primary">Import Story Package</h2>
      </ModalHeader>
      <ModalBody className="p-4 space-y-4">
        {/* File picker */}
        {!preview && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".inktide"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-6 border-2 border-dashed border-white/10 rounded-lg hover:border-white/20 hover:bg-white/3 transition-colors group"
            >
              <div className="flex flex-col items-center gap-2">
                <svg className="w-8 h-8 text-text-dim group-hover:text-text-secondary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <div className="text-[11px] text-text-secondary">
                  Click to select .inktide file
                </div>
              </div>
            </button>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-[10px] text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Preview */}
        {preview && !importing && (
          <>
            {/* Story info */}
            <div className="p-3 bg-white/3 rounded-lg border border-white/8">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="text-[12px] font-semibold text-text-primary">{preview.manifest.narrative.title}</h3>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim uppercase tracking-wider shrink-0">
                  {preview.format === 'zip' ? 'ZIP Package' : 'JSON'}
                </span>
              </div>
              <p className="text-[10px] text-text-dim">
                {preview.manifest.narrative.sceneCount} scenes · {preview.manifest.narrative.wordCount.toLocaleString()} words
              </p>
              <p className="text-[9px] text-text-dim/60 mt-1">
                Exported {new Date(preview.manifest.exported).toLocaleDateString()}
              </p>
            </div>

            {/* Asset selection - only for ZIP packages */}
            {preview.format === 'zip' && (preview.manifest.assets.embeddings > 0 || preview.manifest.assets.audio > 0 || preview.manifest.assets.images > 0) && (
              <div className="space-y-2">
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Import Assets</label>

              {preview.manifest.assets.embeddings > 0 && (
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={options.importEmbeddings}
                    onChange={(e) => setOptions({ ...options, importEmbeddings: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/30"
                  />
                  <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
                    {preview.manifest.assets.embeddings} embeddings ({formatBytes(preview.sizes.embeddings)})
                  </span>
                </label>
              )}

              {preview.manifest.assets.audio > 0 && (
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={options.importAudio}
                    onChange={(e) => setOptions({ ...options, importAudio: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/30"
                  />
                  <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
                    {preview.manifest.assets.audio} audio clips ({formatBytes(preview.sizes.audio)})
                  </span>
                </label>
              )}

              {preview.manifest.assets.images > 0 && (
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={options.importImages}
                    onChange={(e) => setOptions({ ...options, importImages: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/30"
                  />
                  <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
                    {preview.manifest.assets.images} images ({formatBytes(preview.sizes.images)})
                  </span>
                </label>
              )}
              </div>
            )}

            {/* Size info */}
            <div className="p-3 bg-white/3 rounded-lg border border-white/8 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-text-dim">Package size</span>
                <span className="text-text-secondary font-mono">{formatBytes(preview.sizes.total)}</span>
              </div>
            </div>

            {/* Change file button */}
            <button
              onClick={() => {
                setPreview(null);
                setError('');
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="text-[10px] text-text-dim hover:text-text-secondary transition-colors"
            >
              Choose different file
            </button>
          </>
        )}

        {/* Progress */}
        {importing && (
          <div className="space-y-2">
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-[10px] text-text-dim text-center">{progress.status}</p>
          </div>
        )}

        {/* Error during import */}
        {importing && error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-[10px] text-red-400">{error}</p>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          disabled={importing}
          className="text-[11px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleImport}
          disabled={!preview || importing}
          className="text-[11px] px-3 py-1.5 rounded-md bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-colors font-medium disabled:opacity-50"
        >
          {importing ? 'Importing...' : 'Import Package'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
