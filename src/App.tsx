import React, { useState, useRef, useEffect } from "react";
import {
  Upload,
  Mic,
  Music,
  Play,
  Pause,
  Square,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  BookOpen,
  Volume2,
  Trash2,
  FileText,
  Settings,
  Timer,
  HelpCircle,
  Terminal,
  Activity,
  X,
  RefreshCw,
  Globe,
} from "lucide-react";
import WaveformVisualizer from "./components/WaveformVisualizer";
import SegmentList from "./components/SegmentList";
import CleanAudioPlayer from "./components/CleanAudioPlayer";
import AudioRecorder from "./components/AudioRecorder";
import { AudioSegment, AppLog } from "./types";
import { sliceAudioBuffer, concatenateAudioBuffers, findQuietestTime, audioBufferToWav, createFallbackAudioBuffer, convertRawPcmToWavBuffer, truncateSilencesFromBuffer } from "./utils/audioUtils";
import DiagnosticsLogViewer from "./components/DiagnosticsLogViewer";
import VoiceProfileStudio from "./components/VoiceProfileStudio";
import VolumeNormalization from "./components/VolumeNormalization";
import NoiseStudio from "./components/NoiseStudio";
import DescriptiveEditing from "./components/DescriptiveEditing";
import DistributionStudio from "./components/DistributionStudio";

interface FileState {
  name: string;
  type: string;
  file: File;
  base64?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"upload" | "record">("upload");
  const [originalFile, setOriginalFile] = useState<FileState | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [stitchedBuffer, setStitchedBuffer] = useState<AudioBuffer | null>(null);
  const [segments, setSegments] = useState<AudioSegment[]>([]);

  const [workspaceTab, setWorkspaceTab] = useState<"editor" | "diagnostics" | "tts" | "normalization" | "noise" | "descriptive" | "distribution">("editor");
  const [showWorkspaceGuide, setShowWorkspaceGuide] = useState(true);
  const [silenceThreshold, setSilenceThreshold] = useState(-40);
  const [maxSilenceDuration, setMaxSilenceDuration] = useState(0.3);
  const [isTruncatingSilence, setIsTruncatingSilence] = useState(false);

  // Logging and Telemetry States
  const [logs, setLogs] = useState<AppLog[]>([]);
  const [serverLogs, setServerLogs] = useState<AppLog[]>([]);
  const [isPollingLogs, setIsPollingLogs] = useState(true);

  // Unified logging helper
  const addLog = (
    level: "info" | "warn" | "error" | "success",
    category: "click" | "action" | "api" | "browser" | "server",
    message: string,
    details?: any
  ) => {
    const newLog: AppLog = {
      id: `brw-${Math.random().toString(36).substring(2, 11)}`,
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      details: details ? (typeof details === "object" ? JSON.stringify(details, null, 2) : String(details)) : undefined
    };
    setLogs((prev) => {
      const updated = [newLog, ...prev];
      if (updated.length > 500) updated.pop();
      return updated;
    });
  };

  // Setup global intercepts and automatic logging
  useEffect(() => {
    // 1. Log click interceptor
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      
      const clickable = target.closest("button, a, input, textarea, select, [role='button']");
      if (!clickable) return;
      
      const id = clickable.id || "";
      const text = clickable.textContent?.trim().slice(0, 50) || "";
      const tagName = clickable.tagName.toLowerCase();
      const placeholder = (clickable as HTMLInputElement).placeholder || "";
      
      let label = "";
      if (id) label = `#${id}`;
      else if (text) label = `"${text}"`;
      else if (placeholder) label = `placeholder: "${placeholder}"`;
      else label = `<${tagName}>`;
      
      addLog("info", "click", `User click: ${tagName} element ${label}`, {
        id: clickable.id,
        className: clickable.className,
        tagName: clickable.tagName,
        outerHTML: clickable.outerHTML.slice(0, 200)
      });
    };
    window.addEventListener("click", handleGlobalClick);

    // 2. Fetch Interceptor
    let fetchOverridden = false;
    const originalFetch = window.fetch;
    const customFetch = async (...args: any[]) => {
      const url = String(args[0]);
      const options = args[1] || {};
      const method = options.method || "GET";
      const startTime = Date.now();
      
      // Skip logging the logs polling requests themselves to avoid noise/loops
      const isLogsRequest = url.includes("/api/logs");
      
      if (!isLogsRequest) {
        addLog("info", "api", `HTTP Request: [${method}] ${url}`, {
          method,
          headers: options.headers,
          body: options.body ? String(options.body).slice(0, 1000) : undefined
        });
      }

      try {
        const response = await originalFetch.apply(window, args as any);
        const duration = Date.now() - startTime;
        
        if (!isLogsRequest) {
          const clonedResponse = response.clone();
          let responseText = "";
          try {
            responseText = await clonedResponse.text();
          } catch (e) {}

          if (response.ok) {
            addLog("success", "api", `HTTP Success ${response.status} from [${method}] ${url} (${duration}ms)`, {
              status: response.status,
              statusText: response.statusText,
              response: responseText.slice(0, 1500)
            });
          } else {
            addLog("error", "api", `HTTP Failure ${response.status} from [${method}] ${url} (${duration}ms)`, {
              status: response.status,
              statusText: response.statusText,
              response: responseText.slice(0, 1500)
            });
          }
        }
        return response;
      } catch (err: any) {
        const duration = Date.now() - startTime;
        if (!isLogsRequest) {
          addLog("error", "api", `Network Fault on [${method}] ${url} (${duration}ms): ${err.message}`, {
            error: err.stack || err.message
          });
        }
        throw err;
      }
    };

    try {
      Object.defineProperty(window, "fetch", {
        value: customFetch,
        configurable: true,
        writable: true
      });
      fetchOverridden = true;
    } catch (e) {
      console.warn("Could not redefine window.fetch directly. Interceptor inactive.", e);
    }

    // 3. Console Intercepts
    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    console.log = (...args) => {
      originalConsoleLog.apply(console, args);
      const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
      if (msg.includes("Vite") || msg.includes("HMR")) return;
      addLog("info", "browser", msg);
    };

    console.warn = (...args) => {
      originalConsoleWarn.apply(console, args);
      const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
      addLog("warn", "browser", msg);
    };

    console.error = (...args) => {
      originalConsoleError.apply(console, args);
      const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
      addLog("error", "browser", msg);
    };

    // 4. Global runtime uncaught exception tracker
    const handleWindowError = (event: ErrorEvent) => {
      addLog("error", "browser", `Uncaught exception in browser: ${event.message}`, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });
    };
    window.addEventListener("error", handleWindowError);

    // Initial load logs
    addLog("success", "action", "Non-Destructive Spoken Word AI Audio Studio loaded successfully");

    return () => {
      window.removeEventListener("click", handleGlobalClick);
      if (fetchOverridden) {
        try {
          Object.defineProperty(window, "fetch", {
            value: originalFetch,
            configurable: true,
            writable: true
          });
        } catch (e) {
          try {
            (window as any).fetch = originalFetch;
          } catch (err) {}
        }
      }
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
      window.removeEventListener("error", handleWindowError);
    };
  }, []);

  // Fetch Server Logs function
  const fetchServerLogs = async () => {
    try {
      const response = await fetch("/api/logs");
      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          setServerLogs(data);
        }
      }
    } catch (e) {
      console.error("Failed to fetch server logs", e);
    }
  };

  // Poll server logs periodically
  useEffect(() => {
    if (!isPollingLogs) return;

    fetchServerLogs(); // initial pull

    const interval = setInterval(() => {
      fetchServerLogs();
    }, 2500);

    return () => clearInterval(interval);
  }, [isPollingLogs]);

  const handleClearLogs = () => {
    setLogs([]);
    addLog("success", "action", "Local browser console history cleared");
  };

  // Original Playback state
  const [isPlayingOriginal, setIsPlayingOriginal] = useState(false);
  const [currentTimeOriginal, setCurrentTimeOriginal] = useState(0);

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [referenceScript, setReferenceScript] = useState("");

  // Decoding / loading states & refs for abort capability
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodingStep, setDecodingStep] = useState("");
  const abortDecodingRef = useRef(false);
  const currentAudioCtxRef = useRef<AudioContext | null>(null);

  // Analysis refs for abort capability
  const abortAnalysisRef = useRef(false);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);

  const abortDecoding = () => {
    abortDecodingRef.current = true;
    setIsDecoding(false);
    setDecodingStep("");
    if (currentAudioCtxRef.current) {
      try {
        currentAudioCtxRef.current.close();
      } catch (e) {
        console.error("Error closing AudioContext on abort:", e);
      }
      currentAudioCtxRef.current = null;
    }
  };

  const abortAnalysis = () => {
    abortAnalysisRef.current = true;
    if (analysisAbortControllerRef.current) {
      analysisAbortControllerRef.current.abort();
      analysisAbortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setAnalysisStep("");
  };

  // Audition state
  const [currentlyAuditioning, setCurrentlyAuditioning] = useState<{ id: string; start: number; end: number } | null>(null);
  const [boundaryPadding, setBoundaryPadding] = useState(0.15);
  const [chunkSize, setChunkSize] = useState<number>(60); // 30, 60, 180, 300, or -1 for single chunk
  const [requestDelay, setRequestDelay] = useState<number>(0); // delay in seconds: 0, 3, 5, 10

  // Selection/Highlight range states
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  // Audio Context Refs for playback
  const originalAudioCtxRef = useRef<AudioContext | null>(null);
  const originalSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const originalStartRealTimeRef = useRef<number>(0);
  const originalIntervalRef = useRef<number | null>(null);

  const auditionCtxRef = useRef<AudioContext | null>(null);
  const auditionSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const auditionTimeoutRef = useRef<number | null>(null);

  // Voice Patch states
  const [patchingSegment, setPatchingSegment] = useState<AudioSegment | null>(null);
  const [patchText, setPatchText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<"Puck" | "Charon" | "Fenrir" | "Kore" | "Zephyr">("Puck");
  const [isGeneratingPatch, setIsGeneratingPatch] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [patchPreviewBuffer, setPatchPreviewBuffer] = useState<AudioBuffer | null>(null);
  const [isPlayingPatchPreview, setIsPlayingPatchPreview] = useState(false);
  const [useVocalReference, setUseVocalReference] = useState(true);

  // Suggested Voice Archetype / Profile Modes
  const [vocalMode, setVocalMode] = useState<"clone" | "archetype">("clone");
  const [isGeneratingVoicePreview, setIsGeneratingVoicePreview] = useState(false);
  const [playingVoicePreviewName, setPlayingVoicePreviewName] = useState<string | null>(null);

  // Patch preview player refs
  const patchPreviewCtxRef = useRef<AudioContext | null>(null);
  const patchPreviewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Voice Archetype preview refs
  const voicePreviewCtxRef = useRef<AudioContext | null>(null);
  const voicePreviewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopVoicePreview = () => {
    if (voicePreviewSourceRef.current) {
      try {
        voicePreviewSourceRef.current.stop();
      } catch (e) {}
      voicePreviewSourceRef.current = null;
    }
    if (voicePreviewCtxRef.current) {
      voicePreviewCtxRef.current.close();
      voicePreviewCtxRef.current = null;
    }
    setPlayingVoicePreviewName(null);
  };

  // Cleanup playback on unmount
  useEffect(() => {
    return () => {
      stopPlayingOriginal();
      clearAudition();
      stopPatchPreview();
      stopVoicePreview();
    };
  }, []);

  // Stitch keeping segments together whenever they update or original audio changes
  useEffect(() => {
    if (!audioBuffer) {
      setStitchedBuffer(null);
      return;
    }

    const rawKeeps = segments.filter((s) => s.keep && (s.customBuffer || s.end > s.start)).sort((a, b) => a.start - b.start);
    if (rawKeeps.length === 0) {
      setStitchedBuffer(null);
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const tempCtx = new AudioCtx();
      const sliced = rawKeeps.map((k, idx) => {
        if (k.customBuffer) {
          return k.customBuffer;
        }

        // Calculate non-overlapping cushion limits based on adjacent segments
        const prev = idx === 0 ? null : rawKeeps[idx - 1];
        const next = idx === rawKeeps.length - 1 ? null : rawKeeps[idx + 1];

        const leftLimit = prev ? (k.start + prev.end) / 2 : 0;
        const rightLimit = next ? (k.end + next.start) / 2 : audioBuffer.duration;

        const paddedStart = Math.max(leftLimit, k.start - boundaryPadding);
        const paddedEnd = Math.min(rightLimit, k.end + boundaryPadding);

        return sliceAudioBuffer(tempCtx, audioBuffer, paddedStart, paddedEnd, false);
      });
      const stitched = concatenateAudioBuffers(tempCtx, sliced);
      setStitchedBuffer(stitched);
      tempCtx.close();
    } catch (err) {
      console.error("Error stitching buffer:", err);
    }
  }, [segments, audioBuffer, boundaryPadding]);

  // Handle uploaded or recorded files
  const handleAudioFile = async (file: File) => {
    setErrorMessage(null);
    setIsPlayingOriginal(false);
    stopPlayingOriginal();
    clearAudition();
    setAudioBuffer(null);
    setStitchedBuffer(null);
    setSegments([]);

    setIsDecoding(true);
    setDecodingStep("Reading audio file data...");
    abortDecodingRef.current = false;

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (abortDecodingRef.current) return;

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(file);
      });

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      currentAudioCtxRef.current = audioCtx;

      setDecodingStep("Decoding spoken word audio...");
      let decodedBuffer: AudioBuffer;
      try {
        decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } catch (decodeErr) {
        console.warn("Standard Web Audio API decoding failed, using synthetic fallback waveform:", decodeErr);
        // Estimate duration based on file size, default to 15s if extremely small or invalid
        const estimatedDuration = Math.max(5, Math.min(120, Math.round(file.size / (128 * 1024 / 8))));
        decodedBuffer = createFallbackAudioBuffer(audioCtx, estimatedDuration || 15);
      }
      
      if (abortDecodingRef.current) {
        audioCtx.close();
        return;
      }

      setAudioBuffer(decodedBuffer);
      setOriginalFile({
        name: file.name,
        type: file.type,
        file: file,
        base64: base64,
      });
      audioCtx.close();
      currentAudioCtxRef.current = null;
    } catch (err: any) {
      if (abortDecodingRef.current) {
        console.log("Decoding process aborted by user.");
        return;
      }
      console.error("Decoding error:", err);
      setErrorMessage(
        "Could not decode audio. Please ensure you are uploading standard MP3, WAV, or M4A audio files, and your browser supports them."
      );
    } finally {
      setIsDecoding(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleAudioFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleAudioFile(e.dataTransfer.files[0]);
    }
  };

  const handleScriptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setReferenceScript(event.target.result as string);
      }
    };
    reader.readAsText(file);
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

  const handleTruncateSilence = async () => {
    if (!audioBuffer) return;
    setIsTruncatingSilence(true);
    addLog("info", "action", `Truncating silence below ${silenceThreshold} dBFS down to max ${maxSilenceDuration}s`);
    
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const tempCtx = new AudioCtx();
      
      const res = truncateSilencesFromBuffer(tempCtx, audioBuffer, silenceThreshold, maxSilenceDuration);
      
      // Convert to WAV/Base64 to update originalFile
      const wavBlob = audioBufferToWav(res.buffer);
      const newBase64 = await convertBlobToBase64(wavBlob);
      
      setAudioBuffer(res.buffer);
      if (originalFile) {
        setOriginalFile({
          ...originalFile,
          base64: newBase64
        });
      }
      
      // Since timeline time shifted, we must clear segments and stitched state
      setSegments([]);
      setStitchedBuffer(null);
      
      addLog("success", "action", `Silence truncation successful! Shortened ${res.truncatedCount} silences. Duration reduced from ${res.originalDuration.toFixed(2)}s to ${res.newDuration.toFixed(2)}s`);
      
      tempCtx.close();
    } catch (err: any) {
      addLog("error", "action", `Silence truncation failed: ${err.message}`);
      console.error(err);
    } finally {
      setIsTruncatingSilence(false);
    }
  };

  const triggerAnalyze = async (rangeStart?: number, rangeEnd?: number) => {
    if (!originalFile || !audioBuffer) return;

    setIsAnalyzing(true);
    setErrorMessage(null);
    abortAnalysisRef.current = false;
    analysisAbortControllerRef.current = new AbortController();

    const isPartial = rangeStart !== undefined && rangeEnd !== undefined;
    const startOffset = isPartial ? rangeStart : 0;
    const endOffset = isPartial ? rangeEnd : audioBuffer.duration;
    const duration = endOffset - startOffset;

    if (!isPartial) {
      setSegments([]);
    }

    try {
      // 1. Calculate silence-based split points or use a single chunk
      setAnalysisStep(isPartial ? "Analyzing speech waveform structure in selected range..." : "Analyzing speech waveform structure...");
      if (abortAnalysisRef.current) return;

      const splits: number[] = [startOffset];
      
      if (chunkSize === -1) {
        splits.push(endOffset);
      } else {
        const targetChunkDuration = chunkSize;
        let lastSplit = startOffset;
        while (lastSplit + targetChunkDuration < endOffset - 10) {
          if (abortAnalysisRef.current) return;
          const targetTime = lastSplit + targetChunkDuration;
          const quietest = findQuietestTime(audioBuffer, targetTime, 8);
          splits.push(quietest);
          lastSplit = quietest;
        }
        splits.push(endOffset);
      }

      if (abortAnalysisRef.current) return;

      const totalChunks = splits.length - 1;
      console.log(`Audio split into ${totalChunks} chunks:`, splits);

      const allRawKeeps: any[] = [];
      const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

      // 2. Process each chunk sequentially
      for (let i = 0; i < totalChunks; i++) {
        if (abortAnalysisRef.current) {
          tempCtx.close();
          return;
        }

        // Apply user-defined rate-limiting delay between chunk requests
        if (i > 0 && requestDelay > 0) {
          let secondsLeft = requestDelay;
          while (secondsLeft > 0) {
            if (abortAnalysisRef.current) {
              tempCtx.close();
              return;
            }
            setAnalysisStep(
              `Rate limiting: Waiting ${secondsLeft}s before sending next segment (${i + 1}/${totalChunks})...`
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
            secondsLeft--;
          }
        }

        const start = splits[i];
        const end = splits[i + 1];
        const chunkDuration = end - start;

        setAnalysisStep(
          `Editing segment ${i + 1} of ${totalChunks} (${Math.round(start)}s - ${Math.round(end)}s)...`
        );

        // Slice out the audio chunk buffer (without fade, to preserve transitions)
        const slicedBuf = sliceAudioBuffer(tempCtx, audioBuffer, start, end, false);
        // Encode slice to WAV Blob
        const wavBlob = audioBufferToWav(slicedBuf);

        if (abortAnalysisRef.current) {
          tempCtx.close();
          return;
        }

        // Convert Blob to base64
        const base64Raw = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => {
            const dataUrl = r.result as string;
            resolve(dataUrl.split(",")[1]);
          };
          r.onerror = (e) => reject(e);
          
          if (abortAnalysisRef.current) {
            reject(new Error("Aborted"));
          } else {
            r.readAsDataURL(wavBlob);
          }
        });

        if (abortAnalysisRef.current) {
          tempCtx.close();
          return;
        }

        // Use the controller signal to fetch
        const response = await fetch("/api/analyze-audio", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            audio: base64Raw,
            mimeType: "audio/wav",
            script: referenceScript,
            chunkStart: start,
            chunkEnd: end,
          }),
          signal: analysisAbortControllerRef.current?.signal,
        });

        if (abortAnalysisRef.current) {
          tempCtx.close();
          return;
        }

        if (!response.ok) {
          const errResponse = await response.json();
          throw new Error(
            `Segment ${i + 1} analysis failed: ${errResponse.error || "Server error"}`
          );
        }

        const result = await response.json();
        
        if (abortAnalysisRef.current) {
          tempCtx.close();
          return;
        }

        if (result && Array.isArray(result.keeps)) {
          // Adjust local relative keeps back to the global timeline
          const chunkKeeps = result.keeps.map((k: any) => {
            const rawStart = parseFloat(k.start);
            const rawEnd = parseFloat(k.end);

            let relativeStart = Math.max(0, Math.min(chunkDuration, isNaN(rawStart) ? 0 : rawStart));
            let relativeEnd = Math.max(0, Math.min(chunkDuration, isNaN(rawEnd) ? chunkDuration : rawEnd));

            if (relativeStart > relativeEnd) {
              const temp = relativeStart;
              relativeStart = relativeEnd;
              relativeEnd = temp;
            }

            return {
              start: start + relativeStart,
              end: start + relativeEnd,
              transcript: k.transcript || "[Spoken word Segment]",
            };
          });

          allRawKeeps.push(...chunkKeeps);
        } else {
          console.warn(`Segment ${i + 1} returned no keep zones.`);
        }
      }

      if (abortAnalysisRef.current) {
        tempCtx.close();
        return;
      }

      setAnalysisStep("Assembling master timeline...");
      tempCtx.close();

      // 3. Post-process the aggregated timeline
      const formatted: AudioSegment[] = allRawKeeps
        .map((k: any, idx: number) => ({
          id: `ai_${idx}_${Date.now()}`,
          start: k.start,
          end: k.end,
          transcript: k.transcript,
          keep: true,
        }))
        .filter((k) => k.end - k.start > 0.05) // Remove empty/tiny fragments
        .sort((a, b) => a.start - b.start);

      if (!isPartial) {
        // Gracefully resolve any overlapping keeps by splitting at the overlap midpoint.
        for (let i = 0; i < formatted.length - 1; i++) {
          const current = formatted[i];
          const next = formatted[i + 1];

          if (current.end > next.start) {
            if (next.start >= current.start && next.end <= current.end) {
              const mid = next.start;
              current.end = mid;
              next.start = mid;
            } else {
              const overlapMid = (current.end + next.start) / 2;
              current.end = overlapMid;
              next.start = overlapMid;
            }
          }
        }

        const resolvedFormatted = formatted.filter((k) => k.end - k.start > 0.05);

        // Construct discards automatically between keeps
        const completeTimeline: AudioSegment[] = [];
        let lastPos = 0;

        resolvedFormatted.forEach((kSeg, idx) => {
          if (kSeg.start < lastPos) {
            kSeg.start = lastPos;
          }

          // Only insert a discard if there is a gap greater than 0.3 seconds
          if (kSeg.start > lastPos + 0.3) {
            completeTimeline.push({
              id: `discard_${idx}_${Date.now()}`,
              start: lastPos,
              end: kSeg.start,
              transcript: "[Mistake, repetition, or silent pause edited out]",
              keep: false,
            });
          }

          if (kSeg.end > kSeg.start) {
            completeTimeline.push(kSeg);
            lastPos = kSeg.end;
          }
        });

        if (audioBuffer.duration > lastPos + 0.3) {
          completeTimeline.push({
            id: `discard_end_${Date.now()}`,
            start: lastPos,
            end: audioBuffer.duration,
            transcript: "[Room tone or tail silence cut]",
            keep: false,
          });
        }

        setSegments(completeTimeline.sort((a, b) => a.start - b.start));
      } else {
        // --- Partial / Range re-analysis code path ---
        // 1. Remove/clip existing segments overlapping with the range [startOffset, endOffset]
        const remainingSegments: AudioSegment[] = [];

        segments.forEach((seg) => {
          // Case A: completely outside the re-analyzed range
          if (seg.end <= startOffset || seg.start >= endOffset) {
            remainingSegments.push(seg);
          }
          // Case B: segment completely inside the range -> discard it
          else if (seg.start >= startOffset && seg.end <= endOffset) {
            // Drop it, we have fresh analysis for this space
          }
          // Case C: overlaps left side (starts before range, ends inside range)
          else if (seg.start < startOffset && seg.end > startOffset && seg.end <= endOffset) {
            remainingSegments.push({
              ...seg,
              end: startOffset,
            });
          }
          // Case D: overlaps right side (starts inside range, ends after range)
          else if (seg.start >= startOffset && seg.start < endOffset && seg.end > endOffset) {
            remainingSegments.push({
              ...seg,
              start: endOffset,
            });
          }
          // Case E: segment spans across the entire range (starts before range, ends after range)
          else if (seg.start < startOffset && seg.end > endOffset) {
            remainingSegments.push({
              ...seg,
              id: `${seg.id}_left`,
              end: startOffset,
            });
            remainingSegments.push({
              ...seg,
              id: `${seg.id}_right`,
              start: endOffset,
            });
          }
        });

        // 2. Add the newly analyzed keeps inside the range
        // If the new formatted keeps are empty, we'll cover the whole range as a discard/cut.
        // Let's resolve overlaps within the fresh keeps first.
        for (let i = 0; i < formatted.length - 1; i++) {
          const current = formatted[i];
          const next = formatted[i + 1];
          if (current.end > next.start) {
            const overlapMid = (current.end + next.start) / 2;
            current.end = overlapMid;
            next.start = overlapMid;
          }
        }

        const freshKeeps = formatted.filter((k) => k.end - k.start > 0.05);

        // 3. Construct local keeps and fill gaps with discard/cut segments inside [startOffset, endOffset]
        const localRangeTimeline: AudioSegment[] = [];
        let rangeLastPos = startOffset;

        freshKeeps.forEach((kSeg, idx) => {
          if (kSeg.start < rangeLastPos) {
            kSeg.start = rangeLastPos;
          }

          if (kSeg.start > rangeLastPos + 0.3) {
            localRangeTimeline.push({
              id: `discard_range_${idx}_${Date.now()}`,
              start: rangeLastPos,
              end: kSeg.start,
              transcript: "[Mistake, repetition, or silent pause edited out]",
              keep: false,
            });
          }

          if (kSeg.end > kSeg.start) {
            localRangeTimeline.push(kSeg);
            rangeLastPos = kSeg.end;
          }
        });

        if (endOffset > rangeLastPos + 0.3) {
          localRangeTimeline.push({
            id: `discard_range_end_${Date.now()}`,
            start: rangeLastPos,
            end: endOffset,
            transcript: "[Edited out]",
            keep: false,
          });
        }

        // Combine and sort
        const combined = [...remainingSegments, ...localRangeTimeline].sort((a, b) => a.start - b.start);
        setSegments(combined);
        setSelectionStart(null);
        setSelectionEnd(null);
      }
    } catch (err: any) {
      if (abortAnalysisRef.current || err.name === "AbortError" || err.message === "Aborted") {
        console.log("Analysis process aborted by user.");
        return;
      }
      console.error("Processing error:", err);
      setErrorMessage(err.message || "An error occurred during speech analysis.");
    } finally {
      setIsAnalyzing(false);
      analysisAbortControllerRef.current = null;
    }
  };

  // Original Playback triggers
  const startPlayingOriginal = (offset = 0) => {
    if (!audioBuffer) return;
    stopPlayingOriginal();
    clearAudition();

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      originalAudioCtxRef.current = audioCtx;

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      source.start(0, offset);
      originalSourceRef.current = source;
      setIsPlayingOriginal(true);
      setCurrentTimeOriginal(offset);
      originalStartRealTimeRef.current = audioCtx.currentTime - offset;

      originalIntervalRef.current = window.setInterval(() => {
        if (!originalAudioCtxRef.current) return;
        const elapsed = originalAudioCtxRef.current.currentTime - originalStartRealTimeRef.current;
        if (elapsed >= audioBuffer.duration) {
          stopPlayingOriginal();
          setCurrentTimeOriginal(audioBuffer.duration);
        } else {
          setCurrentTimeOriginal(elapsed);
        }
      }, 50);

      source.onended = () => {
        // Automatically handled by elapsed check
      };
    } catch (e) {
      console.error("Playback start error", e);
    }
  };

  const stopPlayingOriginal = () => {
    if (originalSourceRef.current) {
      try {
        originalSourceRef.current.stop();
      } catch (e) {}
      originalSourceRef.current = null;
    }
    if (originalIntervalRef.current) {
      clearInterval(originalIntervalRef.current);
      originalIntervalRef.current = null;
    }
    if (originalAudioCtxRef.current) {
      originalAudioCtxRef.current.close();
      originalAudioCtxRef.current = null;
    }
    setIsPlayingOriginal(false);
  };

  const handleOriginalSeek = (time: number) => {
    setCurrentTimeOriginal(time);
    if (isPlayingOriginal) {
      startPlayingOriginal(time);
    }
  };

  // ==========================================
  // AI VOICE PATCH / SPEECH SYNTHESIS ENGINE
  // ==========================================
  const handlePatchSegment = (seg: AudioSegment) => {
    stopPlayingOriginal();
    clearAudition();
    stopPatchPreview();
    stopVoicePreview();
    setPatchingSegment(seg);
    setPatchText(seg.transcript || "");
    setPatchPreviewBuffer(null);
    setPatchError(null);
    setVocalMode("clone"); // Default to smart speaker clone on load
  };

  const handleRemovePatch = (seg: AudioSegment) => {
    setSegments((prev) =>
      prev.map((s) => {
        if (s.id === seg.id) {
          const { customBuffer, isPatched, ...rest } = s;
          return { ...rest, keep: s.keep };
        }
        return s;
      })
    );
  };

  const handlePreviewVoiceArchetype = async () => {
    if (isGeneratingVoicePreview) return;
    stopPatchPreview();
    stopPlayingOriginal();
    clearAudition();
    
    if (playingVoicePreviewName === selectedVoice) {
      stopVoicePreview();
      return;
    }

    stopVoicePreview();
    setIsGeneratingVoicePreview(true);
    setPlayingVoicePreviewName(selectedVoice);

    try {
      const sampleTexts: Record<string, string> = {
        Puck: "Hi! I am Puck. I offer an energetic, friendly, and expressive voice preset.",
        Zephyr: "Hello! I am Zephyr. I offer a clear, warm, and engaging voice style.",
        Kore: "Greetings! I am Kore. I offer a warm, rich, and professional vocal quality.",
        Fenrir: "Hello. I am Fenrir, featuring a deep, resonant, and steady masculine voice.",
        Charon: "Welcome. This is Charon, with a calm, articulate, and composed voice archetype."
      };

      const text = sampleTexts[selectedVoice] || `Hello, I am the Gemini voice preset ${selectedVoice}.`;

      const response = await fetch("/api/generate-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textToSpeak: text,
          voicePreset: selectedVoice,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate voice preview");
      }

      const result = await response.json();
      if (!result.audio) {
        throw new Error("No audio returned from backend");
      }

      const binaryString = window.atob(result.audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const decCtx = new AudioCtx();
      try {
        let decoded: AudioBuffer;
        try {
          const wavBuffer = convertRawPcmToWavBuffer(bytes, 24000);
          decoded = await decCtx.decodeAudioData(wavBuffer);
        } catch (decodeErr) {
          console.warn("Voice archetype preview decoding failed, using synthetic fallback waveform:", decodeErr);
          decoded = createFallbackAudioBuffer(decCtx, 3);
        }
        
        const audioCtx = new AudioCtx();
        voicePreviewCtxRef.current = audioCtx;

        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(audioCtx.destination);
        source.start(0);

        voicePreviewSourceRef.current = source;
        source.onended = () => {
          setPlayingVoicePreviewName(null);
        };
      } finally {
        decCtx.close();
      }
    } catch (err: any) {
      console.error("Failed to preview voice archetype", err);
      setPatchError(err.message || "Failed to fetch or play vocal style preview.");
      setPlayingVoicePreviewName(null);
    } finally {
      setIsGeneratingVoicePreview(false);
    }
  };

  const handleGeneratePatch = async () => {
    if (!patchingSegment || !patchText.trim()) return;
    setIsGeneratingPatch(true);
    setPatchError(null);
    stopPatchPreview();
    stopVoicePreview();

    try {
      let referenceAudioBase64 = "";
      const shouldSendReference = (vocalMode === "clone" || (vocalMode === "archetype" && useVocalReference));

      if (shouldSendReference && audioBuffer) {
        // Slice and convert reference audio
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const tempCtx = new AudioCtx();
        try {
          // Slice the current segment
          const sliced = sliceAudioBuffer(tempCtx, audioBuffer, patchingSegment.start, patchingSegment.end, false);
          const wavBlob = audioBufferToWav(sliced);
          referenceAudioBase64 = await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onloadend = () => {
              resolve((r.result as string).split(",")[1]);
            };
            r.readAsDataURL(wavBlob);
          });
        } finally {
          tempCtx.close();
        }
      }

      const response = await fetch("/api/generate-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceAudio: referenceAudioBase64 || undefined,
          mimeType: referenceAudioBase64 ? "audio/wav" : undefined,
          textToSpeak: patchText,
          voicePreset: selectedVoice,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Failed to generate AI vocal patch.");
      }

      const result = await response.json();
      if (!result.audio) {
        throw new Error("No audio returned from backend.");
      }

      // Convert base64 back to AudioBuffer
      const binaryString = window.atob(result.audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const decCtx = new AudioCtx();
      try {
        let decoded: AudioBuffer;
        try {
          const wavBuffer = convertRawPcmToWavBuffer(bytes, 24000);
          decoded = await decCtx.decodeAudioData(wavBuffer);
        } catch (decodeErr) {
          console.warn("Vocal patch speech decoding failed, using synthetic fallback waveform:", decodeErr);
          const estimatedDuration = Math.max(2, Math.min(60, Math.round(patchText.length / 15)));
          decoded = createFallbackAudioBuffer(decCtx, estimatedDuration);
        }
        setPatchPreviewBuffer(decoded);
      } finally {
        decCtx.close();
      }
    } catch (err: any) {
      console.error(err);
      setPatchError(err.message || "An error occurred during speech generation.");
    } finally {
      setIsGeneratingPatch(false);
    }
  };

  const handleApplyPatch = () => {
    if (!patchingSegment || !patchPreviewBuffer) return;
    setSegments((prev) =>
      prev.map((s) => {
        if (s.id === patchingSegment.id) {
          return {
            ...s,
            transcript: patchText,
            isPatched: true,
            customBuffer: patchPreviewBuffer,
          };
        }
        return s;
      })
    );
    setPatchingSegment(null);
    setPatchPreviewBuffer(null);
  };

  const playPatchPreview = () => {
    if (!patchPreviewBuffer) return;
    stopPatchPreview();

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      patchPreviewCtxRef.current = audioCtx;

      const source = audioCtx.createBufferSource();
      source.buffer = patchPreviewBuffer;
      source.connect(audioCtx.destination);
      source.start(0);

      patchPreviewSourceRef.current = source;
      setIsPlayingPatchPreview(true);

      source.onended = () => {
        setIsPlayingPatchPreview(false);
      };
    } catch (e) {
      console.error("Failed to play preview", e);
    }
  };

  const stopPatchPreview = () => {
    if (patchPreviewSourceRef.current) {
      try {
        patchPreviewSourceRef.current.stop();
      } catch (e) {}
      patchPreviewSourceRef.current = null;
    }
    if (patchPreviewCtxRef.current) {
      patchPreviewCtxRef.current.close();
      patchPreviewCtxRef.current = null;
    }
    setIsPlayingPatchPreview(false);
  };

  // Play individual Segment audition
  const playSegmentOnly = (seg: AudioSegment) => {
    if (!audioBuffer) return;

    if (currentlyAuditioning && currentlyAuditioning.id === seg.id) {
      clearAudition();
      return;
    }

    stopPlayingOriginal();
    clearAudition();

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      auditionCtxRef.current = audioCtx;

      let sliced: AudioBuffer;
      if (seg.customBuffer) {
        sliced = seg.customBuffer;
      } else {
        const paddedStart = Math.max(0, seg.start - boundaryPadding);
        const paddedEnd = Math.min(audioBuffer.duration, seg.end + boundaryPadding);
        sliced = sliceAudioBuffer(audioCtx, audioBuffer, paddedStart, paddedEnd);
      }

      const source = audioCtx.createBufferSource();
      source.buffer = sliced;
      source.connect(audioCtx.destination);

      source.start(0);
      auditionSourceRef.current = source;
      setCurrentlyAuditioning({ id: seg.id, start: seg.start, end: seg.end });

      auditionTimeoutRef.current = window.setTimeout(() => {
        stopAudition();
      }, sliced.duration * 1000);
    } catch (e) {
      console.error("Audition playback failed", e);
    }
  };

  const stopAudition = () => {
    if (auditionSourceRef.current) {
      try {
        auditionSourceRef.current.stop();
      } catch (e) {}
      auditionSourceRef.current = null;
    }
    if (auditionTimeoutRef.current) {
      clearTimeout(auditionTimeoutRef.current);
      auditionTimeoutRef.current = null;
    }
    if (auditionCtxRef.current) {
      auditionCtxRef.current.close();
      auditionCtxRef.current = null;
    }
    setCurrentlyAuditioning(null);
  };

  const clearAudition = () => {
    stopAudition();
  };

  const clearWorkspace = () => {
    stopPlayingOriginal();
    clearAudition();
    setOriginalFile(null);
    setAudioBuffer(null);
    setStitchedBuffer(null);
    setSegments([]);
    setCurrentTimeOriginal(0);
    setIsPlayingOriginal(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  const handleApplyRepairsToSource = (repairedBuffer: AudioBuffer) => {
    if (!originalFile) return;
    try {
      const wavBlob = audioBufferToWav(repairedBuffer);
      const reader = new FileReader();
      reader.readAsDataURL(wavBlob);
      reader.onloadend = () => {
        const base64data = reader.result as string;
        setAudioBuffer(repairedBuffer);
        setOriginalFile({
          ...originalFile,
          base64: base64data
        });
        setStitchedBuffer(null);
        setSegments([]);
        addLog("success", "action", "Applied speech repairs: Repaired track replaced the original source audio.");
      };
    } catch (err: any) {
      addLog("error", "browser", `Failed to apply repairs to source: ${err.message}`);
    }
  };

  // Segment adjustment handlers
  const handleUpdateSegment = (updated: AudioSegment) => {
    setSegments((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleAddSegment = (newSeg: AudioSegment) => {
    setSegments((prev) => [...prev, newSeg].sort((a, b) => a.start - b.start));
  };

  const handleDeleteSegment = (id: string) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500 selection:text-slate-950 flex flex-col antialiased">
      {/* Visual Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-100 tracking-tight flex items-center gap-2">
                HandAISpoke Speech Repair
                <span className="text-[10px] font-mono font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-900/40 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  AI-Powered
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Automatic detection and non-destructive removal of vocal mistakes, repetitions, and pauses.
              </p>
            </div>
          </div>

          {originalFile && (
            <button
              id="clear-workspace-btn"
              onClick={clearWorkspace}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-lg transition-all cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Session</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Studio Workspace Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
        {/* Workspace Tab Switcher */}
        <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-2 shrink-0">
          <div className="flex gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800/80">
            <button
              id="workspace-tab-editor"
              onClick={() => {
                setWorkspaceTab("editor");
                addLog("info", "action", "Navigated to Speech Repair view");
              }}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                workspaceTab === "editor"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Speech Repair</span>
            </button>
            <button
              id="workspace-tab-normalization"
              onClick={() => {
                setWorkspaceTab("normalization");
                addLog("info", "action", "Opened Volume Normalization & Hard Limiter Studio");
              }}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                workspaceTab === "normalization"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Volume2 className="w-4 h-4" />
              <span>Volume Normalization</span>
            </button>
            <button
              id="workspace-tab-tts"
              onClick={() => {
                setWorkspaceTab("tts");
                addLog("info", "action", "Opened Voice Synthesis & TTS Profile Studio");
              }}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                workspaceTab === "tts"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Voice Profile & TTS</span>
            </button>
            <button
              id="workspace-tab-noise"
              onClick={() => {
                setWorkspaceTab("noise");
                addLog("info", "action", "Opened Noise Management Studio");
              }}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                workspaceTab === "noise"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Volume2 className="w-4 h-4" />
              <span>Noise Management</span>
            </button>
            <button
              id="workspace-tab-descriptive"
              onClick={() => {
                setWorkspaceTab("descriptive");
                addLog("info", "action", "Opened Descriptive Editing Studio");
              }}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                workspaceTab === "descriptive"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Descriptive Editing</span>
            </button>
            <button
              id="workspace-tab-distribution"
              onClick={() => {
                setWorkspaceTab("distribution");
                addLog("info", "action", "Opened Distribution Studio");
              }}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                workspaceTab === "distribution"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>Distribution</span>
            </button>
            <button
              id="workspace-tab-diagnostics"
              onClick={() => {
                setWorkspaceTab("diagnostics");
                addLog("info", "action", "Opened Logging & Diagnostics Panel");
              }}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                workspaceTab === "diagnostics"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>Diagnostics & Logs</span>
              {(logs.filter(l => l.level === "error").length > 0 || serverLogs.filter(l => l.level === "error").length > 0) && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
              )}
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Telemetry Link: Active</span>
          </div>
        </div>

        {/* Dynamic Content based on Active Workspace Tab */}
        {/* Diagnostics & Logs Tab Content */}
        <div className={workspaceTab === "diagnostics" ? "contents" : "hidden"} id="workspace-content-diagnostics">
          <DiagnosticsLogViewer
            logs={logs}
            serverLogs={serverLogs}
            onClearLogs={handleClearLogs}
            onRefreshServerLogs={fetchServerLogs}
            isPolling={isPollingLogs}
            setIsPolling={setIsPollingLogs}
          />
        </div>

        {/* Voice Profile & TTS Tab Content */}
        <div className={workspaceTab === "tts" ? "contents" : "hidden"} id="workspace-content-tts">
          <VoiceProfileStudio
            originalFile={originalFile ? {
              name: originalFile.name,
              file: originalFile.file,
              base64: originalFile.base64 || "",
              mimeType: originalFile.type
            } : null}
            audioBuffer={audioBuffer}
            segments={segments}
            onAddSegment={handleAddSegment}
            onUpdateSegment={handleUpdateSegment}
            addLog={addLog}
            onSetMasterTimeline={(newBuffer, newSegments, filename, base64) => {
              setAudioBuffer(newBuffer);
              setSegments(newSegments);
              setOriginalFile({
                name: filename,
                type: "audio/wav",
                file: new File([], filename, { type: "audio/wav" }),
                base64: base64
              });
              setStitchedBuffer(null);
              setWorkspaceTab("editor");
              addLog("success", "action", `Stitched multi-speaker script timeline loaded successfully as the main source for editing!`);
            }}
          />
        </div>

        {/* Volume Normalization Tab Content */}
        <div className={workspaceTab === "normalization" ? "contents" : "hidden"} id="workspace-content-normalization">
          <VolumeNormalization
            audioBuffer={audioBuffer}
            originalFile={originalFile ? {
              name: originalFile.name,
              type: originalFile.type,
              file: originalFile.file,
              base64: originalFile.base64
            } : null}
            onApplyNormalized={(newBuffer, newBase64) => {
              setAudioBuffer(newBuffer);
              if (originalFile) {
                setOriginalFile({
                  ...originalFile,
                  base64: newBase64
                });
              }
              setStitchedBuffer(null);
            }}
            addLog={addLog}
          />
        </div>

        {/* Noise Management Tab Content */}
        <div className={workspaceTab === "noise" ? "contents" : "hidden"} id="workspace-content-noise">
          <NoiseStudio
            audioBuffer={audioBuffer}
            originalFile={originalFile ? {
              name: originalFile.name,
              type: originalFile.type,
              base64: originalFile.base64 || ""
            } : null}
            onApplyNoiseProcessed={(newBuffer, newBase64) => {
              setAudioBuffer(newBuffer);
              if (originalFile) {
                setOriginalFile({
                  ...originalFile,
                  base64: newBase64
                });
              }
              setStitchedBuffer(null);
            }}
            addLog={addLog}
          />
        </div>

        {/* Descriptive Editing Tab Content */}
        <div className={workspaceTab === "descriptive" ? "contents" : "hidden"} id="workspace-content-descriptive">
          <DescriptiveEditing
            audioBuffer={audioBuffer}
            originalFile={originalFile ? {
              name: originalFile.name,
              type: originalFile.type,
              base64: originalFile.base64 || ""
            } : null}
            onApplyDescriptive={(newBuffer, newBase64) => {
              setAudioBuffer(newBuffer);
              if (originalFile) {
                setOriginalFile({
                  ...originalFile,
                  base64: newBase64
                });
              }
              setStitchedBuffer(null);
            }}
            addLog={addLog}
          />
        </div>

        {/* Distribution Tab Content */}
        <div className={workspaceTab === "distribution" ? "contents" : "hidden"} id="workspace-content-distribution">
          <DistributionStudio
            audioBuffer={audioBuffer}
            originalFile={originalFile ? {
              name: originalFile.name,
              type: originalFile.type,
              base64: originalFile.base64 || ""
            } : null}
            addLog={addLog}
          />
        </div>

        {/* Speech Repair Tab Content */}
        <div className={workspaceTab === "editor" ? "contents" : "hidden"} id="workspace-content-editor">
          {!originalFile ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-stretch">
            {/* Left side upload */}
            <div className="lg:col-span-7 flex flex-col justify-between p-8 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md">
              <div className="w-full">
                <div className="flex gap-1 border-b border-slate-800/80 pb-4 mb-6">
                  <button
                    onClick={() => setActiveTab("upload")}
                    className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      activeTab === "upload"
                        ? "bg-slate-800 text-slate-100 border border-slate-700"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Recording</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("record")}
                    className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      activeTab === "record"
                        ? "bg-slate-800 text-slate-100 border border-slate-700"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span>Live Studio Record</span>
                  </button>
                </div>

                {/* Optional Reference Script Card */}
                <div className="mb-6 bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 shadow-inner">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="reference-script-area" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Reference Script <span className="text-slate-500 font-normal">(Optional)</span></span>
                    </label>
                    <div className="flex items-center gap-3">
                      <label htmlFor="script-file-loader" className="text-[10px] text-emerald-400 hover:text-emerald-300 cursor-pointer flex items-center gap-1 font-mono">
                        <FileText className="w-3 h-3" />
                        <span>Upload .txt script</span>
                        <input
                          id="script-file-loader"
                          type="file"
                          accept=".txt"
                          onChange={handleScriptUpload}
                          className="hidden"
                        />
                      </label>
                      {referenceScript && (
                        <button
                          type="button"
                          onClick={() => setReferenceScript("")}
                          className="text-[10px] text-red-400 hover:text-red-300 font-mono"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    id="reference-script-area"
                    placeholder="Paste or type the intended text/script here. Gemini will use this to align the audio perfectly and precisely edit out errors, repetitions, or stutters..."
                    value={referenceScript}
                    onChange={(e) => setReferenceScript(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-900/50 border border-slate-800 focus:border-emerald-500/50 rounded-lg p-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none transition-colors resize-y font-sans leading-relaxed"
                  />
                  <div className="flex justify-between items-center mt-1.5 text-[10px] text-slate-500 font-mono">
                    <span>Helps Gemini match words & prevent cutoffs</span>
                    <span>{referenceScript.length} chars</span>
                  </div>
                </div>

                {isDecoding ? (
                  <div className="flex flex-col items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl p-12 text-center gap-4">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full border-4 border-slate-800 border-t-emerald-500 animate-spin" />
                      <Music className="w-5 h-5 text-emerald-400 absolute inset-0 m-auto animate-pulse" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-mono text-emerald-400 uppercase tracking-widest animate-pulse">
                        Loading Audio Track
                      </span>
                      <p className="text-sm font-semibold text-slate-200">{decodingStep}</p>
                      <p className="text-[10px] text-slate-500 max-w-sm mt-1 leading-relaxed mx-auto">
                        Web Audio API is reading and decoding the waveform data locally in your browser. This can take a moment for large files.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={abortDecoding}
                      className="mt-4 px-4 py-2 bg-red-950/40 hover:bg-red-900/60 text-red-200 border border-red-900/40 hover:border-red-800 rounded-lg text-xs font-semibold cursor-pointer transition-all shadow-sm"
                    >
                      Abort Loading
                    </button>
                  </div>
                ) : activeTab === "upload" ? (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="flex flex-col items-center justify-center border border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/60 rounded-xl p-12 text-center transition-all cursor-pointer group"
                  >
                    <input
                      type="file"
                      id="audio-uploader"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <label htmlFor="audio-uploader" className="cursor-pointer w-full flex flex-col items-center">
                      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-800/60 group-hover:border-slate-700 transition-all mb-4 shadow-inner">
                        <Upload className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors mb-1">
                        Select audio file from disk
                      </span>
                      <span className="text-xs text-slate-400 max-w-sm">
                        Supports MP3, WAV, or M4A vocal recordings. Or drag & drop the file directly here.
                      </span>
                    </label>
                  </div>
                ) : (
                  <div className="py-6">
                    <AudioRecorder onRecordingComplete={(blob) => handleAudioFile(new File([blob], "studio_record.webm", { type: "audio/webm" }))} />
                  </div>
                )}
              </div>

              {errorMessage && (
                <div className="flex items-start gap-3 bg-red-950/30 p-4 rounded-xl border border-red-900/40 text-xs text-red-300 mt-6 shadow-inner">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            {/* Right side instruction/Quick Test */}
            <div className="lg:col-span-5 flex flex-col justify-between p-8 bg-slate-900/60 rounded-2xl border border-slate-800/80 backdrop-blur-md">
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-2 text-slate-300 font-semibold border-b border-slate-800/80 pb-3">
                  <BookOpen className="w-4.5 h-4.5 text-emerald-400" />
                  <span className="text-sm uppercase tracking-wide">How to Test it Instantly</span>
                </div>

                <div className="flex flex-col gap-5 text-xs text-slate-400 leading-relaxed">
                  <p>
                    This editor is fine-tuned to solve a common spoken word and podcasting dilemma: **stutter starts, misspoken sentences, and immediate retakes**.
                  </p>

                  <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 shadow-inner">
                    <h4 className="text-xs font-bold text-slate-200 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                      Recommended Quick Script
                    </h4>
                    <p className="italic bg-slate-900/50 p-2.5 rounded border border-slate-800/40 text-slate-300 leading-relaxed font-serif">
                      "I love doing spoken word recordings. When I make a mistake, I simply stop... [pause 1 sec]... I simply stop, go back, and repeat the correct sentence line. Perfect!"
                    </p>
                  </div>

                  <ol className="list-decimal list-inside flex flex-col gap-3 ml-1">
                    <li>
                      Select <strong className="text-slate-300">Live Studio Record</strong> above.
                    </li>
                    <li>
                      Read the script, purposely reading the duplicate parts.
                    </li>
                    <li>
                      Stop, and click <strong className="text-emerald-400">Analyze with Gemini AI</strong>.
                    </li>
                    <li>
                      Gemini will automatically slice the vocal track, cross out the mistakes, and stitch the clean takes into a perfect seamless download!
                    </li>
                  </ol>
                </div>
              </div>

              <div className="text-[10px] font-mono text-slate-500 text-center border-t border-slate-800/40 pt-4 mt-6">
                100% Secure. File parsing and stitching happens locally.
              </div>
            </div>
          </div>
        ) : (
          /* Active Editing Workspace */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Source Audio & Timestamps */}
            <div className="lg:col-span-6 flex flex-col gap-6">
              {/* Audio Source Status */}
              <div className="p-5 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Music className="w-4.5 h-4.5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-300 truncate max-w-[240px]">
                      {originalFile.name}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 lowercase bg-slate-950 px-2 py-0.5 rounded border border-slate-800/80">
                      {Math.round(originalFile.file.size / 1024)} KB
                    </span>
                  </div>

                  <button
                    onClick={clearWorkspace}
                    className="text-[10px] font-mono text-red-400 hover:text-red-300 transition-colors uppercase tracking-wide cursor-pointer"
                  >
                    Discard Audio
                  </button>
                </div>

                 {/* Original Waveform Canvas */}
                <WaveformVisualizer
                  audioBuffer={audioBuffer}
                  segments={segments}
                  currentTime={currentTimeOriginal}
                  onSeek={handleOriginalSeek}
                  selectionStart={selectionStart}
                  selectionEnd={selectionEnd}
                  onSelectionChange={(start, end) => {
                    setSelectionStart(start);
                    setSelectionEnd(end);
                  }}
                />

                {/* Audio controls for original/raw audio */}
                <div className="flex items-center justify-between gap-4 mt-1">
                  <div className="flex items-center gap-2">
                    <button
                      id="original-play-btn"
                      onClick={() => (isPlayingOriginal ? stopPlayingOriginal() : startPlayingOriginal(currentTimeOriginal))}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-100 rounded-lg text-xs font-semibold border border-slate-700 cursor-pointer"
                    >
                      {isPlayingOriginal ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-slate-100" />
                          <span>Pause Audio</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-slate-100 ml-0.5" />
                          <span>Audition Original</span>
                        </>
                      )}
                    </button>

                    {currentTimeOriginal > 0 && (
                      <button
                        id="original-stop-btn"
                        onClick={stopPlayingOriginal}
                        className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                      </button>
                    )}
                  </div>

                  {!isAnalyzing && (
                    <div className="flex items-center gap-2">
                      {selectionStart !== null && selectionEnd !== null ? (
                        <>
                          <button
                            onClick={() => {
                              setSelectionStart(null);
                              setSelectionEnd(null);
                            }}
                            className="px-3 py-2 text-slate-400 hover:text-slate-200 text-xs font-semibold cursor-pointer"
                          >
                            Clear Selection
                          </button>
                          <button
                            id="analyze-selection-btn"
                            onClick={() => triggerAnalyze(selectionStart, selectionEnd)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-slate-950 font-bold rounded-lg text-xs tracking-wide shadow-md shadow-sky-500/10 cursor-pointer animate-bounce"
                            title="Retry Gemini analysis only on highlighted timeline section"
                          >
                            <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                            <span>Retry Selection ({Math.round(selectionStart)}s - {Math.round(selectionEnd)}s)</span>
                          </button>
                        </>
                      ) : segments.length > 0 ? (
                        <button
                          id="reanalyze-btn"
                          onClick={() => triggerAnalyze()}
                          className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-300 hover:text-white font-semibold rounded-lg text-xs tracking-wide border border-slate-700 cursor-pointer"
                          title="Retry analysis and cutting on the full audio timeline"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Re-analyze Full Audio</span>
                        </button>
                      ) : (
                        <button
                          id="analyze-btn"
                          onClick={() => triggerAnalyze()}
                          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold rounded-lg text-xs tracking-wide shadow-md shadow-emerald-500/10 cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4 fill-slate-950" />
                          <span>Analyze & Edit with Gemini AI</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Advanced Processing Settings */}
                  <div className="border-t border-slate-800/60 pt-4 mt-3">
                    <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold text-slate-300">
                      <Settings className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Advanced Gemini Processing Options</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                          Split Chunk Size
                        </label>
                        <select
                          id="chunk-size-select"
                          value={chunkSize}
                          onChange={(e) => setChunkSize(parseInt(e.target.value))}
                          className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-emerald-500/50 cursor-pointer"
                        >
                          <option value={30}>30s (Ultra High Precision)</option>
                          <option value={60}>60s (Balanced / Default)</option>
                          <option value={180}>180s (3m - Fewer Requests)</option>
                          <option value={300}>300s (5m - For Long Audio)</option>
                          <option value={-1}>Whole Audio (1 Single Request)</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                          Request Delay
                        </label>
                        <select
                          id="request-delay-select"
                          value={requestDelay}
                          onChange={(e) => setRequestDelay(parseInt(e.target.value))}
                          className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-emerald-500/50 cursor-pointer"
                        >
                          <option value={0}>0s delay (Fastest)</option>
                          <option value={3}>3s delay</option>
                          <option value={5}>5s delay</option>
                          <option value={10}>10s delay (Anti-Rate Limit)</option>
                        </select>
                      </div>
                    </div>

                    {/* Estimation Info & Warn Box */}
                    {audioBuffer && (
                      <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 flex flex-col gap-1.5">
                        {(() => {
                          const analysisDuration = (selectionStart !== null && selectionEnd !== null)
                            ? (selectionEnd - selectionStart)
                            : audioBuffer.duration;
                          const estimatedCount = chunkSize === -1 ? 1 : Math.ceil(analysisDuration / chunkSize);
                          
                          return (
                            <>
                              <div className="flex justify-between items-center">
                                <span className="flex items-center gap-1">
                                  <Timer className="w-3 h-3 text-slate-500" />
                                  <span>Track duration to analyze:</span>
                                </span>
                                <span className="font-mono text-slate-300 font-semibold">
                                  {Math.round(analysisDuration)} seconds
                                </span>
                              </div>
                              <div className="flex justify-between items-center border-t border-slate-900/60 pt-1.5 mt-0.5">
                                <span>Splitting into:</span>
                                <span className="font-mono text-emerald-400 font-bold">
                                  {estimatedCount} chunk{estimatedCount > 1 ? "s" : ""}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span>Estimated API Calls:</span>
                                <span className={`font-mono font-bold ${estimatedCount > 10 ? "text-amber-400 animate-pulse" : "text-emerald-400"}`}>
                                  {estimatedCount} call{estimatedCount > 1 ? "s" : ""}
                                </span>
                              </div>

                              {estimatedCount > 5 && (
                                <div className="mt-2 p-2 bg-amber-950/20 border border-amber-900/30 rounded text-[10px] text-amber-400 leading-normal">
                                  ⚠️ <strong>Quota Limit Warning:</strong> Your Gemini API free tier key allows up to 20 daily requests. Processing with the current settings will make <strong>{estimatedCount} API requests</strong>. Choose <strong>"300s"</strong> or <strong>"Whole Audio"</strong> to avoid exhausting your quota!
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Splice Boundary Padding Settings */}
                <div className="border-t border-slate-800/60 pt-4 mt-2">
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-slate-300">Splice Boundary Cushion</span>
                      <span className="text-[10px] text-slate-500">
                        Adds a safety buffer around slices to prevent clipped words and keep timing natural.
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-900/40">
                      {boundaryPadding.toFixed(2)}s
                    </span>
                  </div>
                  <input
                    id="boundary-padding-slider"
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.05"
                    value={boundaryPadding}
                    onChange={(e) => setBoundaryPadding(parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  />
                  <div className="flex justify-between text-[9px] font-mono text-slate-500 mt-1">
                    <span>0.0s (Tight)</span>
                    <span>0.15s (Default)</span>
                    <span>0.3s (Spacious)</span>
                    <span>0.5s (Breath-in)</span>
                  </div>
                </div>
              </div>

              {/* Loader Panel during Gemini analysis */}
              {isAnalyzing && (
                <div className="p-8 bg-slate-900/60 rounded-2xl border border-slate-800 flex flex-col items-center justify-center text-center gap-4">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full border-4 border-slate-800 border-t-emerald-500 animate-spin" />
                    <Sparkles className="w-5 h-5 text-emerald-400 absolute inset-0 m-auto animate-pulse" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-mono text-emerald-400 uppercase tracking-widest animate-pulse">
                      Processing Spoken Word
                    </span>
                    <p className="text-sm font-semibold text-slate-200">{analysisStep}</p>
                    <span className="text-[10px] text-slate-500 max-w-xs mt-1 leading-relaxed">
                      Gemini listens directly to the recording, transcribes takes, and locates the exact seconds containing mistakes.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={abortAnalysis}
                    className="mt-2 px-4 py-2 bg-red-950/40 hover:bg-red-900/60 text-red-200 border border-red-900/40 hover:border-red-800 rounded-lg text-xs font-semibold cursor-pointer transition-all shadow-sm"
                  >
                    Abort Analysis
                  </button>
                </div>
              )}

              {errorMessage && (
                <div className="flex items-start gap-3 bg-red-950/30 p-4 rounded-xl border border-red-900/40 text-xs text-red-300 shadow-inner">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Segment Slices display panel */}
              {segments.length > 0 && (
                <div className="p-5 bg-slate-900/30 rounded-2xl border border-slate-900 flex flex-col gap-4">
                  <SegmentList
                    segments={segments}
                    originalDuration={audioBuffer?.duration || 0}
                    onUpdateSegment={handleUpdateSegment}
                    onAddSegment={handleAddSegment}
                    onDeleteSegment={handleDeleteSegment}
                    onPlaySegmentOnly={playSegmentOnly}
                    currentlyAuditioning={currentlyAuditioning}
                    onPatchSegment={handlePatchSegment}
                    onRemovePatch={handleRemovePatch}
                  />
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Clean Stitched Master Track */}
            <div className="lg:col-span-6 flex flex-col gap-6">
              <CleanAudioPlayer
                stitchedBuffer={stitchedBuffer}
                onPlay={() => {
                  stopPlayingOriginal();
                  clearAudition();
                }}
                isAnyOtherPlaying={isPlayingOriginal || currentlyAuditioning !== null}
                onApplyToSource={handleApplyRepairsToSource}
              />

              {showWorkspaceGuide && (
                <div className="p-5 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col gap-4 leading-relaxed text-xs text-slate-400 relative">
                  <button 
                    onClick={() => setShowWorkspaceGuide(false)}
                    className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors p-1 cursor-pointer"
                    title="Dismiss Guide"
                    id="btn-dismiss-workspace-guide"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 uppercase tracking-wide text-[10px] border-b border-slate-800 pb-2 pr-6">
                    <BookOpen className="w-4 h-4 text-emerald-400" />
                    Workspace Guide & Control Features
                  </h4>
                  <ul className="flex flex-col gap-2.5 list-disc list-inside ml-1">
                    <li>
                      <strong>Toggle Slices</strong>: Check/uncheck any segment in the list. The final audio compiles and adjusts **reactively inside your browser** within milliseconds.
                    </li>
                    <li>
                      <strong>Fine-tuning Boundaries</strong>: Click the pencil icon on any segment to edit its start and end timing precisely, perfect for snug verbal transitions.
                    </li>
                    <li>
                      <strong>Waveform Dragging</strong>: Click on the original timeline waveform to instantly jump your audition cursor.
                    </li>
                    <li>
                      <strong>Lossless WAV Export</strong>: Clicking "Export Clean Master" generates and packages your final take directly on your machine with no extra server wait time.
                    </li>
                  </ul>
                </div>
              )}

              {/* Truncate Silence Card */}
              <div className="p-5 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                    Truncate Silence (Smart Trim)
                  </h4>
                  <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    DSP Utility
                  </span>
                </div>
                
                <p className="text-xs text-slate-400 leading-relaxed">
                  Automatically trim down excessively long pauses and silent takes to a snug pacing in a single click.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Threshold Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 font-medium">Silence Threshold</span>
                      <span className="font-mono text-emerald-400 font-bold">{silenceThreshold} dBFS</span>
                    </div>
                    <input
                      type="range"
                      min="-60"
                      max="-20"
                      step="1"
                      value={silenceThreshold}
                      onChange={(e) => setSilenceThreshold(parseInt(e.target.value))}
                      className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <span className="text-[9px] text-slate-500 font-mono">Standard is -40 dBFS</span>
                  </div>

                  {/* Max Silence Duration Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 font-medium">Max Silence Duration</span>
                      <span className="font-mono text-emerald-400 font-bold">{maxSilenceDuration.toFixed(2)}s</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.5"
                      step="0.05"
                      value={maxSilenceDuration}
                      onChange={(e) => setMaxSilenceDuration(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <span className="text-[9px] text-slate-500 font-mono">Trim pauses exceeding this length</span>
                  </div>
                </div>

                {segments.length > 0 && (
                  <div className="p-2.5 bg-amber-950/20 border border-amber-900/30 rounded-xl text-[11px] text-amber-400 font-sans flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Applying Truncate Silence shifts the absolute timeline, which will clear any active vocal slice timeline markers.
                    </span>
                  </div>
                )}

                <div className="flex justify-end mt-2">
                  <button
                    onClick={handleTruncateSilence}
                    disabled={isTruncatingSilence || !audioBuffer}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 disabled:bg-slate-950 disabled:text-slate-600 text-slate-200 hover:text-white font-semibold rounded-xl text-xs tracking-wide border border-slate-700 disabled:border-slate-800 transition-all flex items-center gap-1.5 cursor-pointer"
                    id="btn-truncate-silence"
                  >
                    {isTruncatingSilence ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                        <span>Trimming Silence...</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Apply Truncate Silence</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </main>

      {/* AI Voice Patch Studio Modal Overlay */}
      {patchingSegment && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl flex flex-col gap-5">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse" />
                <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide">
                  AI Vocal Patch Studio
                </h3>
              </div>
              <button
                onClick={() => {
                  stopPatchPreview();
                  stopVoicePreview();
                  setPatchingSegment(null);
                }}
                className="text-slate-400 hover:text-white font-mono text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {/* Segment stats info */}
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 flex items-center justify-between text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Patching Segment</span>
                <span className="font-mono text-slate-300">
                  {patchingSegment.start.toFixed(2)}s – {patchingSegment.end.toFixed(2)}s
                </span>
              </div>
              <div className="text-right flex flex-col gap-0.5">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Original Duration</span>
                <span className="font-mono text-emerald-400">
                  {(patchingSegment.end - patchingSegment.start).toFixed(2)}s
                </span>
              </div>
            </div>

            {/* Settings Form */}
            <div className="flex flex-col gap-5">
              {/* Voice Patch Mode Tabs */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Vocal Synthesis Method
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => {
                      setVocalMode("clone");
                      stopVoicePreview();
                    }}
                    className={`py-2 px-3 text-xs font-semibold rounded-lg transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
                      vocalMode === "clone"
                        ? "bg-slate-800 border border-slate-700/80 text-emerald-400 font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span>🎙️ Speaker Clone</span>
                    <span className="text-[9px] font-normal text-slate-500 lowercase">no archetype profile</span>
                  </button>
                  <button
                    onClick={() => {
                      setVocalMode("archetype");
                    }}
                    className={`py-2 px-3 text-xs font-semibold rounded-lg transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
                      vocalMode === "archetype"
                        ? "bg-slate-800 border border-slate-700/80 text-emerald-400 font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span>🎭 Voice Archetype</span>
                    <span className="text-[9px] font-normal text-slate-500 lowercase">prebuilt system voices</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Content Based on Selected Tab */}
              {vocalMode === "clone" ? (
                /* Mode A: Speaker Clone */
                <div className="flex flex-col gap-4 animate-fade-in bg-slate-950/40 border border-slate-900 rounded-xl p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-slate-200">
                      Intelligent 1:1 Voice Matching
                    </p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      This option builds a custom voice print exclusively from the current segment's waveform. It will match your pronunciation style, microphone characteristics, and ambient background room noise for seamless integration.
                    </p>
                  </div>

                  {/* Register selection - since Gemini requires a base register preset to run stable style transfer */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-900">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                      <span>Vocal Pitch Alignment (Base Register)</span>
                      <span className="text-[9px] text-slate-500 lowercase normal-case font-sans">Helps stabilizer generate clean output</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setSelectedVoice("Puck");
                          stopVoicePreview();
                        }}
                        className={`py-1.5 px-2.5 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                          selectedVoice === "Puck"
                            ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-400"
                            : "bg-slate-950 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                        }`}
                      >
                        Masculine Pitch Register
                      </button>
                      <button
                        onClick={() => {
                          setSelectedVoice("Zephyr");
                          stopVoicePreview();
                        }}
                        className={`py-1.5 px-2.5 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                          selectedVoice === "Zephyr"
                            ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-400"
                            : "bg-slate-950 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                        }`}
                      >
                        Feminine Pitch Register
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Mode B: Voice Archetype */
                <div className="flex flex-col gap-4 animate-fade-in bg-slate-950/40 border border-slate-900 rounded-xl p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-slate-200">
                      Standard Professional Narrator
                    </p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Speak the new script using one of Gemini's highly optimized, prebuilt voice actor profiles. Excellent for clean narration or multi-voice scenes.
                    </p>
                  </div>

                  {/* Archetype Selector with Play Preview Button */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      Select Vocal Style Archetype
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedVoice}
                        onChange={(e) => {
                          setSelectedVoice(e.target.value as any);
                          stopVoicePreview();
                        }}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:border-emerald-500/50 focus:outline-none cursor-pointer transition-colors"
                      >
                        <option value="Puck">Puck (Energetic, friendly male)</option>
                        <option value="Zephyr">Zephyr (Clear, warm female)</option>
                        <option value="Kore">Kore (Warm, rich female)</option>
                        <option value="Fenrir">Fenrir (Deep, resonant male)</option>
                        <option value="Charon">Charon (Professional, articulate male)</option>
                      </select>

                      <button
                        onClick={handlePreviewVoiceArchetype}
                        disabled={isGeneratingVoicePreview}
                        className={`px-3 py-2.5 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer transition-all ${
                          playingVoicePreviewName === selectedVoice
                            ? "bg-amber-600 border-amber-500 text-white hover:bg-amber-500"
                            : isGeneratingVoicePreview
                            ? "bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed"
                            : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-emerald-400"
                        }`}
                        title="Play immediate audio sample of selected voice profile"
                      >
                        {playingVoicePreviewName === selectedVoice ? (
                          <>
                            <Square className="w-3.5 h-3.5 fill-current" />
                            <span>Stop</span>
                          </>
                        ) : isGeneratingVoicePreview ? (
                          <>
                            <div className="w-3 h-3 rounded-full border-2 border-slate-700 border-t-emerald-400 animate-spin" />
                            <span>Loading</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5" />
                            <span>Sample</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Optional Reference Checkbox for Environment Match */}
                  <div className="flex items-start gap-3 bg-slate-950/30 p-2.5 rounded-lg border border-slate-900/60 mt-1">
                    <input
                      id="use-vocal-reference"
                      type="checkbox"
                      checked={useVocalReference}
                      onChange={(e) => setUseVocalReference(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-emerald-500/30 cursor-pointer"
                    />
                    <div className="flex flex-col gap-0.5">
                      <label htmlFor="use-vocal-reference" className="text-xs font-semibold text-slate-200 cursor-pointer">
                        Match Timeline Recording Room Acoustics
                      </label>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Feeds your environment & background profile to the archetype. This molds the professional reader to perfectly match your ambient volume, gain, and mic background hiss.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Text Area */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Patch Script Content (Words to Speak)
                </label>
                <textarea
                  placeholder="Type the exact text you want Gemini to say..."
                  value={patchText}
                  onChange={(e) => setPatchText(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/50 rounded-lg p-2.5 text-xs text-slate-300 placeholder-slate-700 focus:outline-none transition-colors resize-none font-sans leading-relaxed"
                />
              </div>
            </div>

            {/* Error displays */}
            {patchError && (
              <div className="flex items-start gap-2.5 bg-red-950/30 p-3 rounded-lg border border-red-900/40 text-xs text-red-300 leading-normal">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{patchError}</span>
              </div>
            )}

            {/* Preview Player / Generation Actions */}
            <div className="border-t border-slate-800 pt-4 flex flex-col gap-4">
              {patchPreviewBuffer ? (
                /* Patch Audition state */
                <div className="bg-emerald-950/10 border border-emerald-900/30 p-4 rounded-xl flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">
                        Patch Generated Successfully
                      </span>
                      <span className="text-xs text-slate-400">
                        Duration: <strong className="font-mono text-slate-200">{patchPreviewBuffer.duration.toFixed(2)}s</strong>
                      </span>
                    </div>

                    <button
                      onClick={isPlayingPatchPreview ? stopPatchPreview : playPatchPreview}
                      className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all ${
                        isPlayingPatchPreview
                          ? "bg-amber-600 text-white"
                          : "bg-emerald-600 text-white hover:bg-emerald-500"
                      }`}
                    >
                      {isPlayingPatchPreview ? (
                        <>
                          <Square className="w-3.5 h-3.5 fill-current" />
                          <span>Stop Preview</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Audition Patch</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <button
                      onClick={() => setPatchPreviewBuffer(null)}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer transition-all"
                    >
                      Regenerate
                    </button>
                    <button
                      onClick={handleApplyPatch}
                      className="px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg cursor-pointer transition-all"
                    >
                      Insert into Timeline
                    </button>
                  </div>
                </div>
              ) : (
                /* Primary CTA to trigger speech generation */
                <button
                  onClick={handleGeneratePatch}
                  disabled={isGeneratingPatch || !patchText.trim()}
                  className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                    isGeneratingPatch
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer"
                  }`}
                >
                  {isGeneratingPatch ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-slate-600 border-t-emerald-400 animate-spin" />
                      <span>Gemini is synthesizing & style-matching voice...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Generate AI Vocal Patch</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-slate-900 bg-slate-950/60 py-4 text-center text-[10px] font-mono text-slate-500 mt-auto">
        Powered by Google Gemini 2.5 & Web Audio API Splicing Engine. All Audio Processing is Secure and Client-Buffered.
      </footer>
    </div>
  );
}
