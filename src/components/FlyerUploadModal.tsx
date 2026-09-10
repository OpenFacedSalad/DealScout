import React, { useState } from 'react';
import { UploadCloud, FileText, Camera, Loader2, X, Check, Sparkles } from 'lucide-react';
import { Store, DealItem } from '../types';

interface FlyerUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  stores: Store[];
  onDealsImported: (importedDeals: DealItem[], storeId: string) => void;
}

export default function FlyerUploadModal({
  isOpen,
  onClose,
  stores,
  onDealsImported,
}: FlyerUploadModalProps) {
  const [selectedStoreId, setSelectedStoreId] = useState<string>(stores[0]?.id || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        setErrorMessage('Please upload a PDF or image file (JPEG, PNG, WebP).');
        return;
      }
      setSelectedFile(file);
      setErrorMessage(null);
    }
  };

  const handleProcessFlyer = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const selectedStore = stores.find((s) => s.id === selectedStoreId) || {
        id: 'scanned-store',
        name: 'Local Store',
        logoBg: '#0F172A',
        logoText: 'FLYER',
      };

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      reader.readAsDataURL(selectedFile);
      const fileDataUri = await base64Promise;

      const response = await fetch('/api/circulars/parse-flyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: fileDataUri,
          mimeType: selectedFile.type,
          storeId: selectedStore.id,
          storeName: selectedStore.name,
          logoBg: selectedStore.logoBg,
          logoText: selectedStore.logoText,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      if (!data.deals || data.deals.length === 0) {
        throw new Error('No readable grocery deals found in this circular.');
      }

      onDealsImported(data.deals, selectedStore.id);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to parse circular flyer.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white max-w-md w-full rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Import Weekly Circular</h2>
              <p className="text-xs text-slate-500">Multimodal PDF & Camera Photo OCR</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Select Supermarket Chain
            </label>
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              {stores.map((store, idx) => (
                <option key={store.id ? `store-opt-${store.id}` : `store-opt-${idx}`} value={store.id}>
                  {store.name} ({store.distanceMiles} mi)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Upload Flyer (PDF or Photo)
            </label>
            <label className="border-2 border-dashed border-slate-200 hover:border-emerald-500/50 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition bg-slate-50/50 hover:bg-emerald-50/10">
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              {selectedFile ? (
                <div className="text-center">
                  <FileText className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-800 truncate max-w-[220px]">
                    {selectedFile.name}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              ) : (
                <div className="text-center">
                  <div className="flex justify-center space-x-2 text-slate-400 mb-2">
                    <UploadCloud className="w-7 h-7" />
                    <Camera className="w-7 h-7" />
                  </div>
                  <p className="text-xs font-semibold text-slate-700">
                    Drop circular PDF or snap a photo
                  </p>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Parses Karns butcher specials, ALDI Super 6, and Giant flyers
                  </span>
                </div>
              )}
            </label>
          </div>

          {errorMessage && (
            <p className="text-xs font-medium text-rose-600">{errorMessage}</p>
          )}

          <button
            onClick={handleProcessFlyer}
            disabled={!selectedFile || isProcessing}
            className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center space-x-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Gemini 3.7 Flash Extracting Deals...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Parse Live Flyer Prices</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
