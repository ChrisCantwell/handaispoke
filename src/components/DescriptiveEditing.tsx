import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  Trash2,
  History,
  CheckCircle2,
  AlertCircle,
  Clock,
  HelpCircle,
  Sliders,
  Maximize2,
  ChevronRight,
  Info
} from "lucide-react";
import { sliceAudioBuffer, concatenateAudioBuffers, audioBufferToWav } from "../utils/audioUtils";

interface DescriptiveEditingProps {
  audioBuffer: AudioBuffer | null;
  originalFile: {
    name: string;
    type: string;
    base64?: string;
  } | null;
  onApplyDescriptive: (newBuffer: AudioBuffer, newBase64: string) => void;
  addLog: (
    level: "info" | "warn" | "error" | "success",
    category: "click" | "action" | "api" | "browser" | "server",
    message: string,
    details?: any
  ) => void;
}

interface ChatMessage {
  id: string;
  sender: "user" | "ai" | "system";
  text: string;
  timestamp: string;
  operation?: {
    type: string;
    params: any;
  };
}

export default function DescriptiveEditing({
  audioBuffer,
  originalFile,
  onApplyDescriptive,
  addLog
}: DescriptiveEditingProps) {
  // Selection ranges (in seconds)
  const [startSec, setStartSec] = useState<number>(0);
  const [endSec, setEndSec] = useState<number>(0);
  const totalDuration = audioBuffer ? audioBuffer.duration : 0;

  // Selection duration calculation
  const selectionDuration = Math.max(0, endSec - startSec);

  // Input prompt
  const [prompt, setPrompt] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Chat message history
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Track modification history for undo stack
  const [historyStack, setHistoryStack] = useState<AudioBuffer[]>([]);
  const [activeBuffer, setActiveBuffer] = useState<AudioBuffer | null>(null);

  // Audio Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSelectionOnly, setPlaySelectionOnly] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  // Waveform visualization Peaks
  const [peaks, setPeaks] = useState<number[]>([]);

  // Refs for Web Audio API playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartRealTimeRef = useRef<number>(0);
  const pauseTimeOffsetRef = useRef<number>(0);
  const playTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initialize activeBuffer when audioBuffer changes
  useEffect(() => {
    if (audioBuffer) {
      setActiveBuffer(audioBuffer);
      setEndSec(audioBuffer.duration);
      setStartSec(0);
      
      // Extract peaks for drawing
      const channelData = audioBuffer.getChannelData(0);
      const step = Math.ceil(channelData.length / 150);
      const extracted: number[] = [];
      for (let i = 0; i < 150; i++) {
        let max = 0;
        const start = i * step;
        const end = Math.min(start + step, channelData.length);
        for (let j = start; j < end; j++) {
          const val = Math.abs(channelData[j]);
          if (val > max) max = val;
        }
        extracted.push(max);
      }
      setPeaks(extracted);

      // Add welcoming message if list is empty
      if (messages.length === 0) {
        setMessages([
          {
            id: "msg-welcome",
            sender: "ai",
            text: `Welcome to the Gemini-Powered Audio Editing Studio! I can interpret natural language commands and apply precise local DSP operations to your selection. Highlight a portion of the timeline above, and try command words like: "muffle", "fade out", "telephone voice", "make it louder", "reverse", or "pitch shift up".`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    }
  }, [audioBuffer]);

  // Handle waveform canvas rendering with selection highlighting
  useEffect(() => {
    if (!canvasRef.current || peaks.length === 0 || !activeBuffer) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barWidth = Math.floor(width / peaks.length) - 1;
    const selectionStartIndex = Math.floor((startSec / totalDuration) * peaks.length);
    const selectionEndIndex = Math.floor((endSec / totalDuration) * peaks.length);

    peaks.forEach((peak, i) => {
      const isSelected = i >= selectionStartIndex && i <= selectionEndIndex;
      const barHeight = Math.max(2, peak * height * 0.95);
      const x = i * (barWidth + 1);
      const y = (height - barHeight) / 2;

      // Draw subtle background bars
      ctx.fillStyle = isSelected ? "rgba(16, 185, 129, 0.85)" : "rgba(100, 116, 139, 0.3)";
      ctx.fillRect(x, y, barWidth, barHeight);
    });

    // Draw selection boundaries
    if (totalDuration > 0) {
      const xStart = (startSec / totalDuration) * width;
      const xEnd = (endSec / totalDuration) * width;

      // Draw boundary line start
      ctx.strokeStyle = "rgba(16, 185, 129, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xStart, 0);
      ctx.lineTo(xStart, height);
      ctx.stroke();

      // Draw boundary line end
      ctx.beginPath();
      ctx.moveTo(xEnd, 0);
      ctx.lineTo(xEnd, height);
      ctx.stroke();

      // Highlight the selection zone background slightly
      ctx.fillStyle = "rgba(16, 185, 129, 0.05)";
      ctx.fillRect(xStart, 0, xEnd - xStart, height);
    }
  }, [peaks, startSec, endSec, totalDuration, activeBuffer]);

  // Audio Playback System
  const startAudioPlayback = (onlySelection: boolean) => {
    if (!activeBuffer) return;
    
    stopAudioPlayback();
    
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioContext;

    const source = audioContext.createBufferSource();
    source.buffer = activeBuffer;
    source.connect(audioContext.destination);

    const startOffset = onlySelection ? startSec : pauseTimeOffsetRef.current;
    const duration = onlySelection ? selectionDuration : activeBuffer.duration - startOffset;

    source.start(0, startOffset, duration);
    sourceRef.current = source;
    playStartRealTimeRef.current = audioContext.currentTime - startOffset;
    setPlaySelectionOnly(onlySelection);
    setIsPlaying(true);

    // Track playback timer
    const updateTime = () => {
      const elapsed = audioContext.currentTime - playStartRealTimeRef.current;
      if (onlySelection && elapsed >= endSec) {
        stopAudioPlayback();
      } else if (elapsed >= activeBuffer.duration) {
        stopAudioPlayback();
      } else {
        setCurrentTime(elapsed);
        playTimerRef.current = requestAnimationFrame(updateTime);
      }
    };
    playTimerRef.current = requestAnimationFrame(updateTime);

    source.onended = () => {
      // Clean up when sound finished
      setIsPlaying(false);
    };
  };

  const stopAudioPlayback = () => {
    if (playTimerRef.current) {
      cancelAnimationFrame(playTimerRef.current);
      playTimerRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch (e) {}
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsPlaying(false);
    if (!playSelectionOnly) {
      pauseTimeOffsetRef.current = currentTime;
    } else {
      pauseTimeOffsetRef.current = 0;
    }
  };

  // Run the core local DSP algorithms
  const runLocalDSP = (operation: string, params: any): AudioBuffer => {
    if (!activeBuffer) throw new Error("No active audio buffer to edit.");

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Slice into pre, target, and post buffers
    const preSlice = sliceAudioBuffer(audioContext, activeBuffer, 0, startSec, false);
    const targetSlice = sliceAudioBuffer(audioContext, activeBuffer, startSec, endSec, false);
    const postSlice = sliceAudioBuffer(audioContext, activeBuffer, endSec, totalDuration, false);

    // Create copy of targetSlice to manipulate channel data directly
    const editedSlice = audioContext.createBuffer(
      targetSlice.numberOfChannels,
      targetSlice.length,
      targetSlice.sampleRate
    );

    // Copy initial data
    for (let c = 0; c < targetSlice.numberOfChannels; c++) {
      editedSlice.getChannelData(c).set(targetSlice.getChannelData(c));
    }

    // Apply DSP effect
    switch (operation) {
      case "volume": {
        const gain = typeof params.gain === "number" ? params.gain : 1.0;
        for (let c = 0; c < editedSlice.numberOfChannels; c++) {
          const data = editedSlice.getChannelData(c);
          for (let i = 0; i < data.length; i++) {
            data[i] *= gain;
          }
        }
        break;
      }
      case "mute": {
        for (let c = 0; c < editedSlice.numberOfChannels; c++) {
          const data = editedSlice.getChannelData(c);
          data.fill(0.0);
        }
        break;
      }
      case "fade-in": {
        const duration = Math.min(typeof params.duration === "number" ? params.duration : 1.0, targetSlice.duration);
        const fadeSamples = Math.floor(duration * targetSlice.sampleRate);
        for (let c = 0; c < editedSlice.numberOfChannels; c++) {
          const data = editedSlice.getChannelData(c);
          for (let i = 0; i < Math.min(fadeSamples, data.length); i++) {
            data[i] *= (i / fadeSamples);
          }
        }
        break;
      }
      case "fade-out": {
        const duration = Math.min(typeof params.duration === "number" ? params.duration : 1.0, targetSlice.duration);
        const fadeSamples = Math.floor(duration * targetSlice.sampleRate);
        for (let c = 0; c < editedSlice.numberOfChannels; c++) {
          const data = editedSlice.getChannelData(c);
          const startIdx = data.length - fadeSamples;
          for (let i = 0; i < Math.min(fadeSamples, data.length); i++) {
            const idx = data.length - 1 - i;
            if (idx >= 0) {
              data[idx] *= (i / fadeSamples);
            }
          }
        }
        break;
      }
      case "reverse": {
        for (let c = 0; c < editedSlice.numberOfChannels; c++) {
          const data = editedSlice.getChannelData(c);
          data.reverse();
        }
        break;
      }
      case "muffle": {
        // Low pass filter
        for (let c = 0; c < editedSlice.numberOfChannels; c++) {
          const data = editedSlice.getChannelData(c);
          let lastVal = 0;
          for (let i = 0; i < data.length; i++) {
            data[i] = data[i] * 0.15 + lastVal * 0.85;
            lastVal = data[i];
          }
        }
        break;
      }
      case "telephone": {
        // Telephone bandpass filter (high pass + low pass combined)
        for (let c = 0; c < editedSlice.numberOfChannels; c++) {
          const data = editedSlice.getChannelData(c);
          let lastVal = 0;
          let lastInput = 0;
          for (let i = 0; i < data.length; i++) {
            const input = data[i];
            const hp = input - lastInput;
            lastInput = input;
            
            data[i] = hp * 0.25 + lastVal * 0.75;
            lastVal = data[i];
            data[i] *= 2.5; // boost back telephone attenuation
          }
        }
        break;
      }
      case "pitch": {
        const factor = typeof params.factor === "number" ? params.factor : 1.0;
        if (factor !== 1.0) {
          const newLen = Math.floor(targetSlice.length / factor);
          const pitched = audioContext.createBuffer(targetSlice.numberOfChannels, newLen, targetSlice.sampleRate);
          for (let c = 0; c < targetSlice.numberOfChannels; c++) {
            const src = targetSlice.getChannelData(c);
            const dest = pitched.getChannelData(c);
            for (let i = 0; i < newLen; i++) {
              const srcIndex = i * factor;
              const indexBase = Math.floor(srcIndex);
              const indexFract = srcIndex - indexBase;
              if (indexBase + 1 < src.length) {
                dest[i] = src[indexBase] * (1 - indexFract) + src[indexBase + 1] * indexFract;
              } else if (indexBase < src.length) {
                dest[i] = src[indexBase];
              } else {
                dest[i] = 0;
              }
            }
          }
          // Concatenate using the pitch-shifted edited buffer instead
          return concatenateAudioBuffers(audioContext, [preSlice, pitched, postSlice]);
        }
        break;
      }
      default:
        break;
    }

    // Concatenate the unchanged slices with our newly edited slice
    return concatenateAudioBuffers(audioContext, [preSlice, editedSlice, postSlice]);
  };

  // Submit natural language prompt to Gemini
  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !activeBuffer || isProcessing) return;

    const userText = prompt.trim();
    setPrompt("");
    setErrorMsg(null);
    setIsProcessing(true);

    // Add user message to feed
    const userMsgId = `msg-${Date.now()}`;
    const timestampStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text: userText,
      timestamp: timestampStr
    };
    setMessages((prev) => [...prev, userMsg]);
    addLog("info", "api", `Descriptive command sent: "${userText}"`);

    try {
      const response = await fetch("/api/descriptive-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: userText,
          startSec: parseFloat(startSec.toFixed(2)),
          endSec: parseFloat(endSec.toFixed(2)),
          durationSec: parseFloat(selectionDuration.toFixed(2)),
          totalDuration: parseFloat(totalDuration.toFixed(2))
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Server returned error status ${response.status}`);
      }

      const resData = await response.json();
      const aiResponse = resData.explanation || "Determined audio edit successfully.";
      const opType = resData.operation;

      // Add to history stack for UNDO capability
      setHistoryStack((prev) => [...prev, activeBuffer]);

      // Apply the DSP operation
      const updatedBuffer = runLocalDSP(opType, resData);
      setActiveBuffer(updatedBuffer);

      // Re-extract peaks for visual feedback of edited waveforms
      const channelData = updatedBuffer.getChannelData(0);
      const step = Math.ceil(channelData.length / 150);
      const extracted: number[] = [];
      for (let i = 0; i < 150; i++) {
        let max = 0;
        const start = i * step;
        const end = Math.min(start + step, channelData.length);
        for (let j = start; j < end; j++) {
          const val = Math.abs(channelData[j]);
          if (val > max) max = val;
        }
        extracted.push(max);
      }
      setPeaks(extracted);

      // Add AI reply with operation logs
      const aiMsg: ChatMessage = {
        id: `msg-ai-${Date.now()}`,
        sender: "ai",
        text: aiResponse,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        operation: {
          type: opType,
          params: resData
        }
      };
      setMessages((prev) => [...prev, aiMsg]);
      addLog("success", "action", `Successfully applied AI DSP instruction "${opType}" locally on timeline range.`);

    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred processing your command.");
      addLog("error", "api", `Descriptive editing model run failed: ${err.message}`);
      
      const errorMsgItem: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        sender: "system",
        text: `Error: ${err.message || "Could not successfully map command to DSP parameters."}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, errorMsgItem]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Undo the last edit operation
  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const prevBuffer = historyStack[historyStack.length - 1];
    setActiveBuffer(prevBuffer);
    setHistoryStack((prev) => prev.slice(0, -1));

    // Re-extract peaks
    const channelData = prevBuffer.getChannelData(0);
    const step = Math.ceil(channelData.length / 150);
    const extracted: number[] = [];
    for (let i = 0; i < 150; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(start + step, channelData.length);
      for (let j = start; j < end; j++) {
        const val = Math.abs(channelData[j]);
        if (val > max) max = val;
      }
      extracted.push(max);
    }
    setPeaks(extracted);

    setMessages((prev) => [
      ...prev,
      {
        id: `msg-undo-${Date.now()}`,
        sender: "system",
        text: "Undid last descriptive editing DSP operation.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    addLog("info", "action", "Undid last applied descriptive editing operation.");
  };

  // Commit changes to main track
  const handleCommit = async () => {
    if (!activeBuffer || !originalFile) return;

    try {
      const wavBlob = audioBufferToWav(activeBuffer);
      const reader = new FileReader();
      reader.readAsDataURL(wavBlob);
      reader.onloadend = () => {
        const base64data = reader.result as string;
        onApplyDescriptive(activeBuffer, base64data);
        addLog("success", "action", "Descriptive editing changes successfully committed and saved to original master file.");
        
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-commit-${Date.now()}`,
            sender: "system",
            text: "✅ Changes committed to the main editor workspace successfully!",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      };
    } catch (err: any) {
      addLog("error", "browser", `Failed to export WAV audio: ${err.message}`);
    }
  };

  // Preset prompts
  const presets = [
    { label: "Muffle Selection", text: "Muffle this part" },
    { label: "Fade Out", text: "Fade out over 1.5 seconds" },
    { label: "Telephone Voice", text: "Make this selection sound like a telephone call" },
    { label: "Chipmunk Pitch", text: "Shift pitch up to make it sound like a chipmunk" },
    { label: "Play Backwards", text: "Reverse this audio" },
    { label: "Boost Volume (+3dB)", text: "Make this selection louder by multiplying volume by 1.5" }
  ];

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 p-6 min-h-[calc(100vh-140px)] bg-slate-950 text-slate-100" id="descriptive-editing-studio">
      
      {/* Left Column: Timeline, Waves, Selection Sliders */}
      <div className="lg:col-span-7 flex flex-col gap-6">
        
        {/* Workspace Title Card */}
        <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm shadow-xl flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Descriptive Editing Studio
            </h2>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-widest">
                Gemini AI Inside
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            Highlight any segment of your audio, then command Gemini in plain English to apply custom DSP effects (e.g. lowpass filters, gain adjustments, fades, reverses, or pitch changes).
          </p>
        </div>

        {/* Interactive Waveform Timeline Component */}
        <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800/80 shadow-2xl flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              Selection Timeline Waveform
            </span>
            <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono">
              <div className="flex items-center gap-1 bg-slate-950/60 px-2 py-1 rounded border border-slate-800">
                <span className="text-slate-500">Selection:</span>
                <span className="text-emerald-400 font-bold">{startSec.toFixed(2)}s</span>
                <span className="text-slate-600">-</span>
                <span className="text-emerald-400 font-bold">{endSec.toFixed(2)}s</span>
              </div>
              <div className="flex items-center gap-1 bg-slate-950/60 px-2 py-1 rounded border border-slate-800">
                <span className="text-slate-500">Duration:</span>
                <span className="text-slate-200 font-bold">{selectionDuration.toFixed(2)}s</span>
              </div>
            </div>
          </div>

          {/* Waveform Canvas Container */}
          <div className="relative w-full h-36 bg-slate-950 rounded-xl border border-slate-800/80 overflow-hidden flex items-center justify-center">
            {peaks.length > 0 ? (
              <canvas
                ref={canvasRef}
                width={600}
                height={144}
                className="w-full h-full block cursor-pointer"
                id="descriptive-timeline-canvas"
              />
            ) : (
              <div className="text-center py-12 text-slate-500 flex flex-col items-center gap-2">
                <Activity className="w-8 h-8 text-slate-700 animate-pulse" />
                <span className="text-xs">No active audio track loaded. Upload audio to begin.</span>
              </div>
            )}

            {/* Current Position Marker */}
            {isPlaying && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 z-10 shadow-lg shadow-emerald-400/50 pointer-events-none"
                style={{ left: `${(currentTime / totalDuration) * 100}%` }}
              />
            )}
          </div>

          {/* Sliders for precise region selection */}
          {activeBuffer && (
            <div className="flex flex-col gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/60">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                    <span>Selection Start</span>
                    <span className="font-mono text-emerald-400">{startSec.toFixed(2)}s</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={totalDuration}
                    step={0.01}
                    value={startSec}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setStartSec(Math.min(val, endSec - 0.05));
                    }}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                    <span>Selection End</span>
                    <span className="font-mono text-emerald-400">{endSec.toFixed(2)}s</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={totalDuration}
                    step={0.01}
                    value={endSec}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setEndSec(Math.max(val, startSec + 0.05));
                    }}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Selection Playback Control Row */}
          <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-800/60">
            <div className="flex items-center gap-2">
              {isPlaying ? (
                <button
                  onClick={stopAudioPlayback}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 border border-rose-500/20 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                  id="descriptive-btn-stop"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Playback</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => startAudioPlayback(true)}
                    disabled={!activeBuffer}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-slate-950 hover:bg-emerald-400 text-xs font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-500/10 cursor-pointer"
                    id="descriptive-btn-play-selection"
                  >
                    <Play className="w-3.5 h-3.5 fill-slate-950" />
                    <span>Play Selection</span>
                  </button>
                  <button
                    onClick={() => startAudioPlayback(false)}
                    disabled={!activeBuffer}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700/60 text-xs font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    id="descriptive-btn-play-entire"
                  >
                    <span>Play Full Track</span>
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleUndo}
                disabled={historyStack.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Undo Last Edit"
                id="descriptive-btn-undo"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Undo Last Edit ({historyStack.length})</span>
              </button>
            </div>
          </div>
        </div>

        {/* DSP Prompt Presets Panel */}
        <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col gap-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            Quick DSP Presets
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {presets.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => setPrompt(preset.text)}
                disabled={!activeBuffer || isProcessing}
                className="text-left px-3.5 py-2.5 bg-slate-950 hover:bg-slate-800/80 border border-slate-800/60 hover:border-emerald-500/30 text-[11px] text-slate-300 rounded-xl transition-all truncate hover:text-emerald-400 flex items-center justify-between cursor-pointer group disabled:opacity-50"
              >
                <span>{preset.label}</span>
                <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-emerald-400 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Column: AI Co-producer Chat Box */}
      <div className="lg:col-span-5 flex flex-col gap-6 h-[calc(100vh-140px)] max-h-[640px] lg:max-h-none">
        
        {/* Gemini Chat Frame */}
        <div className="flex-1 flex flex-col bg-slate-900/60 border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden">
          
          {/* Chat Header */}
          <div className="p-4 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-xs font-bold text-slate-200">AI Co-producer Session</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">v3.5-flash</span>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${
                  msg.sender === "user"
                    ? "self-end items-end"
                    : msg.sender === "system"
                    ? "self-center w-full max-w-full"
                    : "self-start items-start"
                }`}
              >
                {/* Sender Title and Time */}
                <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-slate-500">
                  <span className="font-semibold text-slate-400">
                    {msg.sender === "user" ? "You" : msg.sender === "system" ? "System Log" : "Gemini"}
                  </span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                </div>

                {/* Bubble */}
                <div
                  className={`p-3 rounded-2xl text-xs leading-relaxed ${
                    msg.sender === "user"
                      ? "bg-emerald-500 text-slate-950 font-medium rounded-tr-none"
                      : msg.sender === "system"
                      ? "bg-slate-950/80 text-amber-400/90 border border-amber-500/10 text-center font-mono w-full rounded-xl"
                      : "bg-slate-950/90 text-slate-200 border border-slate-800/60 rounded-tl-none shadow-md"
                  }`}
                >
                  <p>{msg.text}</p>

                  {/* Operation Chip */}
                  {msg.operation && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                      <span className="text-[9px] font-mono uppercase bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-800">
                        DSP: {msg.operation.type}
                      </span>
                      {msg.operation.params?.factor && (
                        <span className="text-[9px] font-mono text-emerald-400">
                          Multiplier: {msg.operation.params.factor}x
                        </span>
                      )}
                      {msg.operation.params?.gain && (
                        <span className="text-[9px] font-mono text-emerald-400">
                          Gain: {msg.operation.params.gain}x
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* AI Thinking State */}
            {isProcessing && (
              <div className="self-start items-start max-w-[85%] animate-pulse">
                <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-slate-500">
                  <span className="font-semibold text-slate-400">Gemini</span>
                  <span>•</span>
                  <span>Thinking...</span>
                </div>
                <div className="p-4 bg-slate-950/90 text-slate-400 border border-slate-800/60 rounded-2xl rounded-tl-none flex items-center gap-3">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[11px] font-mono">Modelling DSP coefficients...</span>
                </div>
              </div>
            )}
          </div>

          {/* Prompt Form Input Area */}
          <form onSubmit={handlePromptSubmit} className="p-3 bg-slate-950/80 border-t border-slate-800/80 flex flex-col gap-2">
            <div className="flex gap-2 relative items-center">
              <input
                type="text"
                placeholder={!activeBuffer ? "Please upload an audio track first..." : "e.g., Muffle this part, apply a telephone effect, reverse..."}
                disabled={!activeBuffer || isProcessing}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-800/80 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all disabled:opacity-50"
                id="descriptive-input"
              />
              <button
                type="submit"
                disabled={!activeBuffer || isProcessing || !prompt.trim()}
                className="absolute right-2 px-3 py-1.5 bg-emerald-500 text-slate-950 hover:bg-emerald-400 rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
                id="descriptive-btn-submit"
              >
                <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                <span>Command</span>
              </button>
            </div>
            
            {/* Range selected indicator for the prompt */}
            {activeBuffer && (
              <span className="text-[9px] text-slate-500 px-1 font-mono">
                Command will apply to selection range: {startSec.toFixed(2)}s to {endSec.toFixed(2)}s.
              </span>
            )}
          </form>
        </div>

        {/* Commit card */}
        <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800/80 flex flex-col gap-4 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-bold text-slate-100">Apply to Main Project</h3>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Save and export these descriptive voice edits directly to your primary podcast/sound timeline to merge them with any silence-truncation or voice repairs.
              </p>
            </div>
          </div>
          <button
            onClick={handleCommit}
            disabled={!activeBuffer || isProcessing || historyStack.length === 0}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-lg shadow-emerald-500/10 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            id="descriptive-btn-commit"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Apply Edits to Master File</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Simple Helper Activity Icon
function Activity(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
