import React, { useRef, useEffect, useState } from "react";
import { Play, Pause, Square, Download, Sparkles, Volume2 } from "lucide-react";
import { audioBufferToWav } from "../utils/audioUtils";

interface CleanAudioPlayerProps {
  stitchedBuffer: AudioBuffer | null;
  onPlay?: () => void;
  isAnyOtherPlaying?: boolean;
}

export default function CleanAudioPlayer({ stitchedBuffer, onPlay, isAnyOtherPlaying }: CleanAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 600, height: 80 });
  const [peaks, setPeaks] = useState<number[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const pausedAtRef = useRef<number>(0);
  const playIntervalRef = useRef<number | null>(null);
  const justStartedRef = useRef<boolean>(false);

  // Auto-pause if parent audio starts playing
  useEffect(() => {
    if (isAnyOtherPlaying && isPlaying && !justStartedRef.current) {
      pausePlayback();
    }
  }, [isAnyOtherPlaying]);

  useEffect(() => {
    if (stitchedBuffer) {
      setDuration(stitchedBuffer.duration);
      setCurrentTime(0);
      setIsPlaying(false);
      pausedAtRef.current = 0;

      // Extract peaks for clean stitched buffer
      const channelData = stitchedBuffer.getChannelData(0);
      const step = Math.ceil(channelData.length / 300); // 300 points is perfect for the clean preview
      const newPeaks: number[] = [];
      for (let i = 0; i < 300; i++) {
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
    } else {
      setDuration(0);
      setCurrentTime(0);
      setIsPlaying(false);
      pausedAtRef.current = 0;
      setPeaks([]);
    }

    return () => {
      stopPlayback();
    };
  }, [stitchedBuffer]);

  // Set up resize observer for responsive canvas width
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width: Math.max(width, 300), height: 80 });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Redraw the clean waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0 || !stitchedBuffer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = dimensions;
    ctx.clearRect(0, 0, width, height);

    const barWidth = width / peaks.length;

    // Draw grid
    ctx.strokeStyle = "rgba(15, 23, 42, 0.4)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 10; i++) {
      const x = (i / 10) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw peaks
    peaks.forEach((peak, index) => {
      const x = index * barWidth;
      const barHeight = Math.max(2, peak * (height - 8));
      const y = (height - barHeight) / 2;
      const timeAtBar = (index / peaks.length) * duration;

      // Color active playback vs remaining
      if (timeAtBar <= currentTime) {
        ctx.fillStyle = "#10b981"; // vibrant emerald for played content
      } else {
        ctx.fillStyle = "rgba(16, 185, 129, 0.25)"; // muted translucent emerald for upcoming
      }

      ctx.beginPath();
      ctx.roundRect(x + 0.5, y, Math.max(1, barWidth - 1), barHeight, 1);
      ctx.fill();
    });

    // Draw Playhead
    const playheadX = (currentTime / duration) * width;
    if (playheadX >= 0 && playheadX <= width) {
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }
  }, [peaks, dimensions, currentTime, duration, stitchedBuffer]);

  const startPlayback = async (overrideOffset?: number) => {
    if (!stitchedBuffer) return;

    justStartedRef.current = true;
    setTimeout(() => {
      justStartedRef.current = false;
    }, 150);

    if (onPlay) {
      onPlay();
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      // Force context state to running
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const source = audioCtx.createBufferSource();
      source.buffer = stitchedBuffer;
      source.connect(audioCtx.destination);

      const offset = overrideOffset !== undefined ? overrideOffset : pausedAtRef.current;
      source.start(0, offset);
      sourceNodeRef.current = source;
      setIsPlaying(true);

      const playStartTime = performance.now();

      // Track playback position using absolute performance.now() elapsed milliseconds
      playIntervalRef.current = window.setInterval(() => {
        const elapsedSeconds = (performance.now() - playStartTime) / 1000;
        const currentProgress = offset + elapsedSeconds;

        if (currentProgress >= stitchedBuffer.duration) {
          stopPlayback();
          setCurrentTime(stitchedBuffer.duration);
        } else {
          setCurrentTime(currentProgress);
        }
      }, 30);

      source.onended = () => {
        // Automatically close context when buffer ends completely
        const elapsedSeconds = (performance.now() - playStartTime) / 1000;
        const currentProgress = offset + elapsedSeconds;
        if (currentProgress >= stitchedBuffer.duration - 0.1) {
          setIsPlaying(false);
          setCurrentTime(stitchedBuffer.duration);
          pausedAtRef.current = 0;
          if (playIntervalRef.current) {
            clearInterval(playIntervalRef.current);
          }
        }
      };
    } catch (e) {
      console.error("Failed to play stitched buffer", e);
    }
  };

  const pausePlayback = () => {
    if (!audioCtxRef.current || !sourceNodeRef.current) return;

    try {
      sourceNodeRef.current.stop();
    } catch (e) {}

    // Store state accurately
    pausedAtRef.current = currentTime;
    setIsPlaying(false);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch (err) {}
      audioCtxRef.current = null;
    }
  };

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {}
    }
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    pausedAtRef.current = 0;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !stitchedBuffer) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedPercentage = clickX / rect.width;
    const targetTime = clickedPercentage * stitchedBuffer.duration;
    const boundedTime = Math.max(0, Math.min(stitchedBuffer.duration, targetTime));

    const wasPlaying = isPlaying;

    // Stop current playback
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (err) {}
    }
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch (err) {}
      audioCtxRef.current = null;
    }

    pausedAtRef.current = boundedTime;
    setCurrentTime(boundedTime);

    if (wasPlaying) {
      startPlayback(boundedTime);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      if (currentTime >= duration) {
        pausedAtRef.current = 0;
        setCurrentTime(0);
      }
      startPlayback();
    }
  };

  const handleDownload = () => {
    if (!stitchedBuffer) return;

    try {
      const wavBlob = audioBufferToWav(stitchedBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spoken_word_cleaned_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("WAV download generation failed", e);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs.toFixed(2).padStart(5, "0")}`;
  };

  return (
    <div id="clean-audio-player-container" ref={containerRef} className="w-full bg-slate-900 border border-emerald-950/40 rounded-xl p-5 shadow-lg shadow-emerald-950/10 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse" />
          <h3 className="text-sm font-semibold text-slate-100 tracking-wide">
            Final Edited & Stitched Performance
          </h3>
        </div>
        <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
          <span>Stitched Duration:</span>
          <span className="text-emerald-400 font-semibold bg-emerald-950/60 border border-emerald-900/50 px-2 py-0.5 rounded">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      <div className="relative w-full h-[80px] bg-slate-950/65 rounded-lg overflow-hidden border border-slate-800/50 flex items-center justify-center">
        {!stitchedBuffer ? (
          <div className="text-xs text-slate-600 font-mono flex items-center gap-2">
            <Volume2 className="w-4 h-4 opacity-40" />
            <span>Generate keep intervals to compile final output</span>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              width={dimensions.width}
              height={dimensions.height}
              onClick={handleCanvasClick}
              className="w-full h-full cursor-pointer hover:opacity-95 transition-opacity"
              title="Click anywhere to seek/play from here"
            />
            <div className="absolute top-1.5 right-2 px-1.5 py-0.5 rounded bg-slate-900/60 border border-slate-800/40 text-[9px] font-mono text-emerald-400/80 pointer-events-none select-none tracking-wider">
              ⚡ Click waveform to seek
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mt-1">
        <div className="flex items-center gap-2">
          <button
            id="clean-play-btn"
            disabled={!stitchedBuffer}
            onClick={togglePlay}
            className={`flex items-center justify-center w-12 h-12 rounded-full cursor-pointer transition-all ${
              stitchedBuffer
                ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20 active:scale-95"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
            title={isPlaying ? "Pause preview" : "Play clean preview"}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-slate-950" /> : <Play className="w-5 h-5 fill-slate-950 ml-0.5" />}
          </button>

          <button
            id="clean-stop-btn"
            disabled={!stitchedBuffer || currentTime === 0}
            onClick={stopPlayback}
            className={`flex items-center justify-center w-10 h-10 rounded-full cursor-pointer transition-all ${
              stitchedBuffer && currentTime > 0
                ? "bg-slate-800 hover:bg-slate-700 text-slate-300"
                : "bg-slate-800/40 text-slate-600 cursor-not-allowed"
            }`}
            title="Stop playback"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>

          {stitchedBuffer && (
            <span className="text-xs font-mono text-slate-300 ml-2">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          )}
        </div>

        <button
          id="download-clean-audio-btn"
          disabled={!stitchedBuffer}
          onClick={handleDownload}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer ${
            stitchedBuffer
              ? "bg-slate-100 hover:bg-white text-slate-950 shadow active:scale-95"
              : "bg-slate-800/80 text-slate-500 cursor-not-allowed"
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Export Clean Master (.wav)</span>
        </button>
      </div>
    </div>
  );
}
