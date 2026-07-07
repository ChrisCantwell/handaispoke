import React, { useState, useEffect, useRef } from "react";
import { 
  Sliders, 
  Volume2, 
  Play, 
  Pause,
  Square, 
  Download, 
  Check, 
  Sparkles, 
  RotateCcw, 
  Activity, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  TrendingUp,
  Music4
} from "lucide-react";
import { normalizeAudioBuffer, limitAudioBuffer, audioBufferToWav } from "../utils/audioUtils";

interface VolumeNormalizationProps {
  audioBuffer: AudioBuffer | null;
  originalFile: {
    name: string;
    type: string;
    file: File;
    base64?: string;
  } | null;
  onApplyNormalized: (newBuffer: AudioBuffer, base64: string) => void;
  addLog: (
    level: "info" | "warn" | "error" | "success",
    category: "click" | "action" | "api" | "browser" | "server",
    message: string
  ) => void;
}

interface AIRecommendation {
  analysis: string;
  recommendedMode: "normalization" | "limiter";
  targetDb: number;
  inputGainDb: number;
  limitThresholdDb: number;
  releaseMs: number;
}

export default function VolumeNormalization({
  audioBuffer,
  originalFile,
  onApplyNormalized,
  addLog
}: VolumeNormalizationProps) {
  // DSP Settings State
  const [activeTool, setActiveTool] = useState<"normalization" | "limiter">("normalization");
  
  // Normalization parameters
  const [targetDb, setTargetDb] = useState<number>(-1.0);
  const [independentStereo, setIndependentStereo] = useState<boolean>(false);

  // Limiter parameters
  const [inputGainDb, setInputGainDb] = useState<number>(0.0);
  const [limitThresholdDb, setLimitThresholdDb] = useState<number>(-3.0);
  const [releaseMs, setReleaseMs] = useState<number>(100);

  // Analysis Metrics State (Calculated locally)
  const [metrics, setMetrics] = useState<{
    peakDb: number;
    rmsDb: number;
    crestFactor: number;
    status: string;
    statusColor: string;
  } | null>(null);

  // AI Recommendation State
  const [aiRecommendation, setAiRecommendation] = useState<AIRecommendation | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Processing State
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [processSuccess, setProcessSuccess] = useState<boolean>(false);
  const [aiSuccess, setAiSuccess] = useState<boolean>(false);

  // Success message feedback state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const triggerSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage((prev) => prev === msg ? null : prev);
    }, 5000);
  };

  // Audio Playback State for Original & Processed
  const [playingOriginal, setPlayingOriginal] = useState<boolean>(false);
  const [playingProcessed, setPlayingProcessed] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playbackDuration, setPlaybackDuration] = useState<number>(0);

  // Refs for audio playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const originalSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const processedSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartRealTimeRef = useRef<number>(0);
  const pauseTimeOffsetRef = useRef<number>(0);
  const playTimerRef = useRef<number | null>(null);

  // Canvas waveforms
  const [origPeaks, setOrigPeaks] = useState<number[]>([]);
  const [procPeaks, setProcPeaks] = useState<number[]>([]);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const procCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Calculate audio metrics locally when the audioBuffer changes
  useEffect(() => {
    if (!audioBuffer) {
      setMetrics(null);
      setProcessedBuffer(null);
      setAiRecommendation(null);
      setOrigPeaks([]);
      setProcPeaks([]);
      setIsSaved(false);
      return;
    }

    setPlaybackDuration(audioBuffer.duration);
    setIsSaved(false);

    // Analyze Peak and RMS levels
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    let absolutePeak = 0;
    let sumSquares = 0;
    let totalSamples = 0;

    // We can decimate the sampling to speed up metrics on long files
    const step = Math.max(1, Math.floor(length / 200000)); 

    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i += step) {
        const sample = data[i];
        const absVal = Math.abs(sample);
        if (absVal > absolutePeak) {
          absolutePeak = absVal;
        }
        sumSquares += sample * sample;
        totalSamples++;
      }
    }

    const peakDb = absolutePeak > 0 ? 20 * Math.log10(absolutePeak) : -100;
    const rms = Math.sqrt(sumSquares / totalSamples);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
    const crestFactor = peakDb - rmsDb;

    // Define diagnostic status
    let status = "Balanced Levels";
    let statusColor = "text-emerald-400 border-emerald-500/20 bg-emerald-950/20";
    if (peakDb < -15) {
      status = "Extremely Quiet (Needs Gain)";
      statusColor = "text-sky-400 border-sky-500/20 bg-sky-950/20";
    } else if (peakDb < -6) {
      status = "Quiet (Needs Normalization)";
      statusColor = "text-amber-400 border-amber-500/20 bg-amber-950/20";
    } else if (peakDb >= -0.1) {
      status = "Clipping/Distortion Risk (Needs Limiter)";
      statusColor = "text-rose-400 border-rose-500/20 bg-rose-950/20";
    } else if (crestFactor > 16) {
      status = "High Dynamic Range (Highly Unstable)";
      statusColor = "text-violet-400 border-violet-500/20 bg-violet-950/20";
    }

    setMetrics({
      peakDb,
      rmsDb,
      crestFactor,
      status,
      statusColor
    });

    // Extract Peak points for Drawing the original waveform canvas
    const channelData = audioBuffer.getChannelData(0);
    const waveStep = Math.ceil(channelData.length / 300);
    const newPeaks: number[] = [];
    for (let i = 0; i < 300; i++) {
      let maxVal = 0;
      const startIdx = i * waveStep;
      const endIdx = Math.min(startIdx + waveStep, channelData.length);
      for (let j = startIdx; j < endIdx; j++) {
        const val = Math.abs(channelData[j]);
        if (val > maxVal) maxVal = val;
      }
      newPeaks.push(maxVal);
    }
    setOrigPeaks(newPeaks);
    setProcessedBuffer(null);
    setProcPeaks([]);

    // Stop playback when buffer changes
    stopPlayback();
  }, [audioBuffer]);

  // Redraw original waveform canvas
  useEffect(() => {
    const canvas = origCanvasRef.current;
    if (!canvas || origPeaks.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(71, 85, 105, 0.25)";
    ctx.fillRect(0, 0, width, height);

    // Draw center line
    ctx.strokeStyle = "rgba(71, 85, 105, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw bars
    const barWidth = width / origPeaks.length;
    ctx.fillStyle = "#64748b"; // Slate-500 for original
    for (let i = 0; i < origPeaks.length; i++) {
      const val = origPeaks[i];
      const barHeight = val * (height * 0.9);
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
  }, [origPeaks]);

  // Redraw processed waveform canvas
  useEffect(() => {
    const canvas = procCanvasRef.current;
    if (!canvas || procPeaks.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(16, 185, 129, 0.05)";
    ctx.fillRect(0, 0, width, height);

    // Draw center line
    ctx.strokeStyle = "rgba(16, 185, 129, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw bars
    const barWidth = width / procPeaks.length;
    ctx.fillStyle = "#10b981"; // Emerald-500 for processed
    for (let i = 0; i < procPeaks.length; i++) {
      const val = procPeaks[i];
      const barHeight = val * (height * 0.9);
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
  }, [procPeaks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, []);

  // AI-assisted Analysis API Trigger
  const runAiAnalysis = async () => {
    if (!audioBuffer || !metrics) return;
    setIsAiAnalyzing(true);
    setAiError(null);
    addLog("info", "api", "Contacting Gemini AI Mastering Engineer to evaluate dynamic profiles...");

    try {
      const response = await fetch("/api/analyze-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peakDb: metrics.peakDb,
          rmsDb: metrics.rmsDb,
          durationSec: audioBuffer.duration,
          filename: originalFile?.name || "unnamed_recording.wav"
        })
      });

      if (!response.ok) {
        throw new Error(`Mastering analysis failed with status: ${response.status}`);
      }

      const recommendation: AIRecommendation = await response.json();
      setAiRecommendation(recommendation);
      triggerSuccess(`Gemini dynamic evaluation complete! AI recommended Mode: ${recommendation.recommendedMode.toUpperCase()}.`);
      addLog("success", "api", `Gemini recommended: ${recommendation.recommendedMode.toUpperCase()} with target of ${recommendation.targetDb} dB.`);
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || "Could not retrieve AI recommendation.");
      addLog("error", "api", `AI mastering recommendation failed: ${err.message}`);
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  const applyAiSettings = () => {
    if (!aiRecommendation) return;
    setActiveTool(aiRecommendation.recommendedMode);
    setTargetDb(aiRecommendation.targetDb);
    setInputGainDb(aiRecommendation.inputGainDb);
    setLimitThresholdDb(aiRecommendation.limitThresholdDb);
    setReleaseMs(aiRecommendation.releaseMs);
    setAiSuccess(true);
    setTimeout(() => setAiSuccess(false), 4000);
    triggerSuccess("Gemini recommended dials applied to the sliders successfully!");
    addLog("info", "action", `Configured mastering dials to Gemini-recommended settings.`);
  };

  // DSP Process Execution
  const processAudio = () => {
    if (!audioBuffer) return;
    setIsProcessing(true);
    addLog("info", "action", `Running ${activeTool} pass over entire AudioBuffer...`);

    setTimeout(() => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const tempCtx = new AudioCtx();
        
        let result: AudioBuffer;
        if (activeTool === "normalization") {
          result = normalizeAudioBuffer(tempCtx, audioBuffer, targetDb, independentStereo);
        } else {
          result = limitAudioBuffer(tempCtx, audioBuffer, inputGainDb, limitThresholdDb, releaseMs);
        }

        setProcessedBuffer(result);

        // Extract Peak points for Drawing the processed waveform
        const channelData = result.getChannelData(0);
        const waveStep = Math.ceil(channelData.length / 300);
        const newPeaks: number[] = [];
        for (let i = 0; i < 300; i++) {
          let maxVal = 0;
          const startIdx = i * waveStep;
          const endIdx = Math.min(startIdx + waveStep, channelData.length);
          for (let j = startIdx; j < endIdx; j++) {
            const val = Math.abs(channelData[j]);
            if (val > maxVal) maxVal = val;
          }
          newPeaks.push(maxVal);
        }
        setProcPeaks(newPeaks);
        setProcessSuccess(true);
        setTimeout(() => setProcessSuccess(false), 4000);
        triggerSuccess(`Waveform master updated! Audition the preview below or click 'Overwrite Spoken Session' to save.`);
        addLog("success", "action", `Audio successfully processed using local ${activeTool} DSP algorithms.`);
        tempCtx.close();
      } catch (err: any) {
        addLog("error", "browser", `Processing failed: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    }, 100);
  };

  // Playback system
  const stopPlayback = () => {
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    if (originalSourceRef.current) {
      try { originalSourceRef.current.stop(); } catch(e){}
      originalSourceRef.current = null;
    }
    if (processedSourceRef.current) {
      try { processedSourceRef.current.stop(); } catch(e){}
      processedSourceRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch(e){}
      audioCtxRef.current = null;
    }
    setPlayingOriginal(false);
    setPlayingProcessed(false);
  };

  const handlePlayToggle = (type: "original" | "processed") => {
    const isPlayingCurrent = type === "original" ? playingOriginal : playingProcessed;

    if (isPlayingCurrent) {
      // Pause
      stopPlayback();
      const elapsed = Date.now() / 1000 - playStartRealTimeRef.current;
      pauseTimeOffsetRef.current = Math.min(playbackDuration, pauseTimeOffsetRef.current + elapsed);
      setCurrentTime(pauseTimeOffsetRef.current);
    } else {
      // Play
      stopPlayback();
      
      const bufferToPlay = type === "original" ? audioBuffer : processedBuffer;
      if (!bufferToPlay) return;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createBufferSource();
      source.buffer = bufferToPlay;
      source.connect(ctx.destination);

      let offset = pauseTimeOffsetRef.current;
      if (offset >= playbackDuration) {
        offset = 0;
        pauseTimeOffsetRef.current = 0;
      }

      source.start(0, offset);
      playStartRealTimeRef.current = Date.now() / 1000;
      setCurrentTime(offset);

      if (type === "original") {
        originalSourceRef.current = source;
        setPlayingOriginal(true);
      } else {
        processedSourceRef.current = source;
        setPlayingProcessed(true);
      }

      // Live time tracker
      playTimerRef.current = window.setInterval(() => {
        const delta = Date.now() / 1000 - playStartRealTimeRef.current;
        const current = Math.min(playbackDuration, offset + delta);
        setCurrentTime(current);

        if (current >= playbackDuration) {
          stopPlayback();
          pauseTimeOffsetRef.current = 0;
          setCurrentTime(0);
        }
      }, 50);
    }
  };

  const resetTimeline = () => {
    stopPlayback();
    pauseTimeOffsetRef.current = 0;
    setCurrentTime(0);
    addLog("info", "click", "Reset player playback cursor.");
  };

  // Commit changes to main app session (Overwrites session AudioBuffer)
  const commitToSession = async () => {
    if (!processedBuffer) return;
    setIsProcessing(true);
    addLog("info", "action", "Encoding processed buffer into a standard 16-bit PCM WAV and updating session...");

    try {
      const wavBlob = audioBufferToWav(processedBuffer);
      
      // Convert WAV Blob back to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        const base64clean = base64data.split(",")[1];
        
        // Pass to App state
        onApplyNormalized(processedBuffer, base64clean);
        setIsSaved(true);
        triggerSuccess("Success! Master track overwritten and updated in Spoken Session!");
        addLog("success", "action", `Successfully overwritten session audio buffer with professional ${activeTool} master!`);
        setIsProcessing(false);
      };
      reader.onerror = (e) => {
        throw new Error("Failed to encode processed buffer to Base64.");
      };
      reader.readAsDataURL(wavBlob);
    } catch (err: any) {
      addLog("error", "browser", `Overwriting session failed: ${err.message}`);
      setIsProcessing(false);
    }
  };

  const downloadWav = () => {
    if (!processedBuffer) return;
    try {
      const wavBlob = audioBufferToWav(processedBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `normalized_${originalFile?.name || "output.wav"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      triggerSuccess("Master audio file downloaded successfully!");
      addLog("success", "click", "Downloaded normalized WAV file successfully.");
    } catch (err: any) {
      addLog("error", "browser", `Download failed: ${err.message}`);
    }
  };

  const formatTime = (sec: number) => {
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${ms}`;
  };

  if (!audioBuffer) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-slate-900/20 border border-dashed border-slate-800 rounded-2xl backdrop-blur-md">
        <Volume2 className="w-12 h-12 text-slate-600 mb-4 animate-pulse" />
        <h3 className="text-lg font-bold text-slate-300">No Audio Active</h3>
        <p className="text-sm text-slate-500 max-w-md mt-2">
          Please upload or record a podcast file in the <span className="text-emerald-400 font-semibold">Speech Repair</span> tab first to unlock the professional volume normalization & limiter studio.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" id="volume-normalization-tab">
      
      {/* Success Notification Alert */}
      {successMessage && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/35 text-emerald-400 rounded-xl text-xs flex items-center justify-between gap-3 animate-fade-in" id="norm-success-alert">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium font-sans">{successMessage}</span>
          </div>
          <button 
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-300 text-[10px] font-bold cursor-pointer px-1.5 py-0.5 rounded hover:bg-emerald-500/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Upper stats banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl backdrop-blur-md flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-slate-400" />
            Measured Peak
          </span>
          <span className="text-xl font-mono font-bold text-slate-200">
            {metrics ? `${metrics.peakDb.toFixed(2)} dBFS` : "Analyzing..."}
          </span>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl backdrop-blur-md flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-slate-400" />
            Average Volume (RMS)
          </span>
          <span className="text-xl font-mono font-bold text-slate-200">
            {metrics ? `${metrics.rmsDb.toFixed(2)} dBFS` : "Analyzing..."}
          </span>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl backdrop-blur-md flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
            Crest Factor (Dynamic Range)
          </span>
          <span className="text-xl font-mono font-bold text-slate-200">
            {metrics ? `${metrics.crestFactor.toFixed(2)} dB` : "Analyzing..."}
          </span>
        </div>
        <div className={`border p-4 rounded-xl backdrop-blur-md flex flex-col gap-1 justify-center transition-all ${metrics?.statusColor || "bg-slate-900/40 border-slate-800"}`}>
          <span className="text-[10px] font-mono uppercase tracking-wider opacity-70">
            Dynamic Profile Diagnosis
          </span>
          <span className="text-sm font-bold truncate">
            {metrics?.status || "Running checks..."}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* LEFT COLUMN: Controls & Settings */}
        <div className="lg:col-span-5 flex flex-col p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md justify-between gap-6">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Restoration Controls</h2>
            </div>

            {/* Tool Selection Tabs */}
            <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => {
                  setActiveTool("normalization");
                  setProcessedBuffer(null);
                  setProcPeaks([]);
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTool === "normalization"
                    ? "bg-slate-800 text-slate-100 border border-slate-700/80"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                }`}
              >
                Peak Normalizer
              </button>
              <button
                onClick={() => {
                  setActiveTool("limiter");
                  setProcessedBuffer(null);
                  setProcPeaks([]);
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTool === "limiter"
                    ? "bg-slate-800 text-slate-100 border border-slate-700/80"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                }`}
              >
                Hard Limiter
              </button>
            </div>

            {/* Dynamic Controls based on selected tool */}
            {activeTool === "normalization" ? (
              <div className="flex flex-col gap-4 p-4 bg-slate-950/40 rounded-xl border border-slate-900">
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1">
                      Target Peak Level 
                      <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" title="Standard is -1.0 dB to leave headroom for compression artifacts" />
                    </span>
                    <span className="font-mono text-emerald-400 font-bold">{targetDb.toFixed(1)} dBFS</span>
                  </div>
                  <input
                    type="range"
                    min="-12.0"
                    max="0.0"
                    step="0.5"
                    value={targetDb}
                    onChange={(e) => {
                      setTargetDb(parseFloat(e.target.value));
                      setProcessedBuffer(null);
                    }}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>-12.0 dBFS</span>
                    <span>-1.0 dB (Recommended)</span>
                    <span>0.0 dB</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-2 border-t border-slate-900 pt-3">
                  <input
                    type="checkbox"
                    id="independent-stereo"
                    checked={independentStereo}
                    onChange={(e) => {
                      setIndependentStereo(e.target.checked);
                      setProcessedBuffer(null);
                    }}
                    className="rounded bg-slate-950 border-slate-800 text-emerald-500 focus:ring-0 w-4 h-4"
                  />
                  <label htmlFor="independent-stereo" className="text-xs text-slate-300 font-medium cursor-pointer">
                    Normalize stereo channels independently
                  </label>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-4 bg-slate-950/40 rounded-xl border border-slate-900">
                
                {/* Input Gain */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300 font-medium">Input Gain (Pre-limit boost)</span>
                    <span className="font-mono text-emerald-400 font-bold">+{inputGainDb.toFixed(1)} dB</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="24.0"
                    step="0.5"
                    value={inputGainDb}
                    onChange={(e) => {
                      setInputGainDb(parseFloat(e.target.value));
                      setProcessedBuffer(null);
                    }}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>0.0 dB (Clean)</span>
                    <span>+12.0 dB</span>
                    <span>+24.0 dB</span>
                  </div>
                </div>

                {/* Limit Threshold */}
                <div className="flex flex-col gap-1.5 border-t border-slate-900 pt-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300 font-medium">Limit Threshold (Ceiling)</span>
                    <span className="font-mono text-emerald-400 font-bold">{limitThresholdDb.toFixed(1)} dBFS</span>
                  </div>
                  <input
                    type="range"
                    min="-20.0"
                    max="-0.5"
                    step="0.5"
                    value={limitThresholdDb}
                    onChange={(e) => {
                      setLimitThresholdDb(parseFloat(e.target.value));
                      setProcessedBuffer(null);
                    }}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>-20.0 dBFS</span>
                    <span>-3.0 dB (Recommended Default)</span>
                    <span>-0.5 dB</span>
                  </div>
                </div>

                {/* Release Time */}
                <div className="flex flex-col gap-1.5 border-t border-slate-900 pt-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300 font-medium">Release Time</span>
                    <span className="font-mono text-emerald-400 font-bold">{releaseMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="1000"
                    step="10"
                    value={releaseMs}
                    onChange={(e) => {
                      setReleaseMs(parseInt(e.target.value));
                      setProcessedBuffer(null);
                    }}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>10 ms</span>
                    <span>100 ms (Speech)</span>
                    <span>1000 ms</span>
                  </div>
                </div>

              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 mt-6">
            <button
              onClick={processAudio}
              disabled={isProcessing}
              className={`w-full py-3 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98] ${
                processSuccess 
                  ? "bg-slate-850 text-emerald-400 border border-emerald-500/30" 
                  : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:bg-slate-800 disabled:text-slate-600 shadow-lg shadow-emerald-500/10"
              }`}
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Processing Audio...</span>
                </>
              ) : processSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>DSP Pass Applied! ✓</span>
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4" />
                  <span>Apply & Preview Waveform</span>
                </>
              )}
            </button>
            {processSuccess && (
              <span className="text-center text-[11px] text-emerald-400 font-bold animate-fade-in flex items-center justify-center gap-1 bg-emerald-950/30 py-1 rounded border border-emerald-900/30" id="norm-process-success-label">
                ✓ Waveform master updated! Audition the preview below.
              </span>
            )}
            
            {processedBuffer && (
              <div className="flex gap-2">
                <button
                  onClick={commitToSession}
                  disabled={isProcessing}
                  className={`flex-1 py-3 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all ${
                    isSaved 
                      ? "bg-slate-900 border border-slate-700/80 text-emerald-400" 
                      : "bg-emerald-600 text-white hover:bg-emerald-500"
                  }`}
                >
                  {isSaved ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Saved to Session!</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Overwrite Spoken Session</span>
                    </>
                  )}
                </button>
                <button
                  onClick={downloadWav}
                  className="px-4 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-slate-300 rounded-xl transition-all cursor-pointer"
                  title="Download WAV Master"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive Dual Waveform & AI Specialist */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Waveform Player Section */}
          <div className="flex flex-col p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Music4 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Waveform Comparison</h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                Cursor: {formatTime(currentTime)} / {formatTime(playbackDuration)}
              </span>
            </div>

            {/* Original Audio Channel */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">1. Original Spoken Word Audio</span>
                <button
                  onClick={() => handlePlayToggle("original")}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold tracking-tight transition-all cursor-pointer ${
                    playingOriginal 
                      ? "bg-rose-500/10 border border-rose-500/30 text-rose-400" 
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-transparent"
                  }`}
                >
                  {playingOriginal ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>{playingOriginal ? "Playing original..." : "Audition Original"}</span>
                </button>
              </div>
              
              <div className="relative w-full h-16 bg-slate-950 rounded-lg overflow-hidden border border-slate-900">
                <canvas 
                  ref={origCanvasRef} 
                  width={600} 
                  height={64} 
                  className="w-full h-full block opacity-75"
                />
                
                {/* Playback Cursor Line */}
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-sky-400 z-10 transition-all pointer-events-none"
                  style={{ left: `${(currentTime / playbackDuration) * 100}%` }}
                />
              </div>
            </div>

            {/* Processed Audio Channel */}
            <div className="flex flex-col gap-1 mt-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase">2. Processed & Normalized Audio</span>
                {processedBuffer ? (
                  <button
                    onClick={() => handlePlayToggle("processed")}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold tracking-tight transition-all cursor-pointer ${
                      playingProcessed 
                        ? "bg-rose-500/10 border border-rose-500/30 text-rose-400" 
                        : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 border border-transparent"
                    }`}
                  >
                    {playingProcessed ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    <span>{playingProcessed ? "Playing master..." : "Audition Master"}</span>
                  </button>
                ) : (
                  <span className="text-[10px] font-mono text-slate-500">Apply settings to preview processed waveform</span>
                )}
              </div>

              <div className="relative w-full h-16 bg-slate-950 rounded-lg overflow-hidden border border-slate-900">
                {processedBuffer ? (
                  <canvas 
                    ref={procCanvasRef} 
                    width={600} 
                    height={64} 
                    className="w-full h-full block"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-950/80 text-[10px] font-mono text-slate-600">
                    No output signal active
                  </div>
                )}

                {/* Playback Cursor Line */}
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 z-10 transition-all pointer-events-none"
                  style={{ left: `${(currentTime / playbackDuration) * 100}%` }}
                />
              </div>
            </div>

            {/* General audio player timeline controls */}
            <div className="flex items-center justify-between border-t border-slate-900 pt-3 mt-1">
              <button
                onClick={resetTimeline}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold text-slate-400 hover:text-slate-200 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-700 transition-all cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Rewind Playhead</span>
              </button>

              <div className="flex gap-2">
                <span className="text-[10px] font-mono text-slate-500 px-2 py-0.5 bg-slate-950 border border-slate-900 rounded">
                  Format: 16-bit WAV PCM
                </span>
                <span className="text-[10px] font-mono text-slate-500 px-2 py-0.5 bg-slate-950 border border-slate-900 rounded">
                  Rate: {audioBuffer.sampleRate} Hz
                </span>
              </div>
            </div>
          </div>

          {/* AI Loudness Analyst & Recommendations Panel */}
          <div className="flex flex-col p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Feature #1: Gemini AI Loudness Specialist</h3>
              </div>
              
              {!aiRecommendation && !isAiAnalyzing && (
                <button
                  onClick={runAiAnalysis}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/20 hover:border-emerald-500/30 rounded-xl text-xs transition-all cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Analyze with Gemini</span>
                </button>
              )}
            </div>

            {isAiAnalyzing && (
              <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-950/40 border border-slate-900 rounded-xl">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
                <span className="text-xs text-slate-400 font-medium">Gemini is analyzing wave metrics, crest factors, and clipping risks...</span>
              </div>
            )}

            {aiError && (
              <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-xl flex gap-3 text-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{aiError}</span>
              </div>
            )}

            {aiRecommendation && (
              <div className="flex flex-col gap-4 p-4 bg-emerald-950/10 border border-emerald-500/20 rounded-xl animate-fade-in">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider">Gemini Engineering Assessment</span>
                  <p className="text-xs text-slate-300 leading-relaxed italic">
                    "{aiRecommendation.analysis}"
                  </p>
                </div>

                <div className="border-t border-emerald-500/20 pt-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] text-slate-400 font-mono">Target Dials:</span>
                    <span className="text-[10px] bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded font-mono uppercase font-bold">
                      Mode: {aiRecommendation.recommendedMode}
                    </span>
                    {aiRecommendation.recommendedMode === "normalization" ? (
                      <span className="text-[10px] bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded font-mono font-bold">
                        Peak: {aiRecommendation.targetDb} dBFS
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded font-mono font-bold">
                          Gain: +{aiRecommendation.inputGainDb} dB
                        </span>
                        <span className="text-[10px] bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded font-mono font-bold">
                          Ceiling: {aiRecommendation.limitThresholdDb} dBFS
                        </span>
                        <span className="text-[10px] bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded font-mono font-bold">
                          Release: {aiRecommendation.releaseMs} ms
                        </span>
                      </>
                    )}
                  </div>

                  <button
                    onClick={applyAiSettings}
                    className={`flex items-center justify-center gap-1.5 px-3 py-1.5 font-bold rounded-lg text-[10px] transition-all cursor-pointer active:scale-95 shrink-0 ${
                      aiSuccess 
                        ? "bg-slate-900 border border-emerald-500/30 text-emerald-400" 
                        : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                    }`}
                  >
                    {aiSuccess ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Dials Configured! ✓</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Configure Dials Instantly</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {!aiRecommendation && !isAiAnalyzing && !aiError && (
              <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-900/60 text-xs text-slate-400 leading-relaxed flex gap-3">
                <Sparkles className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="block font-bold text-slate-300 mb-1">How AI volume normalization works:</span>
                  Gemini analyzes real audio properties (peak amplitude and crest factor) to build an expert custom gain curve. If your track has high dynamic variance, it recommends a hard limiter with gain boost to ensure quiet talking sounds are lifted while loud bursts are brickwalled. Click the button above to run the intelligent diagnostic!
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
