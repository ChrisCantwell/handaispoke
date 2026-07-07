import React, { useState, useRef } from "react";
import { 
  Volume2, 
  Sparkles, 
  Sliders, 
  Activity, 
  Settings, 
  Play, 
  Pause, 
  Trash2, 
  AlertTriangle,
  Info,
  Wand2,
  RefreshCw,
  CheckCircle,
  ShieldCheck,
  FileAudio
} from "lucide-react";
import { AppLog } from "../types";
import { 
  extractNoiseProfile, 
  applyNoiseReduction, 
  applyNoiseGate,
  audioBufferToWav
} from "../utils/audioUtils";

interface NoiseStudioProps {
  audioBuffer: AudioBuffer | null;
  originalFile: {
    name: string;
    type: string;
    base64: string;
  } | null;
  onApplyNoiseProcessed: (newBuffer: AudioBuffer, newBase64: string) => void;
  addLog: (
    level: "info" | "warn" | "error" | "success",
    category: "click" | "action" | "api" | "browser" | "server",
    message: string,
    details?: any
  ) => void;
}

export default function NoiseStudio({
  audioBuffer,
  originalFile,
  onApplyNoiseProcessed,
  addLog
}: NoiseStudioProps) {
  // DSP Tabs: "denoise" vs "gate" vs "ai"
  const [activeTab, setActiveTab] = useState<"denoise" | "gate" | "ai">("denoise");

  // Success message feedback state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [denoiseSuccess, setDenoiseSuccess] = useState(false);
  const [gateSuccess, setGateSuccess] = useState(false);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [aiSuccess, setAiSuccess] = useState(false);

  const triggerSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage((prev) => prev === msg ? null : prev);
    }, 5000);
  };

  // Local Audio playback state for preview
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Denoise Parameters
  const [noiseProfile, setNoiseProfile] = useState<Float32Array | null>(null);
  const [profileRange, setProfileRange] = useState({ start: 0, end: 1.5 });
  const [reductionDb, setReductionDb] = useState(12);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [isDenoising, setIsDenoising] = useState(false);

  // Noise Gate Parameters
  const [gateThreshold, setGateThreshold] = useState(-45);
  const [gateAttack, setGateAttack] = useState(5);
  const [gateHold, setGateHold] = useState(50);
  const [gateRelease, setGateRelease] = useState(150);
  const [gateReduction, setGateReduction] = useState(-60);
  const [isGating, setIsGating] = useState(false);

  // Gemini AI Enhancer Parameters
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiReport, setAiReport] = useState<any | null>(null);

  // Playback Preview handlers
  const handleTogglePreview = () => {
    if (!audioBuffer) return;

    if (isPlayingPreview) {
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
        } catch (e) {}
      }
      setIsPlayingPreview(false);
    } else {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        setIsPlayingPreview(false);
      };
      source.start(0);
      activeSourceRef.current = source;
      setIsPlayingPreview(true);
    }
  };

  // Noise Profile Capture
  const handleCaptureProfile = () => {
    if (!audioBuffer) return;
    try {
      const maxDuration = audioBuffer.duration;
      let start = Math.max(0, profileRange.start);
      let end = Math.min(maxDuration, profileRange.end);
      if (start >= end) {
        start = 0;
        end = Math.min(1.5, maxDuration);
      }

      addLog("info", "action", `Learning ambient noise profile from range: ${start.toFixed(2)}s to ${end.toFixed(2)}s`);
      const profile = extractNoiseProfile(audioBuffer, start, end);
      setNoiseProfile(profile);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 4000);
      triggerSuccess(`Noise profile captured successfully! Learned frequency model from range: ${start.toFixed(2)}s - ${end.toFixed(2)}s.`);
      addLog("success", "action", `Noise profile learned successfully! Captured ${profile.length} frequency bins.`);
    } catch (err: any) {
      addLog("error", "action", `Failed to capture noise profile: ${err.message}`);
    }
  };

  const handleCaptureAuto = () => {
    if (!audioBuffer) return;
    try {
      // Find a quiet portion of the track automatically to act as noise profile
      const data = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const step = Math.floor(sampleRate * 0.1); // 100ms steps
      const winSize = Math.floor(sampleRate * 1.0); // 1s window

      let minRms = Infinity;
      let minIdx = 0;

      for (let i = 0; i < data.length - winSize; i += step) {
        let sum = 0;
        for (let j = 0; j < winSize; j++) {
          const val = data[i + j];
          sum += val * val;
        }
        const rms = Math.sqrt(sum / winSize);
        if (rms < minRms && rms > 1e-4) {
          minRms = rms;
          minIdx = i;
        }
      }

      const start = minIdx / sampleRate;
      const end = (minIdx + winSize) / sampleRate;
      setProfileRange({ start, end });

      addLog("info", "action", `Auto-detected quietest window: ${start.toFixed(2)}s to ${end.toFixed(2)}s (RMS: ${(20 * Math.log10(minRms || 1e-5)).toFixed(1)} dBFS)`);
      const profile = extractNoiseProfile(audioBuffer, start, end);
      setNoiseProfile(profile);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 4000);
      triggerSuccess(`Auto-profile capture complete! Found quietest window at ${start.toFixed(1)}s - ${end.toFixed(1)}s.`);
      addLog("success", "action", `Noise profile learned successfully from auto-detected silence!`);
    } catch (err: any) {
      addLog("error", "action", `Auto-profiling failed: ${err.message}`);
    }
  };

  const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => {
        resolve((r.result as string).split(",")[1]);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  };

  // Apply Spectral Noise Reduction
  const handleApplyDenoise = async () => {
    if (!audioBuffer || !noiseProfile) return;
    setIsDenoising(true);
    addLog("info", "action", `Applying local spectral subtraction noise reduction (Reduction: ${reductionDb} dB, Sensitivity: ${sensitivity.toFixed(1)}x)`);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const tempCtx = new AudioCtx();

      const processed = applyNoiseReduction(tempCtx, audioBuffer, noiseProfile, reductionDb, sensitivity);
      const wavBlob = audioBufferToWav(processed);
      const newBase64 = await convertBlobToBase64(wavBlob);

      onApplyNoiseProcessed(processed, newBase64);
      setDenoiseSuccess(true);
      setTimeout(() => setDenoiseSuccess(false), 4000);
      triggerSuccess(`Spectral noise reduction successfully applied! Your spoken track has been updated.`);
      addLog("success", "action", `Local spectral noise reduction applied successfully!`);
      tempCtx.close();
    } catch (err: any) {
      addLog("error", "action", `Spectral noise reduction failed: ${err.message}`);
    } finally {
      setIsDenoising(false);
    }
  };

  // Apply Noise Gate
  const handleApplyGate = async () => {
    if (!audioBuffer) return;
    setIsGating(true);
    addLog("info", "action", `Applying local attack-hold-release Noise Gate (Threshold: ${gateThreshold} dBFS, Reduction: ${gateReduction} dB)`);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const tempCtx = new AudioCtx();

      const processed = applyNoiseGate(tempCtx, audioBuffer, gateThreshold, gateAttack, gateHold, gateRelease, gateReduction);
      const wavBlob = audioBufferToWav(processed);
      const newBase64 = await convertBlobToBase64(wavBlob);

      onApplyNoiseProcessed(processed, newBase64);
      setGateSuccess(true);
      setTimeout(() => setGateSuccess(false), 4000);
      triggerSuccess(`Noise gate successfully applied! Faint hums and breathing below ${gateThreshold} dBFS have been muted.`);
      addLog("success", "action", `Local Noise Gate applied successfully!`);
      tempCtx.close();
    } catch (err: any) {
      addLog("error", "action", `Noise Gate failed: ${err.message}`);
    } finally {
      setIsGating(false);
    }
  };

  // Gemini AI Noise Analysis & Smart Auto-Tuner
  const handleAiOptimize = async () => {
    if (!audioBuffer || !originalFile) return;
    setIsAiAnalyzing(true);
    setAiReport(null);
    addLog("info", "api", "Sending speech wave envelope telemetry to Gemini for intelligent noise signature modeling...");

    try {
      // Build a telemetry package: duration, peak, RMS, and average power in chunks
      const data = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const totalSamples = data.length;
      
      let peak = 0;
      let sumSq = 0;
      const numSteps = 50;
      const stepSize = Math.floor(totalSamples / numSteps);
      const envelope: number[] = [];

      for (let s = 0; s < numSteps; s++) {
        const start = s * stepSize;
        const end = Math.min(start + stepSize, totalSamples);
        let subPeak = 0;
        let subSum = 0;
        for (let i = start; i < end; i++) {
          const val = Math.abs(data[i]);
          if (val > subPeak) subPeak = val;
          subSum += val * val;
        }
        peak = Math.max(peak, subPeak);
        sumSq += subSum;
        envelope.push(parseFloat((20 * Math.log10(subPeak || 1e-5)).toFixed(1)));
      }

      const rms = Math.sqrt(sumSq / totalSamples);
      const rmsDb = 20 * Math.log10(rms || 1e-5);
      const peakDb = 20 * Math.log10(peak || 1e-5);

      const response = await fetch("/api/analyze-noise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filename: originalFile.name,
          durationSec: audioBuffer.duration,
          sampleRate,
          peakDb: parseFloat(peakDb.toFixed(2)),
          rmsDb: parseFloat(rmsDb.toFixed(2)),
          envelope
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini modeling failed with status ${response.status}`);
      }

      const resData = await response.json();
      setAiReport(resData);

      // Auto-configure the sliders using Gemini's intelligent recommendations
      if (resData.recommendedGateThresholdDb) {
        setGateThreshold(resData.recommendedGateThresholdDb);
      }
      if (resData.recommendedGateReductionDb) {
        setGateReduction(resData.recommendedGateReductionDb);
      }
      if (resData.recommendedSpectralReductionDb) {
        setReductionDb(resData.recommendedSpectralReductionDb);
      }
      if (resData.recommendedSensitivity) {
        setSensitivity(resData.recommendedSensitivity);
      }

      setAiSuccess(true);
      setTimeout(() => setAiSuccess(false), 4000);
      triggerSuccess("Gemini AI analysis complete! Sliders have been automatically adjusted to recommendation.");
      addLog("success", "api", "Gemini successfully completed the noise signature model and adjusted your mastering controls!");
    } catch (err: any) {
      addLog("error", "action", `Gemini AI noise analysis failed: ${err.message}`);
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-stretch" id="noise-studio-root">
      {/* Left Configuration Pane */}
      <div className="lg:col-span-8 flex flex-col gap-6" id="noise-studio-config-pane">
        
        {/* Workspace Controls Header Card */}
        <div className="p-6 bg-slate-900/45 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              Noise Management Studio
            </h2>
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              Eliminate ambient microphone hums, electronic hiss, and background room noise. Perform spectral repairs locally or use Gemini AI for smart auto-tuning.
            </p>
          </div>

          {/* Quick Preview Player */}
          {audioBuffer && (
            <div className="flex items-center gap-3 shrink-0 self-start md:self-auto bg-slate-950 p-2 rounded-xl border border-slate-800">
              <button
                onClick={handleTogglePreview}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                  isPlayingPreview 
                    ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/35" 
                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                }`}
                title={isPlayingPreview ? "Stop Preview" : "Play Preview"}
                id="btn-noise-preview-toggle"
              >
                {isPlayingPreview ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-slate-950" />}
              </button>
              <div className="flex flex-col font-mono text-[9px] text-slate-400 pr-2">
                <span className="font-semibold text-slate-200">Pre-processing Audition</span>
                <span>Duration: {audioBuffer.duration.toFixed(2)}s</span>
              </div>
            </div>
          )}
        </div>

        {/* Local Non-AI DSP Card */}
        <div className="bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm overflow-hidden flex flex-col flex-1">
          {/* Internal Tab Bar */}
          <div className="bg-slate-950/80 px-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex gap-1 py-2">
              <button
                onClick={() => setActiveTab("denoise")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === "denoise"
                    ? "bg-slate-800 text-emerald-400 border border-slate-700"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                id="tab-btn-denoise"
              >
                1. Spectral Denoise (Audacity Style)
              </button>
              <button
                onClick={() => setActiveTab("gate")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === "gate"
                    ? "bg-slate-800 text-emerald-400 border border-slate-700"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                id="tab-btn-gate"
              >
                2. Noise Gate (Dynamic Expander)
              </button>
            </div>
            <span className="text-[9px] font-mono font-medium text-emerald-400/80 bg-emerald-950/30 border border-emerald-900/20 px-2 py-0.5 rounded-full">
              ⚡ Local DSP (No Limits)
            </span>
          </div>

          {/* Success Notification Alert */}
          {successMessage && (
            <div className="mx-6 mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs flex items-center justify-between gap-2.5 animate-fade-in" id="noise-success-alert">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-sans font-medium">{successMessage}</span>
              </div>
              <button 
                onClick={() => setSuccessMessage(null)}
                className="text-emerald-500 hover:text-emerald-300 text-[10px] font-bold cursor-pointer px-1.5 py-0.5 rounded hover:bg-emerald-500/10"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Tab 1 Content: Spectral Denoise */}
          {activeTab === "denoise" && (
            <div className="p-6 flex flex-col gap-6 flex-1">
              
              {/* Step A: Profile Selection */}
              <div className="flex flex-col gap-3 bg-slate-950/40 p-4 border border-slate-850 rounded-xl">
                <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                    Step A: Learn Ambient Noise Signature
                  </h3>
                  <span className="text-[10px] text-slate-500 font-mono">FFT Subtraction Profile</span>
                </div>

                <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
                  To remove noise transparently, first feed a sample of "pure silence" or ambient room mic noise. This builds a digital fingerprint of the unwanted frequencies.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center mt-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Profile Start Time</label>
                    <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max={audioBuffer ? audioBuffer.duration : 10}
                        value={profileRange.start}
                        onChange={(e) => setProfileRange({ ...profileRange, start: parseFloat(e.target.value) || 0 })}
                        className="bg-transparent text-xs text-slate-200 focus:outline-none w-full font-mono"
                      />
                      <span className="text-[10px] text-slate-500 font-mono">s</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Profile End Time</label>
                    <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max={audioBuffer ? audioBuffer.duration : 10}
                        value={profileRange.end}
                        onChange={(e) => setProfileRange({ ...profileRange, end: parseFloat(e.target.value) || 0 })}
                        className="bg-transparent text-xs text-slate-200 focus:outline-none w-full font-mono"
                      />
                      <span className="text-[10px] text-slate-500 font-mono">s</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleCaptureProfile}
                      disabled={!audioBuffer}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-semibold rounded-lg text-xs tracking-wide border border-slate-700 cursor-pointer disabled:bg-slate-950 disabled:text-slate-600 disabled:border-slate-850"
                      title="Learn noise profile from custom time range"
                      id="btn-noise-capture"
                    >
                      Capture Selection
                    </button>
                    <button
                      onClick={handleCaptureAuto}
                      disabled={!audioBuffer}
                      className="flex-1 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-bold rounded-lg text-xs tracking-wide border border-emerald-500/20 cursor-pointer disabled:bg-slate-950 disabled:text-slate-600"
                      title="Automatically find quietest spot in the file"
                      id="btn-noise-capture-auto"
                    >
                      Auto-Detect Profile
                    </button>
                  </div>
                </div>

                {/* Profile status banner */}
                <div className="mt-1">
                  {captureSuccess ? (
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-sans font-bold py-1 bg-emerald-500/10 border border-emerald-500/20 px-3 rounded-lg animate-pulse" id="capture-success-indicator">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>Profile captured successfully! Ready to apply local noise reduction below.</span>
                    </div>
                  ) : noiseProfile ? (
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono py-1">
                      <CheckCircle className="w-4 h-4" />
                      <span>Noise profile loaded successfully! Frequency model compiled with 513 bands. Ready to apply.</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-500 text-xs font-sans py-1">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>No noise profile learned yet. Capture a selection or click Auto-Detect Profile.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Step B: Filter Settings */}
              <div className="flex flex-col gap-4">
                <div className="border-b border-slate-800/60 pb-2">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                    Step B: Configure Spectral Gate Dials
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Noise Reduction Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-semibold flex items-center gap-1">Noise Reduction</span>
                      <span className="font-mono text-emerald-400 font-bold">{reductionDb} dB</span>
                    </div>
                    <input
                      type="range"
                      min="3"
                      max="30"
                      step="1"
                      value={reductionDb}
                      onChange={(e) => setReductionDb(parseInt(e.target.value))}
                      className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-500 font-sans">
                      Amount of attenuation to apply to learned noise bands. 12dB is standard; higher values may cause watery artifacts.
                    </span>
                  </div>

                  {/* Sensitivity Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-semibold flex items-center gap-1">Subtraction Sensitivity</span>
                      <span className="font-mono text-emerald-400 font-bold">{sensitivity.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.1"
                      value={sensitivity}
                      onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-500 font-sans">
                      Dials the aggression of frequency masking. Increase this value if faint noise continues to bleed through words.
                    </span>
                  </div>
                </div>

                {/* Apply Action Buttons */}
                <div className="flex items-center justify-between pt-4 border-t border-slate-800/50 mt-4">
                  <div>
                    {denoiseSuccess && (
                      <span className="text-xs text-emerald-400 font-bold animate-fade-in flex items-center gap-1.5 bg-emerald-950/30 px-3 py-1.5 border border-emerald-900/30 rounded-lg" id="denoise-success-label">
                        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                        Spectral denoise applied successfully!
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleApplyDenoise}
                    disabled={isDenoising || !audioBuffer || !noiseProfile}
                    className={`px-6 py-2.5 font-bold rounded-xl text-xs tracking-wide shadow-md cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5 ${
                      denoiseSuccess 
                        ? "bg-slate-850 text-emerald-400 border border-emerald-500/30" 
                        : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:bg-slate-950 disabled:text-slate-600 shadow-emerald-500/10"
                    }`}
                    id="btn-apply-noise-reduction"
                  >
                    {isDenoising ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Applying Spectral Subtraction...</span>
                      </>
                    ) : denoiseSuccess ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        <span>Applied Successfully! ✓</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4 fill-slate-950" />
                        <span>Apply Local Noise Reduction</span>
                      </>
                    )}
                  </button>
                </div>

              </div>

            </div>
          )}

          {/* Tab 2 Content: Noise Gate */}
          {activeTab === "gate" && (
            <div className="p-6 flex flex-col gap-5 flex-1">
              <div className="p-4 bg-slate-950/40 border border-slate-850 rounded-xl leading-relaxed text-xs text-slate-400 mb-2">
                <p className="flex items-start gap-1.5">
                  <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    A Noise Gate works in the time domain by silencing everything below a specific audio threshold volume. It uses a smooth attack, hold, and release cycle to avoid cutting off word tails or breath transitions. This is usually done in tandem with, or after, spectral noise removal.
                  </span>
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Gate Threshold */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-semibold">Gate Threshold</span>
                    <span className="font-mono text-emerald-400 font-bold">{gateThreshold} dBFS</span>
                  </div>
                  <input
                    type="range"
                    min="-80"
                    max="-20"
                    step="1"
                    value={gateThreshold}
                    onChange={(e) => setGateThreshold(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">
                    Level below which the gate closes. Standard is -45 dBFS.
                  </span>
                </div>

                {/* Gate Attenuation */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-semibold">Gate Attenuation / Reduction</span>
                    <span className="font-mono text-emerald-400 font-bold">{gateReduction} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="-12"
                    step="1"
                    value={gateReduction}
                    onChange={(e) => setGateReduction(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">
                    How much we silence signal below threshold. -100dB is complete silence, -40dB sounds softer.
                  </span>
                </div>

                {/* Attack Time */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-semibold">Attack Time</span>
                    <span className="font-mono text-emerald-400 font-bold">{gateAttack} ms</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={gateAttack}
                    onChange={(e) => setGateAttack(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">
                    How fast the gate opens back up. Standard is 5ms to avoid clipping vowels.
                  </span>
                </div>

                {/* Hold Time */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-semibold">Hold Time</span>
                    <span className="font-mono text-emerald-400 font-bold">{gateHold} ms</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={gateHold}
                    onChange={(e) => setGateHold(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">
                    How long the gate stays open after falling below threshold. Prevents gating between fast words.
                  </span>
                </div>

                {/* Release Time */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-semibold">Release Time</span>
                    <span className="font-mono text-emerald-400 font-bold">{gateRelease} ms</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="1000"
                    step="10"
                    value={gateRelease}
                    onChange={(e) => setGateRelease(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">
                    Decay window to smoothly fade out once the gate shuts. Prevents harsh abrupt stops.
                  </span>
                </div>

              </div>

              {/* Apply Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800/50 mt-4">
                <div>
                  {gateSuccess && (
                    <span className="text-xs text-emerald-400 font-bold animate-fade-in flex items-center gap-1.5 bg-emerald-950/30 px-3 py-1.5 border border-emerald-900/30 rounded-lg" id="gate-success-label">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      Noise gate applied successfully!
                    </span>
                  )}
                </div>
                <button
                  onClick={handleApplyGate}
                  disabled={isGating || !audioBuffer}
                  className={`px-6 py-2.5 font-bold rounded-xl text-xs tracking-wide shadow-md cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5 ${
                    gateSuccess 
                      ? "bg-slate-850 text-emerald-400 border border-emerald-500/30" 
                      : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:bg-slate-950 disabled:text-slate-600 shadow-emerald-500/10"
                  }`}
                  id="btn-apply-noise-gate"
                >
                  {isGating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Applying Noise Gate...</span>
                    </>
                  ) : gateSuccess ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>Applied Successfully! ✓</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4 fill-slate-950" />
                      <span>Apply Local Noise Gate</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          )}

        </div>

      </div>

      {/* Right Column: AI Auto-Tuner & Recommendations */}
      <div className="lg:col-span-4 flex flex-col gap-6" id="noise-studio-ai-sidebar">
        
        {/* Gemini AI Modeling Card */}
        <div className="p-6 bg-gradient-to-b from-slate-900/65 to-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col gap-4">
          <div className="flex items-center gap-2 border-b border-slate-850 pb-3">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
              Gemini AI Wave Auto-Tuner
            </h3>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Unsure of what thresholds to use? Use Gemini to run a high-definition analysis of your audio spectrum and auto-tune the Dynamic Gate thresholds.
          </p>

          <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-xl text-[10px] text-amber-400 flex items-start gap-1.5 font-sans">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>Warning</strong>: This function calls the Gemini API server-side, which counts against daily usage quotas.
            </span>
          </div>

          <button
            onClick={handleAiOptimize}
            disabled={isAiAnalyzing || !audioBuffer || !originalFile}
            className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 text-emerald-400 border border-slate-800 hover:border-emerald-500/30 font-bold rounded-xl text-xs tracking-wide transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            id="btn-ai-optimize-noise"
          >
            {isAiAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Gemini Analysis Modeling...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 fill-emerald-400/20" />
                <span>Tune Dials with Gemini AI</span>
              </>
            )}
          </button>

          {/* AI Analysis Result Board */}
          {aiReport && (
            <div className="mt-2 flex flex-col gap-3 bg-slate-950/60 p-4 border border-slate-800/60 rounded-xl" id="ai-noise-report-card">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 border-b border-slate-900 pb-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Gemini Signature Recommendations</span>
              </div>

              <div className="flex flex-col gap-2 font-sans text-xs">
                <div className="flex justify-between border-b border-slate-900/40 pb-1">
                  <span className="text-slate-400 font-medium">Auto-Tuned Gate:</span>
                  <span className="font-mono text-slate-200">{gateThreshold} dBFS</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Acoustic Diagnosis:</span>
                  <p className="text-[11px] text-slate-300 italic leading-relaxed bg-slate-900/40 p-2 rounded border border-slate-900">
                    "{aiReport.loudnessDiagnosis || "Background noise identified in gaps. Applied adaptive gating profile."}"
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* DSP Best Practice Guide */}
        <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col gap-4 text-xs text-slate-400 leading-relaxed">
          <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 uppercase tracking-wide text-[10px] border-b border-slate-800 pb-2">
            <Info className="w-4 h-4 text-emerald-400" />
            DSP Noise Management Guide
          </h4>
          <ul className="flex flex-col gap-3 list-decimal list-inside ml-1">
            <li>
              <strong>Spectral Denoise First</strong>: Always run learned Spectral Noise Reduction first. This separates steady hums from human consonants.
            </li>
            <li>
              <strong>Keep Profile Pure</strong>: Ensure your Noise Profile timing range is 100% quiet; capturing vocals inside the profile will cause speech frequencies to be filtered out.
            </li>
            <li>
              <strong>Gate with Care</strong>: Use the Noise Gate afterward to wipe out any residual low-volume hiss during active breathing/pauses.
            </li>
            <li>
              <strong>Check with the Auto-Tuner</strong>: If unsure, use Gemini AI's Smart Wave Tuner to establish optimal gating threshold parameters safely.
            </li>
          </ul>
        </div>

      </div>

    </div>
  );
}
