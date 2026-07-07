import React, { useRef, useEffect, useState } from "react";
import { AudioSegment } from "../types";

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  segments: AudioSegment[];
  currentTime: number;
  onSeek: (time: number) => void;
  selectionStart: number | null;
  selectionEnd: number | null;
  onSelectionChange: (start: number | null, end: number | null) => void;
}

export default function WaveformVisualizer({
  audioBuffer,
  segments,
  currentTime,
  onSeek,
  selectionStart,
  selectionEnd,
  onSelectionChange,
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 120 });
  const [peaks, setPeaks] = useState<number[]>([]);

  // Drag selection state
  const [dragStartPercent, setDragStartPercent] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Update dimensions based on container width
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width: Math.max(width, 300), height: 120 });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Compute audio peaks once when buffer changes
  useEffect(() => {
    if (!audioBuffer) {
      setPeaks([]);
      return;
    }

    const channelData = audioBuffer.getChannelData(0); // use mono/left channel
    const step = Math.ceil(channelData.length / 500); // 500 points
    const newPeaks: number[] = [];

    for (let i = 0; i < 500; i++) {
      let max = 0;
      const startIdx = i * step;
      const endIdx = Math.min(startIdx + step, channelData.length);
      for (let j = startIdx; j < endIdx; j++) {
        const val = Math.abs(channelData[j]);
        if (val > max) max = val;
      }
      newPeaks.push(max);
    }
    setPeaks(newPeaks);
  }, [audioBuffer]);

  // Redraw canvas on peaks, dimensions, currentTime, segments, or selection changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0 || !audioBuffer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = dimensions;
    ctx.clearRect(0, 0, width, height);

    const duration = audioBuffer.duration;
    const barWidth = width / peaks.length;

    // Draw grid/background lines
    ctx.strokeStyle = "rgba(30, 41, 59, 0.5)"; // slate-800
    ctx.lineWidth = 1;
    for (let sec = 1; sec < duration; sec++) {
      if (sec % 5 === 0 || duration < 15) {
        const x = (sec / duration) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Render bars
    peaks.forEach((peak, index) => {
      const x = index * barWidth;
      const barHeight = Math.max(3, peak * (height - 10));
      const y = (height - barHeight) / 2;
      const timeAtBar = (index / peaks.length) * duration;

      // Find if this bar is inside a kept segment, discarded segment, or none
      let isKept = false;
      let isCut = false;
      let matchedSegment = false;

      for (const seg of segments) {
        if (timeAtBar >= seg.start && timeAtBar <= seg.end) {
          matchedSegment = true;
          if (seg.keep) {
            isKept = true;
          } else {
            isCut = true;
          }
          break;
        }
      }

      // Choose color based on status
      if (matchedSegment) {
        if (isKept) {
          ctx.fillStyle = "rgba(16, 185, 129, 0.75)"; // emerald-500
        } else {
          ctx.fillStyle = "rgba(239, 68, 68, 0.4)"; // muted red-500
        }
      } else {
        // Unanalyzed / idle segments
        ctx.fillStyle = "rgba(148, 163, 184, 0.6)"; // slate-400
      }

      // Draw rounded rect bar
      ctx.beginPath();
      ctx.roundRect(x + 1, y, Math.max(1, barWidth - 1.5), barHeight, 2);
      ctx.fill();
    });

    // Draw Selection Highlight
    if (selectionStart !== null && selectionEnd !== null) {
      const minSel = Math.min(selectionStart, selectionEnd);
      const maxSel = Math.max(selectionStart, selectionEnd);
      const xStart = (minSel / duration) * width;
      const xEnd = (maxSel / duration) * width;

      // Fill selection range
      ctx.fillStyle = "rgba(14, 165, 233, 0.18)"; // sky-500 translucent
      ctx.fillRect(xStart, 0, xEnd - xStart, height);

      // Selection vertical border lines
      ctx.strokeStyle = "rgba(14, 165, 233, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xStart, 0);
      ctx.lineTo(xStart, height);
      ctx.moveTo(xEnd, 0);
      ctx.lineTo(xEnd, height);
      ctx.stroke();

      // Small center label
      const centerX = (xStart + xEnd) / 2;
      ctx.fillStyle = "rgba(14, 165, 233, 0.9)";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("SELECTED RANGE", centerX, 16);
    }

    // Draw Playhead cursor
    const playheadX = (currentTime / duration) * width;
    if (playheadX >= 0 && playheadX <= width) {
      // Playhead line
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
      ctx.shadowBlur = 0; // reset

      // Playhead triangle handle at top
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(playheadX - 5, 0);
      ctx.lineTo(playheadX + 5, 0);
      ctx.lineTo(playheadX, 6);
      ctx.fill();
    }
  }, [peaks, dimensions, currentTime, segments, audioBuffer, selectionStart, selectionEnd]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedPercentage = clickX / rect.width;

    setDragStartPercent(clickedPercentage);
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || dragStartPercent === null || !canvasRef.current || !audioBuffer) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentPercentage = Math.max(0, Math.min(1, currentX / rect.width));

    const duration = audioBuffer.duration;
    const t1 = dragStartPercent * duration;
    const t2 = currentPercentage * duration;

    onSelectionChange(Math.min(t1, t2), Math.max(t1, t2));
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || dragStartPercent === null || !canvasRef.current || !audioBuffer) {
      setIsDragging(false);
      setDragStartPercent(null);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedPercentage = Math.max(0, Math.min(1, clickX / rect.width));

    const dragDistance = Math.abs(clickX - (dragStartPercent * rect.width));
    const duration = audioBuffer.duration;

    if (dragDistance < 5) {
      // It's a simple click/seek! Clear selection and seek.
      onSelectionChange(null, null);
      onSeek(clickedPercentage * duration);
    } else {
      // It's a drag selection!
      const t1 = dragStartPercent * duration;
      const t2 = clickedPercentage * duration;
      onSelectionChange(Math.min(t1, t2), Math.max(t1, t2));
    }

    setIsDragging(false);
    setDragStartPercent(null);
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = (secs % 60).toFixed(1);
    return `${mins}:${remainingSecs.padStart(4, "0")}`;
  };

  return (
    <div ref={containerRef} className="w-full flex flex-col gap-2">
      <div className="flex justify-between items-center text-xs font-mono text-slate-400">
        <span>Original Waveform & Splice Ranges</span>
        <span className="text-slate-200 bg-slate-800 px-2 py-0.5 rounded">
          {formatTime(currentTime)} / {audioBuffer ? formatTime(audioBuffer.duration) : "0:00.0"}
        </span>
      </div>

      <div className="relative w-full h-[120px] bg-slate-950/95 rounded-xl border border-slate-800/80 overflow-hidden shadow-inner cursor-pointer group">
        {!audioBuffer && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-500">
            Upload or record audio to view timeline
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="absolute inset-0 w-full h-full"
        />

        {audioBuffer && (
          <div className="absolute bottom-2 left-2 flex gap-3 text-[10px] font-mono text-slate-400 bg-slate-900/80 backdrop-blur-sm px-2 py-1 rounded border border-slate-800 pointer-events-none">
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-emerald-500/80 rounded" />
              <span>Keep</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-red-500/40 rounded" />
              <span>Discard</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-sky-400/80 pl-2 border-l border-slate-800">
              🖱️ Drag to select a segment
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
