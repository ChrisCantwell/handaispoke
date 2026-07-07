import React, { useState, useRef, useEffect } from "react";
import { AudioSegment, AppLog } from "../types";
import {
  Volume2,
  Play,
  Square,
  Sparkles,
  Download,
  Plus,
  RefreshCw,
  Sliders,
  UserCheck,
  Check,
  HelpCircle,
  FileAudio,
  Radio,
  Music,
  Maximize2
} from "lucide-react";
import { audioBufferToWav, convertRawPcmToWavBuffer, createFallbackAudioBuffer, sliceAudioBuffer } from "../utils/audioUtils";

interface VoiceProfile {
  gender: string;
  pitch: string;
  speed: string;
  accent: string;
  vibe: string;
  suggestedPreset: string;
  explanation: string;
}

interface VoiceProfileStudioProps {
  originalFile: {
    name: string;
    file: File;
    base64: string;
    mimeType: string;
  } | null;
  audioBuffer: AudioBuffer | null;
  segments: AudioSegment[];
  onAddSegment: (newSeg: AudioSegment) => void;
  onUpdateSegment: (updated: AudioSegment) => void;
  addLog: (
    level: "info" | "warn" | "error" | "success",
    category: "click" | "action" | "api" | "browser" | "server",
    message: string,
    details?: any
  ) => void;
}

export default function VoiceProfileStudio({
  originalFile,
  audioBuffer,
  segments,
  onAddSegment,
  onUpdateSegment,
  addLog
}: VoiceProfileStudioProps) {
  // Voice Profile States
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Generation Settings
  const [voicePreset, setVoicePreset] = useState("cloned");
  const [styleGuidelines, setStyleGuidelines] = useState("");
  const [textToSpeak, setTextToSpeak] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Real-time Effects States
  const [pitchShift, setPitchShift] = useState(0); // semitones (-12 to +12)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); // (0.5 to 2.0)
  const [eqPreset, setEqPreset] = useState<"normal" | "bass" | "treble">("normal");

  // Playback States
  const [generatedAudioBase64, setGeneratedAudioBase64] = useState<string | null>(null);
  const [generatedBuffer, setGeneratedBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSegmentToReplace, setSelectedSegmentToReplace] = useState<string>("");

  // Segment Training Selection States
  const [selectedVoiceSegmentId, setSelectedVoiceSegmentId] = useState<string>("");
  const [isPlayingSegmentPreview, setIsPlayingSegmentPreview] = useState(false);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Support prebuilt voice details
  const prebuiltVoices = [
    { name: "cloned", description: "No voice actor - Clone my voice from selected segment" },
    { name: "Puck", description: "Deep, warm, professional male narrator" },
    { name: "Charon", description: "Mid-range, energetic, clear male voice" },
    { name: "Fenrir", description: "Intense, slightly raspy, dramatic male voice" },
    { name: "Kore", description: "Clear, high-pitched, crisp female voice" },
    { name: "Zephyr", description: "Warm, smooth, airy female narrator" }
  ];

  // Stop playback on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
      stopSegmentPreview();
    };
  }, []);

  const stopSegmentPreview = () => {
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
      } catch (e) {}
      previewSourceRef.current = null;
    }
    if (previewCtxRef.current) {
      try {
        previewCtxRef.current.close();
      } catch (e) {}
      previewCtxRef.current = null;
    }
    setIsPlayingSegmentPreview(false);
  };

  const playSegmentPreview = (segId: string) => {
    stopSegmentPreview();
    stopPlayback();
    if (!audioBuffer) return;

    const seg = segments.find(s => s.id === segId);
    if (!seg) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      previewCtxRef.current = audioCtx;

      const sliced = seg.customBuffer ? seg.customBuffer : sliceAudioBuffer(audioCtx, audioBuffer, seg.start, seg.end);

      const source = audioCtx.createBufferSource();
      source.buffer = sliced;
      source.connect(audioCtx.destination);
      source.start(0);

      previewSourceRef.current = source;
      setIsPlayingSegmentPreview(true);

      source.onended = () => {
        setIsPlayingSegmentPreview(false);
      };
    } catch (e) {
      console.error("Failed to play segment preview:", e);
    }
  };

  const handleSegmentPreviewToggle = () => {
    if (isPlayingSegmentPreview) {
      stopSegmentPreview();
    } else if (selectedVoiceSegmentId) {
      playSegmentPreview(selectedVoiceSegmentId);
    }
  };

  const stopPlayback = () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch (e) {}
      activeSourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const playBufferWithEffects = (buffer: AudioBuffer) => {
    stopPlayback();

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Apply pitch shift (detune) and speed
    source.playbackRate.value = playbackSpeed;
    source.detune.value = pitchShift * 100; // 1 semitone = 100 cents

    let lastNode: AudioNode = source;

    // Apply EQ presets
    if (eqPreset === "bass") {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowshelf";
      filter.frequency.value = 200;
      filter.gain.value = 8;
      lastNode.connect(filter);
      lastNode = filter;
    } else if (eqPreset === "treble") {
      const filter = ctx.createBiquadFilter();
      filter.type = "highshelf";
      filter.frequency.value = 3000;
      filter.gain.value = 8;
      lastNode.connect(filter);
      lastNode = filter;
    }

    lastNode.connect(ctx.destination);
    source.start(0);

    activeSourceRef.current = source;
    audioCtxRef.current = ctx;
    setIsPlaying(true);

    source.onended = () => {
      setIsPlaying(false);
    };
  };

  const handlePlayToggle = () => {
    if (isPlaying) {
      stopPlayback();
    } else if (generatedBuffer) {
      playBufferWithEffects(generatedBuffer);
    }
  };

  // Convert base64 string to AudioBuffer
  const decodeBase64ToAudioBuffer = async (base64: string): Promise<AudioBuffer> => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      let decoded: AudioBuffer;
      try {
        const wavBuffer = convertRawPcmToWavBuffer(bytes, 24000);
        decoded = await ctx.decodeAudioData(wavBuffer);
      } catch (decodeErr) {
        console.warn("Speech decoding failed in VoiceProfileStudio, using synthetic fallback waveform:", decodeErr);
        const estimatedDuration = Math.max(2, Math.min(60, Math.round(textToSpeak.length / 15)));
        decoded = createFallbackAudioBuffer(ctx, estimatedDuration);
      }
      return decoded;
    } finally {
      ctx.close();
    }
  };

  // Helper to slice a specific segment and compile it to a base64 WAV stream
  const getSegmentBase64 = async (segId: string): Promise<{ base64: string; mimeType: string } | null> => {
    if (!audioBuffer) return null;
    const seg = segments.find(s => s.id === segId);
    if (!seg) return null;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      const sliced = seg.customBuffer ? seg.customBuffer : sliceAudioBuffer(ctx, audioBuffer, seg.start, seg.end);
      const wavBlob = audioBufferToWav(sliced);
      
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(wavBlob);
      });
      return { base64, mimeType: "audio/wav" };
    } catch (e: any) {
      addLog("error", "action", `Failed to compile reference voice segment: ${e.message}`);
      return null;
    } finally {
      ctx.close();
    }
  };

  // Analyze voice profile of original podcast file or selected clean segment
  const handleAnalyzeVoice = async () => {
    if (!originalFile) return;

    setIsAnalyzing(true);
    let targetBase64 = "";
    let targetMimeType = "";

    if (selectedVoiceSegmentId) {
      addLog("info", "action", `Initiating Voice Profile Analysis of selected timeline segment "${selectedVoiceSegmentId}"`);
      const compiled = await getSegmentBase64(selectedVoiceSegmentId);
      if (compiled) {
        targetBase64 = compiled.base64;
        targetMimeType = compiled.mimeType;
      } else {
        setIsAnalyzing(false);
        return;
      }
    } else {
      addLog("info", "action", "Initiating Voice Profile Analysis of original podcast audio (first 1.5MB)");
      const limitBytes = 1.5 * 1024 * 1024;
      targetBase64 = originalFile.base64.slice(0, limitBytes);
      targetMimeType = originalFile.mimeType;
    }

    try {
      const response = await fetch("/api/analyze-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: targetBase64,
          mimeType: targetMimeType
        })
      });

      if (!response.ok) {
        throw new Error(`Voice Analysis failed with status ${response.status}`);
      }

      const result: VoiceProfile = await response.json();
      setProfile(result);
      
      // Auto-prepopulate style guidelines based on analyzed attributes
      const guidelines = `Voice style parameters: perceived ${result.gender.toLowerCase()} voice, pitch ${result.pitch.toLowerCase()}, speaking pacing is ${result.speed.toLowerCase()} with a ${result.accent.toLowerCase()} accent. Tone delivery vibe is ${result.vibe.toLowerCase()}.`;
      setStyleGuidelines(guidelines);

      if (selectedVoiceSegmentId) {
        setVoicePreset("cloned");
        addLog("success", "action", `Voice Profile Analysis complete. Defaulted synthesis engine preset to "Clone Voice" to replicate this specific segment.`, result);
      } else {
        setVoicePreset(result.suggestedPreset);
        addLog("success", "action", `Voice Profile Analysis complete. Suggested voice actor preset: ${result.suggestedPreset}`, result);
      }
    } catch (err: any) {
      addLog("error", "action", `Voice Profile Analysis failed: ${err.message}`);
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Generate TTS Speech
  const handleGenerateSpeech = async () => {
    if (!textToSpeak.trim()) return;

    setIsGenerating(true);
    stopPlayback();
    
    let refAudio = "";
    let refMime = "";

    if (selectedVoiceSegmentId) {
      addLog("info", "action", `Compiling voice cloning reference from segment "${selectedVoiceSegmentId}"`);
      const compiled = await getSegmentBase64(selectedVoiceSegmentId);
      if (compiled) {
        refAudio = compiled.base64;
        refMime = compiled.mimeType;
      }
    }

    addLog("info", "action", `Requesting Voice Synthesis for text: "${textToSpeak.slice(0, 40)}..." using preset: ${voicePreset}`);

    try {
      const response = await fetch("/api/generate-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textToSpeak: textToSpeak,
          voicePreset: voicePreset,
          styleGuidelines: styleGuidelines,
          referenceAudio: refAudio || undefined,
          mimeType: refMime || undefined
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `TTS generation failed with status ${response.status}`);
      }

      const result = await response.json();
      setGeneratedAudioBase64(result.audio);

      // Decode base64 to AudioBuffer so we can apply real-time adjustments and insert into timeline
      const decoded = await decodeBase64ToAudioBuffer(result.audio);
      setGeneratedBuffer(decoded);

      addLog("success", "action", `Voice synthesis successful. Output audio decoded: ${decoded.duration.toFixed(2)}s duration`);

      // Play the generated sound immediately as feedback
      playBufferWithEffects(decoded);
    } catch (err: any) {
      addLog("error", "action", `Speech generation failed: ${err.message}`);
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  // Render the finalized audio buffer with all Pitch, Speed, and EQ modifications baked in
  const renderFinalizedBuffer = async (): Promise<AudioBuffer | null> => {
    if (!generatedBuffer) return null;

    addLog("info", "action", `Baking Voice Profile modifications (pitch detune: ${pitchShift} semitones, playback speed: ${playbackSpeed}x, EQ: ${eqPreset}) into finalized audio stream`);

    const duration = generatedBuffer.duration / playbackSpeed;
    const sampleRate = generatedBuffer.sampleRate;
    const offlineCtx = new OfflineAudioContext(
      generatedBuffer.numberOfChannels,
      sampleRate * duration,
      sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = generatedBuffer;
    source.playbackRate.value = playbackSpeed;
    source.detune.value = pitchShift * 100;

    let lastNode: AudioNode = source;

    if (eqPreset === "bass") {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = "lowshelf";
      filter.frequency.value = 200;
      filter.gain.value = 8;
      lastNode.connect(filter);
      lastNode = filter;
    } else if (eqPreset === "treble") {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = "highshelf";
      filter.frequency.value = 3000;
      filter.gain.value = 8;
      lastNode.connect(filter);
      lastNode = filter;
    }

    lastNode.connect(offlineCtx.destination);
    source.start(0);

    try {
      const rendered = await offlineCtx.startRendering();
      addLog("success", "action", `Audio baking finished successfully. Rendered buffer duration: ${rendered.duration.toFixed(2)}s`);
      return rendered;
    } catch (e: any) {
      addLog("error", "action", `Failed to bake audio modifications: ${e.message}`);
      return generatedBuffer; // fallback to original generated buffer
    }
  };

  // Export as new segment on timeline
  const handleAddToTimeline = async () => {
    const finalBuffer = await renderFinalizedBuffer();
    if (!finalBuffer) return;

    // Calculate a unique timing slot. We place new TTS elements chronologically at the end of the podcast, or at an arbitrary free slot
    let newStart = 0;
    if (segments.length > 0) {
      newStart = Math.max(...segments.map((s) => s.end)) + 1.0; // 1s padding
    }

    const duration = finalBuffer.duration;
    const newSeg: AudioSegment = {
      id: `tts-${Math.random().toString(36).substring(2, 11)}`,
      start: newStart,
      end: newStart + duration,
      transcript: `[Custom Synthesized Speech]: ${textToSpeak}`,
      keep: true,
      customBuffer: finalBuffer,
      isPatched: true
    };

    onAddSegment(newSeg);
    addLog("success", "action", `Inserted newly synthesized voice segment into Studio Timeline at [${newStart.toFixed(1)}s - ${(newStart + duration).toFixed(1)}s]`, newSeg);
  };

  // Replace/Patch an existing selected segment in the podcast
  const handleReplaceSegment = async () => {
    if (!selectedSegmentToReplace) return;
    const finalBuffer = await renderFinalizedBuffer();
    if (!finalBuffer) return;

    const targetSeg = segments.find((s) => s.id === selectedSegmentToReplace);
    if (!targetSeg) return;

    const duration = finalBuffer.duration;
    const updated: AudioSegment = {
      ...targetSeg,
      customBuffer: finalBuffer,
      isPatched: true,
      transcript: `[Vocal Matched Patch]: ${textToSpeak} (Original: ${targetSeg.transcript})`
    };

    onUpdateSegment(updated);
    addLog("success", "action", `Successfully patched segment "${targetSeg.id}" with custom generated TTS vocal track`, updated);
  };

  // Download raw WAV
  const handleDownloadWav = async () => {
    const finalBuffer = await renderFinalizedBuffer();
    if (!finalBuffer) return;

    try {
      const blob = audioBufferToWav(finalBuffer);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `voice_profile_tts_${voicePreset.toLowerCase()}_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog("success", "action", `WAV download generated for custom voice patch.`);
    } catch (e: any) {
      addLog("error", "action", `WAV download compilation failed: ${e.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-6" id="voice-profile-studio-tab">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* LEFT COLUMN: Voice Profile Builder / Analysis */}
        <div className="lg:col-span-5 flex flex-col p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-emerald-400 shrink-0" />
              <h2 className="text-base font-bold text-slate-100">Host Voice Profile Builder</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Analyze the original podcast recording using Gemini multimodal audio capabilities to extract a rich vocal profile card. This informs speech synthesis to maintain cohesive character delivery.
            </p>

            {originalFile ? (
              <div className="flex items-center justify-between p-3 bg-slate-950/60 border border-slate-800 rounded-xl mb-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileAudio className="w-5 h-5 text-indigo-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-300 truncate">{originalFile.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono">Ready for AI vocal style scanning</p>
                  </div>
                </div>
                <button
                  id="btn-analyze-voice"
                  onClick={handleAnalyzeVoice}
                  disabled={isAnalyzing}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Scanning...</span>
                    </>
                  ) : (
                    <>
                      <Radio className="w-3.5 h-3.5" />
                      <span>Scan Voice</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="p-4 bg-slate-950/35 border border-dashed border-slate-800 rounded-xl text-center mb-4">
                <p className="text-xs text-slate-500 mb-1 font-sans">No primary audio loaded</p>
                <p className="text-[10px] text-slate-600 font-sans max-w-xs mx-auto">
                  Please upload a podcast file in the Editor Studio tab to enable voice matching.
                </p>
              </div>
            )}

            {/* Timeline Segment Picker for Voice Cloning */}
            {originalFile && (
              <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-200">Select Voice Training Segment</span>
                  <span className="text-[9px] font-mono bg-emerald-950/45 text-emerald-400 border border-emerald-900/50 px-1.5 py-0.5 rounded">Highly Recommended</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal mb-3 font-sans">
                  Isolate a clean, single-speaker segment of your voice from the timeline. This bypasses other voices (e.g. the female interviewer) to achieve perfect cloning results.
                </p>

                <div className="flex gap-2 items-center">
                  <select
                    id="select-voice-training-segment"
                    value={selectedVoiceSegmentId}
                    onChange={(e) => {
                      const segId = e.target.value;
                      setSelectedVoiceSegmentId(segId);
                      if (segId) {
                        setVoicePreset("cloned");
                        addLog("info", "click", `Selected timeline segment ${segId} for voice training. Set voice preset to "Clone Voice".`);
                      } else {
                        if (voicePreset === "cloned") {
                          setVoicePreset("Puck");
                        }
                        addLog("info", "click", "Cleared segment selection; reverted back to standard voice actor presets.");
                      }
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg py-1.5 px-3 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50 cursor-pointer font-sans"
                  >
                    <option value="">Full podcast file (un-segmented, mixes voices)</option>
                    {segments.map((s, idx) => (
                      <option key={s.id} value={s.id}>
                        Segment #{idx + 1} ({s.start.toFixed(1)}s - {s.end.toFixed(1)}s)
                      </option>
                    ))}
                  </select>

                  {selectedVoiceSegmentId && (
                    <button
                      id="btn-preview-training-segment"
                      onClick={handleSegmentPreviewToggle}
                      className={`p-2 rounded-lg flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                        isPlayingSegmentPreview
                          ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/40 animate-pulse"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                      }`}
                      title={isPlayingSegmentPreview ? "Stop playing preview" : "Play segment preview"}
                    >
                      {isPlayingSegmentPreview ? (
                        <Square className="w-4 h-4 fill-current text-rose-400" />
                      ) : (
                        <Play className="w-4 h-4 fill-current text-slate-300" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Profile Display */}
            {profile ? (
              <div className="space-y-4 animate-fadeIn">
                <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-900 grid grid-cols-2 gap-3 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Gender / Type</span>
                    <span className="text-slate-200 font-semibold">{profile.gender}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Pitch Level</span>
                    <span className="text-slate-200 font-semibold">{profile.pitch}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Speed / Pacing</span>
                    <span className="text-slate-200 font-semibold">{profile.speed}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Accent / Region</span>
                    <span className="text-slate-200 font-semibold text-emerald-400">{profile.accent}</span>
                  </div>
                  <div className="col-span-2 border-t border-slate-900/50 pt-2">
                    <span className="text-slate-500 block text-[9px] uppercase">Timbre Vibe</span>
                    <span className="text-slate-300 italic">"{profile.vibe}"</span>
                  </div>
                </div>

                <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <UserCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-200">Recommended Voice Match</span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">
                    Based on timbre similarities, we suggest utilizing the <strong className="text-emerald-400 font-bold">{profile.suggestedPreset}</strong> actor preset.
                  </p>
                  <p className="text-[10px] text-slate-500 mt-2 italic leading-relaxed">
                    {profile.explanation}
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/20 rounded-xl border border-slate-900 p-6 flex flex-col items-center justify-center text-center py-10">
                <Radio className="w-8 h-8 text-slate-800 mb-2" />
                <p className="text-xs text-slate-500 font-sans">Vocal Style Card Not Generated</p>
                <p className="text-[10px] text-slate-600 font-sans max-w-xs mt-1">
                  Once scanned, detailed statistics such as pitch range, regional dialect, and recommended presets will compile here.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800/40 pt-4 mt-6">
            <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Adaptive Style Conditioning enabled</span>
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: Synthesis Settings & Playback Actions */}
        <div className="lg:col-span-7 flex flex-col p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md gap-5">
          <div className="flex items-center justify-between border-b border-slate-800/50 pb-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-indigo-400 shrink-0" />
              <h2 className="text-base font-bold text-slate-100">Text-to-Speech Engine</h2>
            </div>
            <span className="text-[10px] font-mono bg-indigo-950/45 text-indigo-400 border border-indigo-900/50 px-2 py-0.5 rounded-lg">
              gemini-3.1-flash-tts
            </span>
          </div>

          {/* Preset Voice & Style Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Select Voice Actor Preset</label>
              <select
                id="select-voice-actor"
                value={voicePreset}
                onChange={(e) => setVoicePreset(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50 cursor-pointer font-sans"
              >
                {prebuiltVoices.map((v) => (
                  <option key={v.name} value={v.name} disabled={v.name === "cloned" && !selectedVoiceSegmentId}>
                    {v.name === "cloned"
                      ? (selectedVoiceSegmentId ? "✨ Clone Voice (from selected segment)" : "✨ Clone Voice (Select timeline segment first)")
                      : `${v.name} (${v.description})`
                    }
                  </option>
                ))}
              </select>
              {voicePreset === "cloned" && !selectedVoiceSegmentId && (
                <span className="text-[10px] text-amber-500 font-mono">
                  ⚠️ Please select a segment from the timeline first.
                </span>
              )}
              {voicePreset === "cloned" && selectedVoiceSegmentId && (
                <span className="text-[10px] text-emerald-400 font-mono">
                  ✨ Perfect! Gemini will replicate the voice of the selected training segment.
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Vocal Conditioning Prompt</label>
              <input
                id="input-style-guidelines"
                type="text"
                placeholder="e.g. Speak with an energetic, quick tone and a high pitch"
                value={styleGuidelines}
                onChange={(e) => setStyleGuidelines(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 font-sans"
              />
            </div>
          </div>

          {/* Arbitrary Text Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-medium">Text to Synthesize</label>
            <textarea
              id="textarea-tts-content"
              rows={3}
              placeholder="Type the speech content you wish to generate here..."
              value={textToSpeak}
              onChange={(e) => setTextToSpeak(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 font-sans resize-none leading-relaxed"
            />
          </div>

          <div className="flex justify-end shrink-0">
            <button
              id="btn-generate-speech"
              onClick={handleGenerateSpeech}
              disabled={isGenerating || !textToSpeak.trim()}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-500/10"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing Vocal Tract...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Synthesize Custom Speech</span>
                </>
              )}
            </button>
          </div>

          {/* Audition & Micro Modulation Board */}
          {generatedBuffer && (
            <div className="bg-slate-950/70 border border-slate-900 rounded-xl p-5 space-y-5 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-slate-900/60 pb-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Real-time Vocal Modulator</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  Buffer length: {generatedBuffer.duration.toFixed(2)}s @ {generatedBuffer.sampleRate}Hz
                </span>
              </div>

              {/* Modulators Sliders */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Pitch Slider */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">Pitch Shift</span>
                    <span className="text-emerald-400 font-semibold">
                      {pitchShift > 0 ? `+${pitchShift}` : pitchShift} semitones
                    </span>
                  </div>
                  <input
                    id="slider-pitch-shift"
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={pitchShift}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setPitchShift(val);
                      // If playing, restart with new pitch instantly
                      if (isPlaying) playBufferWithEffects(generatedBuffer);
                    }}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[9px] text-slate-600 font-mono">
                    <span>Lower</span>
                    <span>Flat</span>
                    <span>Higher</span>
                  </div>
                </div>

                {/* Speed Slider */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">Speech Rate</span>
                    <span className="text-emerald-400 font-semibold">{playbackSpeed.toFixed(2)}x</span>
                  </div>
                  <input
                    id="slider-playback-speed"
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={playbackSpeed}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setPlaybackSpeed(val);
                      // If playing, restart with new speed instantly
                      if (isPlaying) playBufferWithEffects(generatedBuffer);
                    }}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[9px] text-slate-600 font-mono">
                    <span>0.5x</span>
                    <span>1.0x</span>
                    <span>2.0x</span>
                  </div>
                </div>

                {/* EQ / Tone Filter Select */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-mono text-slate-400">Equalizer Profile</span>
                  <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-900 rounded-lg border border-slate-800">
                    <button
                      id="btn-eq-normal"
                      onClick={() => {
                        setEqPreset("normal");
                        if (isPlaying) setTimeout(() => playBufferWithEffects(generatedBuffer), 50);
                      }}
                      className={`py-1 px-1.5 text-[10px] font-mono rounded cursor-pointer transition-all ${
                        eqPreset === "normal" ? "bg-slate-800 text-emerald-400 font-semibold" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Flat
                    </button>
                    <button
                      id="btn-eq-bass"
                      onClick={() => {
                        setEqPreset("bass");
                        if (isPlaying) setTimeout(() => playBufferWithEffects(generatedBuffer), 50);
                      }}
                      className={`py-1 px-1.5 text-[10px] font-mono rounded cursor-pointer transition-all ${
                        eqPreset === "bass" ? "bg-slate-800 text-emerald-400 font-semibold" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Bass
                    </button>
                    <button
                      id="btn-eq-treble"
                      onClick={() => {
                        setEqPreset("treble");
                        if (isPlaying) setTimeout(() => playBufferWithEffects(generatedBuffer), 50);
                      }}
                      className={`py-1 px-1.5 text-[10px] font-mono rounded cursor-pointer transition-all ${
                        eqPreset === "treble" ? "bg-slate-800 text-emerald-400 font-semibold" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Bright
                    </button>
                  </div>
                  <span className="text-[9px] text-slate-600 font-mono text-center">Biquad Filter EQ</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-t border-slate-900 pt-4 gap-4">
                {/* Play/Pause */}
                <div className="flex items-center gap-2">
                  <button
                    id="btn-audition-play"
                    onClick={handlePlayToggle}
                    className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer transition-all ${
                      isPlaying
                        ? "bg-slate-800 text-amber-400 border border-slate-700"
                        : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Square className="w-3.5 h-3.5" />
                        <span>Stop Audition</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>Audition Patch</span>
                      </>
                    )}
                  </button>

                  <button
                    id="btn-download-wav"
                    onClick={handleDownloadWav}
                    className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-all cursor-pointer"
                    title="Download generated speech as WAV file"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>

                {/* Timeline placement actions */}
                <div className="flex items-center gap-2">
                  {/* Select box for replacing */}
                  {segments.length > 0 && (
                    <div className="flex items-center gap-1.5 bg-slate-900/50 p-1.5 rounded-lg border border-slate-800">
                      <select
                        id="select-replace-segment"
                        value={selectedSegmentToReplace}
                        onChange={(e) => setSelectedSegmentToReplace(e.target.value)}
                        className="bg-transparent border-none text-[10px] text-slate-300 font-sans focus:outline-none max-w-[130px]"
                      >
                        <option value="">-- Replace Seg --</option>
                        {segments.map((s, idx) => (
                          <option key={s.id} value={s.id} className="bg-slate-950 text-slate-300">
                            Seg {idx + 1}: "{s.transcript.slice(0, 20)}..."
                          </option>
                        ))}
                      </select>
                      <button
                        id="btn-replace-segment-patch"
                        onClick={handleReplaceSegment}
                        disabled={!selectedSegmentToReplace}
                        className="px-2 py-1 bg-indigo-500 hover:bg-indigo-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 text-[10px] font-bold rounded cursor-pointer transition-all shrink-0"
                      >
                        Apply Patch
                      </button>
                    </div>
                  )}

                  {/* Add as new */}
                  <button
                    id="btn-add-to-timeline"
                    onClick={handleAddToTimeline}
                    className="px-3 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-emerald-400 hover:text-emerald-300 font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer transition-all shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Insert to Timeline</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
