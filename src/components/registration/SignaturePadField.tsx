'use client';

import { useEffect, useRef } from 'react';
import SignaturePad from 'signature_pad';
import { Button } from '@/components/ui/button';
import { Eraser } from 'lucide-react';

interface SignaturePadFieldProps {
  /** PNG data URL of the current signature; '' when blank */
  value?: string;
  onChange: (dataUrl: string) => void;
}

/**
 * Draw-to-sign canvas that works with mouse, trackpad, finger, and stylus
 * (signature_pad uses pointer events and sets touch-action: none so the
 * page doesn't scroll mid-stroke on phones).
 */
export function SignaturePadField({ value, onChange }: SignaturePadFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Latest drawing, used to restore after a resize (e.g. phone rotation) clears the canvas
  const lastDrawnRef = useRef(value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePad(canvas, { penColor: '#1a1a2e' });
    padRef.current = pad;
    pad.addEventListener('endStroke', () => {
      const dataUrl = pad.isEmpty() ? '' : pad.toDataURL('image/png');
      lastDrawnRef.current = dataUrl;
      onChangeRef.current(dataUrl);
    });

    // Size the backing store for the device pixel ratio so strokes aren't
    // blurry on phones; resizing clears the canvas, so restore afterwards.
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      const existing = lastDrawnRef.current;
      if (existing) pad.fromDataURL(existing, { ratio });
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      pad.off();
      padRef.current = null;
    };
  }, []);

  const handleClear = () => {
    padRef.current?.clear();
    lastDrawnRef.current = '';
    onChangeRef.current('');
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border bg-white">
        <canvas ref={canvasRef} className="w-full h-36 rounded-xl" />
        {!value && (
          <span className="absolute inset-x-0 bottom-3 text-center text-xs text-muted-foreground pointer-events-none">
            Sign here
          </span>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={handleClear} disabled={!value}>
          <Eraser className="h-3.5 w-3.5 mr-1.5" />
          Clear Signature
        </Button>
      </div>
    </div>
  );
}
