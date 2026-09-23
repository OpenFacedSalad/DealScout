import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Code2,
  Copy,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Bell,
  Terminal,
} from 'lucide-react';
import PushNotificationTester from './DevTools';

interface DocViewerModalProps {
  isOpen: boolean;
  initialDoc?: 'design' | 'code' | 'devtools';
  onClose: () => void;
}

export default function DocViewerModal({
  isOpen,
  initialDoc = 'design',
  onClose,
}: DocViewerModalProps) {
  const [selectedDoc, setSelectedDoc] = useState<'design' | 'code' | 'devtools'>(initialDoc);
  const [content, setContent] = useState<Record<'design' | 'code', string>>({
    design: '',
    code: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSelectedDoc(initialDoc);
  }, [initialDoc]);

  useEffect(() => {
    if (!isOpen || selectedDoc === 'devtools') return;

    let isMounted = true;
    const targetFile = selectedDoc === 'design' ? '/DESIGN_DOCUMENT.txt' : '/CODE_STRUCTURE.txt';

    if (content[selectedDoc]) return;

    setIsLoading(true);
    fetch(targetFile)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (isMounted) {
          setContent((prev) => ({ ...prev, [selectedDoc]: text }));
        }
      })
      .catch((err) => {
        if (isMounted) {
          setContent((prev) => ({
            ...prev,
            [selectedDoc]: `Unable to load documentation from ${targetFile}.\nError: ${err.message}`,
          }));
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedDoc, content]);

  if (!isOpen) return null;

  const currentContent = selectedDoc !== 'devtools' ? content[selectedDoc] : '';
  const currentFileName = selectedDoc === 'design' ? 'DESIGN_DOCUMENT.txt' : selectedDoc === 'code' ? 'CODE_STRUCTURE.txt' : 'DevTools';

  const handleCopy = async () => {
    if (!currentContent) return;
    try {
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy document:', err);
    }
  };

  const handleDownload = () => {
    if (!currentContent) return;
    const blob = new Blob([currentContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-5xl h-[88vh] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70 flex-wrap gap-2">
          <div className="flex items-center space-x-3">
            <div className="flex items-center bg-slate-200/80 p-1 rounded-xl">
              <button
                onClick={() => setSelectedDoc('design')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  selectedDoc === 'design'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-emerald-600" />
                <span>System Design</span>
              </button>

              <button
                onClick={() => setSelectedDoc('code')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  selectedDoc === 'code'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Code2 className="w-3.5 h-3.5 text-teal-600" />
                <span>Code Structure</span>
              </button>

              <button
                onClick={() => setSelectedDoc('devtools')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  selectedDoc === 'devtools'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Bell className="w-3.5 h-3.5 text-amber-500" />
                <span>Dev Tools & Push</span>
              </button>
            </div>
            {selectedDoc !== 'devtools' && (
              <span className="text-xs text-slate-400 font-mono hidden md:inline">
                /{currentFileName}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {selectedDoc !== 'devtools' && (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
                  title="Copy entire document to clipboard for Gemini chat"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy for Gemini</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleDownload}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition hidden sm:inline-flex"
                  title="Download text file"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Download</span>
                </button>

                <a
                  href={`/${currentFileName}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition hidden sm:block"
                  title="Open raw file in new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 sm:p-6 bg-slate-950 overflow-y-auto">
          {selectedDoc === 'devtools' ? (
            <div className="max-w-xl mx-auto space-y-4 pt-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                <div className="flex items-center space-x-2 text-emerald-400 font-bold mb-1 text-sm">
                  <Terminal className="w-4 h-4" />
                  <span>Native OS Push Notification Test</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Schedule a real native system notification with a 5-second delay so you can background the app or switch tabs to verify native banner and vibration triggers.
                </p>
                <PushNotificationTester />
              </div>
            </div>
          ) : isLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
              <p className="text-xs font-mono">Loading documentation stream...</p>
            </div>
          ) : (
            <pre className="font-mono text-xs sm:text-[13px] text-slate-200 whitespace-pre-wrap leading-relaxed select-text">
              {currentContent}
            </pre>
          )}
        </div>

        <div className="px-6 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>
            Target Stack: React 18 &bull; Express 4 &bull; Vite &bull; Gemini 3.7 Flash &bull; Overpass API
          </span>
          <span className="font-mono">UTF-8 Plaintext</span>
        </div>
      </div>
    </div>
  );
}

