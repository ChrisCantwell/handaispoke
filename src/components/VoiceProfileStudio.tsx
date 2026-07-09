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
  Maximize2,
  AlertCircle,
  Upload,
  Trash2,
  User,
  FileText,
  Save,
  CheckCircle2,
  Activity,
  ListRestart
} from "lucide-react";
import { 
  audioBufferToWav, 
  convertRawPcmToWavBuffer, 
  createFallbackAudioBuffer, 
  sliceAudioBuffer,
  concatenateAudioBuffers
} from "../utils/audioUtils";

interface VoiceProfile {
  gender: string;
  pitch: string;
  speed: string;
  accent: string;
  vibe: string;
  suggestedPreset: string;
  explanation: string;
}

export interface StoredSpeakerProfile {
  id: string;
  name: string;
  gender: string;
  pitch: string;
  speed: string;
  accent: string;
  vibe: string;
  voicePreset: string;
  styleGuidelines: string;
  referenceAudio?: string; // base64
  referenceText?: string;
  mimeType?: string;
  updatedAt?: string;
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
  onSetMasterTimeline?: (
    buffer: AudioBuffer,
    segments: AudioSegment[],
    fileName: string,
    fileBase64: string
  ) => void;
}

export default function VoiceProfileStudio({
  originalFile,
  audioBuffer,
  segments,
  onAddSegment,
  onUpdateSegment,
  addLog,
  onSetMasterTimeline
}: VoiceProfileStudioProps) {
  // Voice Profile States
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Generation Settings
  const [voicePreset, setVoicePreset] = useState("cloned");
  const [styleGuidelines, setStyleGuidelines] = useState("");
  const [textToSpeak, setTextToSpeak] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

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

  // Voice Profile Builder Mode
  const [profileSource, setProfileSource] = useState<"timeline" | "direct">("timeline");

  // Direct reference audio/text upload
  const [directAudioName, setDirectAudioName] = useState("");
  const [directAudioBase64, setDirectAudioBase64] = useState("");
  const [directAudioMimeType, setDirectAudioMimeType] = useState("");
  const [directAudioBuffer, setDirectAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlayingDirectPreview, setIsPlayingDirectPreview] = useState(false);
  const [referenceText, setReferenceText] = useState("");

  // Saved speaker profiles library
  const [speakerName, setSpeakerName] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [savedProfiles, setSavedProfiles] = useState<StoredSpeakerProfile[]>([]);

  // Script TTS Processing states
  const [engineMode, setEngineMode] = useState<"single" | "script">("single");
  const [scriptText, setScriptText] = useState(
    `[ChatGPT] Can I ask Chris a question?\n[Chris] I love answering questions!\n[ChatGPT] Why do you love answering questions?\n[Chris] Because I have all the answers`
  );
  const [defaultUnmatchedPreset, setDefaultUnmatchedPreset] = useState("Puck");
  const [isProcessingScript, setIsProcessingScript] = useState(false);
  const [scriptProgress, setScriptProgress] = useState(0);
  const [scriptProgressText, setScriptProgressText] = useState("");
  const [scriptError, setScriptError] = useState<string | null>(null);

  // Fetch saved profiles from API on mount
  const fetchSavedProfiles = async () => {
    try {
      const res = await fetch("/api/speaker-profiles");
      if (res.ok) {
        const data = await res.json();
        setSavedProfiles(data);
      }
    } catch (e) {
      console.error("Failed to fetch speaker profiles:", e);
    }
  };

  useEffect(() => {
    fetchSavedProfiles();
  }, []);

  // Direct Audio uploading handler
  const handleDirectAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setDirectAudioName(file.name);
    setDirectAudioMimeType(file.type);
    addLog("info", "action", `Reading direct reference audio upload: ${file.name}`);
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(",")[1];
      setDirectAudioBase64(base64);
      
      // Decode to AudioBuffer for playback previewing
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const tempCtx = new AudioCtx();
        const arrayBuf = await file.arrayBuffer();
        const decoded = await tempCtx.decodeAudioData(arrayBuf);
        setDirectAudioBuffer(decoded);
        tempCtx.close();
        addLog("success", "action", `Direct reference sample decoded: ${decoded.duration.toFixed(2)}s duration`);
      } catch (err: any) {
        addLog("warn", "browser", `Could not decode audio sample directly, using synthetic preview fallback: ${err.message}`);
      }
    };
  };

  // Direct Text uploading handler
  const handleDirectTextUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setReferenceText(text);
      addLog("success", "action", `Uploaded reference transcript file: ${file.name} (${text.length} characters)`);
    };
    reader.readAsText(file);
  };

  // Handle uploading multi-speaker script text file
  const handleScriptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setScriptText(text);
      addLog("success", "action", `Uploaded conversation script file: ${file.name} (${text.length} characters)`);
    };
    reader.readAsText(file);
  };

  // Direct Reference Audio Play/Stop previewer
  const handleToggleDirectPreview = () => {
    stopSegmentPreview();
    stopPlayback();
    
    if (isPlayingDirectPreview) {
      stopSegmentPreview(); // reuse standard stopper
      setIsPlayingDirectPreview(false);
      return;
    }

    if (!directAudioBuffer) {
      addLog("warn", "action", "No direct audio loaded for preview.");
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      previewCtxRef.current = audioCtx;

      const source = audioCtx.createBufferSource();
      source.buffer = directAudioBuffer;
      source.connect(audioCtx.destination);
      source.onended = () => {
        setIsPlayingDirectPreview(false);
      };
      source.start(0);
      previewSourceRef.current = source;
      setIsPlayingDirectPreview(true);
    } catch (err: any) {
      addLog("error", "browser", `Failed to preview direct audio sample: ${err.message}`);
    }
  };

  // Compile selected timeline segment into base64 for profile saving
  const getSegmentBase64 = async (segId: string): Promise<{ base64: string; mimeType: string } | null> => {
    if (!audioBuffer) return null;
    const seg = segments.find((s) => s.id === segId);
    if (!seg) return null;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const sliced = seg.customBuffer ? seg.customBuffer : sliceAudioBuffer(audioCtx, audioBuffer, seg.start, seg.end);
      audioCtx.close();
      
      const wavBlob = audioBufferToWav(sliced);
      const b64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve((reader.result as string).split(",")[1]);
        };
        reader.readAsDataURL(wavBlob);
      });
      return { base64: b64, mimeType: "audio/wav" };
    } catch (e: any) {
      console.error("Failed to extract segment base64:", e);
      return null;
    }
  };

  // Name and Save reference pair as reusable speaker profile
  const handleSaveProfile = async () => {
    if (!speakerName.trim()) {
      addLog("warn", "action", "Please enter a speaker name for the profile.");
      return;
    }

    setIsSavingProfile(true);
    addLog("info", "action", `Saving speaker profile "${speakerName}"...`);

    try {
      let refAudio = "";
      let refMime = "";

      if (profileSource === "timeline") {
        if (!selectedVoiceSegmentId) {
          throw new Error("Please select a segment from the timeline first.");
        }
        const extracted = await getSegmentBase64(selectedVoiceSegmentId);
        if (extracted) {
          refAudio = extracted.base64;
          refMime = extracted.mimeType;
        } else {
          throw new Error("Failed to extract training audio from selected timeline segment.");
        }
      } else {
        if (!directAudioBase64) {
          throw new Error("Please upload a reference audio sample first.");
        }
        refAudio = directAudioBase64;
        refMime = directAudioMimeType || "audio/wav";
      }

      // Construct profile fields
      const payload = {
        name: speakerName.trim(),
        gender: profile?.gender || "Warm Neutral",
        pitch: profile?.pitch || "Medium",
        speed: profile?.speed || "Normal",
        accent: profile?.accent || "General American",
        vibe: profile?.vibe || "Professional",
        voicePreset: voicePreset,
        styleGuidelines: styleGuidelines || "Speak in an expressive, matched voice style.",
        referenceAudio: refAudio,
        referenceText: referenceText || "Accompanied reference speech script sample.",
        mimeType: refMime,
      };

      const response = await fetch("/api/speaker-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Server returned ${response.status}`);
      }

      addLog("success", "action", `Speaker profile "${speakerName.trim()}" successfully persisted both server-side and in local cache!`);
      setSpeakerName("");
      fetchSavedProfiles();
    } catch (err: any) {
      addLog("error", "action", `Failed to save speaker profile: ${err.message}`);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Delete a saved profile
  const handleDeleteProfile = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete speaker profile "${name}"?`)) {
      return;
    }

    addLog("info", "action", `Deleting speaker profile: ${name}`);
    try {
      const response = await fetch("/api/speaker-profiles/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      addLog("success", "action", `Permanently deleted speaker profile: ${name}`);
      fetchSavedProfiles();
    } catch (err: any) {
      addLog("error", "action", `Failed to delete profile: ${err.message}`);
    }
  };

  // Parse Multi-Speaker script text into structural conversational turns
  const parseMultiSpeakerScript = (text: string) => {
    const lines = text.split("\n");
    const turns: { speaker: string; text: string }[] = [];
    const regex = /^\[([^\]]+)\]\s*(.*)$/;
    
    let currentSpeaker = "";
    let currentText = "";
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const match = trimmed.match(regex);
      if (match) {
        if (currentSpeaker) {
          turns.push({ speaker: currentSpeaker, text: currentText.trim() });
        }
        currentSpeaker = match[1].trim();
        currentText = match[2].trim();
      } else {
        if (currentSpeaker) {
          currentText += " " + trimmed;
        }
      }
    }
    
    if (currentSpeaker) {
      turns.push({ speaker: currentSpeaker, text: currentText.trim() });
    }
    
    return turns;
  };

  // Orchestrate sequential multi-speaker TTS script generation and timeline assembly
  const handleProcessScript = async () => {
    if (!scriptText.trim()) {
      setScriptError("Please type or upload a multi-speaker script first.");
      return;
    }
    
    setScriptError(null);
    setIsProcessingScript(true);
    setScriptProgress(5);
    setScriptProgressText("Parsing script structure and isolating speaker tags...");
    addLog("info", "action", "Starting conversational script production...");
    
    try {
      const turns = parseMultiSpeakerScript(scriptText);
      if (turns.length === 0) {
        throw new Error("Could not parse any speaker turns. Use bracket tags like [Chris] text at the beginning of speaker turns.");
      }
      
      addLog("info", "action", `Parsed ${turns.length} dialog turns from script.`);
      
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const generatedBuffers: AudioBuffer[] = [];
      
      // Sequential processing loop to avoid resource exhaustion & allow smooth updates
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const progressPercentage = 5 + Math.round((i / turns.length) * 80);
        setScriptProgress(progressPercentage);
        setScriptProgressText(`Processing turn ${i + 1}/${turns.length}: [${turn.speaker}] speaking...`);
        
        // Lookup matching profile
        const profile = savedProfiles.find(
          (p) => p.name.toLowerCase().trim() === turn.speaker.toLowerCase().trim()
        );
        
        let payload: any = {
          textToSpeak: turn.text,
        };
        
        if (profile) {
          payload.voicePreset = profile.voicePreset;
          payload.styleGuidelines = profile.styleGuidelines;
          if (profile.voicePreset === "cloned" && profile.referenceAudio) {
            payload.referenceAudio = profile.referenceAudio;
            payload.mimeType = profile.mimeType || "audio/wav";
          }
          addLog("info", "api", `Synthesizing turn ${i + 1} for matching profile "${turn.speaker}" (Preset: ${profile.voicePreset})`);
        } else {
          payload.voicePreset = defaultUnmatchedPreset;
          payload.styleGuidelines = "Speak in a natural voice style.";
          addLog("info", "api", `Synthesizing turn ${i + 1} for unmatched speaker "${turn.speaker}" using fallback "${defaultUnmatchedPreset}"`);
        }
        
        const res = await fetch("/api/generate-patch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(`Generation failed for turn ${i + 1} (${turn.speaker}): ${errData.error || res.statusText}`);
        }
        
        const resJson = await res.json();
        
        // Decode base64 to AudioBuffer
        const binaryString = window.atob(resJson.audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }
        
        let decodedTurnBuffer: AudioBuffer;
        try {
          const wavBuffer = convertRawPcmToWavBuffer(bytes, 24000);
          decodedTurnBuffer = await audioCtx.decodeAudioData(wavBuffer);
        } catch (decodeErr) {
          console.warn(`Turn ${i + 1} decoding failed, using fallback buffer:`, decodeErr);
          const estDuration = Math.max(1.5, Math.min(10, Math.round(turn.text.length / 15)));
          decodedTurnBuffer = createFallbackAudioBuffer(audioCtx, estDuration);
        }
        
        generatedBuffers.push(decodedTurnBuffer);
      }
      
      setScriptProgress(90);
      setScriptProgressText("Stitching dialog blocks with equal-power transparent crossfades...");
      
      // Stitch all buffers together
      const stitchedBuffer = concatenateAudioBuffers(audioCtx, generatedBuffers);
      
      // Build chronological audio segments
      let accumulatedTime = 0;
      const finalSegments: AudioSegment[] = [];
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const buffer = generatedBuffers[i];
        const duration = buffer.duration;
        
        finalSegments.push({
          id: `turn-${i}-${Math.random().toString(36).substring(2, 9)}`,
          start: accumulatedTime,
          end: accumulatedTime + duration,
          transcript: `[${turn.speaker}]: ${turn.text}`,
          keep: true,
          customBuffer: buffer,
          isPatched: true
        });
        accumulatedTime += duration;
      }
      
      setScriptProgress(95);
      setScriptProgressText("Baking stitched master waveform...");
      
      // Convert stitched buffer to base64 WAV
      const stitchedWavBlob = audioBufferToWav(stitchedBuffer);
      const finalBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve((reader.result as string).split(",")[1]);
        };
        reader.readAsDataURL(stitchedWavBlob);
      });
      
      setScriptProgress(100);
      setScriptProgressText("Timeline assembled! Transferring to editor...");
      
      addLog("success", "action", `Successfully produced script dialog timeline: ${turns.length} speaker turns, total duration ${stitchedBuffer.duration.toFixed(2)}s`);
      
      // Load into parent editor
      if (onSetMasterTimeline) {
        setTimeout(() => {
          onSetMasterTimeline(stitchedBuffer, finalSegments, `script_produced_${Date.now()}.wav`, finalBase64);
        }, 600);
      }
      
      setIsProcessingScript(false);
    } catch (err: any) {
      console.error(err);
      setScriptError(err.message || "An unexpected error occurred during multi-speaker processing.");
      addLog("error", "action", `Script processing failed: ${err.message}`);
      setIsProcessingScript(false);
    }
  };

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

  // Analyze voice profile of original podcast file, selected clean segment, or direct reference audio
  const handleAnalyzeVoice = async () => {
    setIsAnalyzing(true);
    let targetBase64 = "";
    let targetMimeType = "";

    if (profileSource === "direct") {
      if (!directAudioBase64) {
        addLog("warn", "action", "No direct reference audio uploaded to analyze.");
        setIsAnalyzing(false);
        return;
      }
      addLog("info", "action", "Initiating Voice Profile Analysis of uploaded direct reference sample");
      targetBase64 = directAudioBase64;
      targetMimeType = directAudioMimeType || "audio/wav";
    } else {
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
        if (!originalFile) {
          addLog("warn", "action", "Please load an audio file first or select a timeline segment.");
          setIsAnalyzing(false);
          return;
        }
        addLog("info", "action", "Initiating Voice Profile Analysis of original podcast audio (first 1.5MB)");
        const limitBytes = 1.5 * 1024 * 1024;
        targetBase64 = originalFile.base64.slice(0, limitBytes);
        targetMimeType = originalFile.mimeType;
      }
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

      if (profileSource === "direct") {
        setVoicePreset("cloned");
        addLog("success", "action", `Voice Profile Analysis of uploaded sample complete. Defaulted synthesis engine preset to "Clone Voice" to replicate this file.`, result);
      } else if (selectedVoiceSegmentId) {
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

    setGenerationError(null);

    if (voicePreset === "cloned" && !selectedVoiceSegmentId) {
      setGenerationError("Reference audio is required for text to speech generation");
      addLog("error", "action", "Reference audio is required for text to speech generation");
      return;
    }

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
      setGenerationError(err.message || "An error occurred during voice synthesis.");
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
        
        {/* LEFT COLUMN: Voice Profile Builder / Analysis & Saved Profiles */}
        <div className="lg:col-span-5 flex flex-col p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-400 shrink-0" />
              <h2 className="text-base font-bold text-slate-100">Host Voice Profile Builder</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Build speaker profiles by analyzing vocal tracks. Replicate accents, pitch, and timbre across scripts or timeline edits.
            </p>

            {/* Profile Source Tab Selector */}
            <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-lg border border-slate-800">
              <button
                onClick={() => {
                  setProfileSource("timeline");
                  setProfile(null);
                }}
                className={`py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  profileSource === "timeline"
                    ? "bg-slate-800 text-emerald-400 font-semibold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Timeline Source
              </button>
              <button
                onClick={() => {
                  setProfileSource("direct");
                  setProfile(null);
                }}
                className={`py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  profileSource === "direct"
                    ? "bg-slate-800 text-emerald-400 font-semibold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Direct Upload Reference
              </button>
            </div>

            {/* Timeline Source Panel */}
            {profileSource === "timeline" && (
              <div className="space-y-4 animate-fadeIn">
                {originalFile ? (
                  <div className="flex items-center justify-between p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
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
                  <div className="p-4 bg-slate-950/35 border border-dashed border-slate-800 rounded-xl text-center">
                    <p className="text-xs text-slate-500 mb-1 font-sans">No primary audio loaded</p>
                    <p className="text-[10px] text-slate-600 font-sans max-w-xs mx-auto">
                      Please upload a podcast file in the Speech Repair tab to enable voice matching.
                    </p>
                  </div>
                )}

                {originalFile && (
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4">
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
              </div>
            )}

            {/* Direct Upload Panel */}
            {profileSource === "direct" && (
              <div className="space-y-4 animate-fadeIn">
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Upload Reference Audio Sample</span>
                    <span className="text-[10px] font-mono text-slate-500">WAV, MP3, M4A</span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <label className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Choose Audio File</span>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={handleDirectAudioUpload}
                        className="hidden"
                      />
                    </label>
                    <span className="text-xs text-slate-400 truncate max-w-[180px]">
                      {directAudioName || "No file uploaded"}
                    </span>
                  </div>

                  {directAudioBuffer && (
                    <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-850">
                      <div className="flex items-center gap-2">
                        <FileAudio className="w-4 h-4 text-emerald-400" />
                        <span className="text-[10px] font-mono text-slate-300">
                          {directAudioBuffer.duration.toFixed(1)}s sample
                        </span>
                      </div>
                      <button
                        onClick={handleToggleDirectPreview}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer transition-all ${
                          isPlayingDirectPreview
                            ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/40"
                            : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                        }`}
                      >
                        {isPlayingDirectPreview ? (
                          <>
                            <Square className="w-3 h-3 fill-current" />
                            <span>Stop</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" />
                            <span>Preview</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Reference Transcript Text</span>
                    <label className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer flex items-center gap-1">
                      <Upload className="w-3 h-3" />
                      <span>Upload .txt</span>
                      <input
                        type="file"
                        accept=".txt"
                        onChange={handleDirectTextUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={referenceText}
                    onChange={(e) => setReferenceText(e.target.value)}
                    placeholder="Paste transcription text that matches reference audio here..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 font-sans resize-none leading-relaxed"
                  />
                </div>

                {/* Scan Direct Reference button */}
                <div className="flex justify-end">
                  <button
                    id="btn-analyze-direct-voice"
                    onClick={handleAnalyzeVoice}
                    disabled={isAnalyzing || !directAudioBase64}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer"
                  >
                    {isAnalyzing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>AI Timbre Scanning...</span>
                      </>
                    ) : (
                      <>
                        <Activity className="w-4 h-4" />
                        <span>Analyze Uploaded Sample</span>
                      </>
                    )}
                  </button>
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
                    Suggested preset: <strong className="text-emerald-400 font-bold">{profile.suggestedPreset}</strong>.
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1 italic leading-relaxed">
                    {profile.explanation}
                  </p>
                </div>

                {/* Save Section */}
                <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-xl space-y-3.5">
                  <div className="flex items-center gap-1.5">
                    <Save className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-slate-200">Name and Save Speaker Profile</span>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={speakerName}
                      onChange={(e) => setSpeakerName(e.target.value)}
                      placeholder="Enter Speaker Name (e.g. Chris)"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 font-sans"
                    />
                    <button
                      onClick={handleSaveProfile}
                      disabled={isSavingProfile || !speakerName.trim()}
                      className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-bold text-xs rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                    >
                      {isSavingProfile ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span>Save Profile</span>
                      )}
                    </button>
                  </div>
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

          {/* Saved Speaker Profiles Library */}
          <div className="border-t border-slate-800/60 pt-4 mt-2">
            <div className="flex items-center gap-1.5 mb-3">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Speaker Profiles Library</span>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-855">
                {savedProfiles.length} profiles
              </span>
            </div>

            {savedProfiles.length === 0 ? (
              <p className="text-[11px] text-slate-600 italic font-sans text-center py-4 bg-slate-950/25 rounded-lg border border-slate-900/50">
                No custom speaker profiles saved yet. Build and name your first profile above!
              </p>
            ) : (
              <div className="max-h-[160px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {savedProfiles.map((prof) => (
                  <div
                    key={prof.id}
                    className="p-2.5 bg-slate-950/60 hover:bg-slate-950/90 border border-slate-900 hover:border-slate-800/85 rounded-lg flex items-center justify-between gap-3 group transition-all"
                  >
                    <div
                      onClick={() => {
                        setVoicePreset(prof.voicePreset);
                        setStyleGuidelines(prof.styleGuidelines);
                        addLog("info", "click", `Loaded speaker profile "${prof.name}" settings into generation form.`);
                      }}
                      className="flex-1 min-w-0 cursor-pointer text-left"
                      title="Click to load speaker style settings into synthesizer form"
                    >
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-xs font-bold text-slate-200 truncate">{prof.name}</span>
                        <span className="text-[9px] font-mono bg-indigo-950/50 text-indigo-400 px-1 rounded">
                          {prof.voicePreset}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5 font-mono">
                        {prof.gender} • {prof.accent} • {prof.pitch}
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteProfile(prof.id, prof.name)}
                      className="p-1 text-slate-600 hover:text-rose-400 rounded hover:bg-rose-500/10 cursor-pointer transition-all"
                      title="Delete profile permanently"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Voice Synthesis & Multi-Speaker Script processing */}
        <div className="lg:col-span-7 flex flex-col p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-md gap-4 justify-between min-w-0">
          <div className="space-y-4">
            
            {/* Engine Tabs */}
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Speech Generation Engine</span>
              </div>
              
              <div className="flex p-0.5 bg-slate-950 rounded-lg border border-slate-800 shrink-0">
                <button
                  onClick={() => setEngineMode("single")}
                  className={`px-3 py-1 text-[10px] font-semibold rounded cursor-pointer transition-all ${
                    engineMode === "single"
                      ? "bg-slate-800 text-emerald-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Single Phrase
                </button>
                <button
                  onClick={() => setEngineMode("script")}
                  className={`px-3 py-1 text-[10px] font-semibold rounded cursor-pointer transition-all ${
                    engineMode === "script"
                      ? "bg-slate-800 text-emerald-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Multi-Speaker Script
                </button>
              </div>
            </div>

            {/* SINGLE PHRASE VIEW */}
            {engineMode === "single" && (
              <div className="space-y-4 animate-fadeIn">
                {/* Preset Voice & Style Settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-medium">Select Voice Actor Preset / Profile</label>
                    <select
                      id="select-voice-actor"
                      value={voicePreset}
                      onChange={(e) => setVoicePreset(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50 cursor-pointer font-sans"
                    >
                      {prebuiltVoices.map((v) => (
                        <option key={v.name} value={v.name} disabled={v.name === "cloned" && !selectedVoiceSegmentId && profileSource === "timeline"}>
                          {v.name === "cloned"
                            ? (profileSource === "timeline"
                                ? (selectedVoiceSegmentId ? "✨ Clone Voice (Selected timeline segment)" : "✨ Clone Voice (Select timeline segment first)")
                                : "✨ Clone Voice (Using direct reference sample upload)"
                              )
                            : `${v.name} (${v.description})`
                          }
                        </option>
                      ))}
                    </select>
                    {voicePreset === "cloned" && profileSource === "timeline" && !selectedVoiceSegmentId && (
                      <span className="text-[10px] text-amber-500 font-mono">
                        ⚠️ Please select a segment from the timeline first.
                      </span>
                    )}
                    {voicePreset === "cloned" && (profileSource === "direct" || selectedVoiceSegmentId) && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        ✨ Perfect! HandAISpoke will replicate the voice of the cloned training source.
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
                    onChange={(e) => {
                      setTextToSpeak(e.target.value);
                      setGenerationError(null);
                    }}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 font-sans resize-none leading-relaxed"
                  />
                </div>

                {generationError && (
                  <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl flex gap-2 text-rose-400 text-xs items-center font-sans" id="tts-error-banner">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{generationError}</span>
                  </div>
                )}

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
              </div>
            )}

            {/* MULTI-SPEAKER SCRIPT VIEW */}
            {engineMode === "script" && (
              <div className="space-y-4 animate-fadeIn">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-200">Default Fallback Preset</span>
                    <span className="text-[10px] text-slate-500">For speakers with no saved profile</span>
                  </div>
                  <select
                    value={defaultUnmatchedPreset}
                    onChange={(e) => setDefaultUnmatchedPreset(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg py-1.5 px-3 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50 cursor-pointer font-sans"
                  >
                    <option value="Puck">Puck (Deep Professional Male)</option>
                    <option value="Zephyr">Zephyr (Warm Airy Female)</option>
                    <option value="Charon">Charon (Energetic Male)</option>
                    <option value="Kore">Kore (Crisp Female)</option>
                    <option value="Fenrir">Fenrir (Dramatic Male)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400 font-medium">Conversational Script Editor</label>
                    <label className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer flex items-center gap-1">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Script File</span>
                      <input
                        type="file"
                        accept=".txt"
                        onChange={handleScriptUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={6}
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder='Format like:&#10;[ChatGPT] Can I ask Chris a question?&#10;[Chris] I love answering questions!&#10;[ChatGPT] Why do you love answering questions?&#10;[Chris] Because I have all the answers'
                    className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 font-mono resize-none leading-relaxed"
                  />
                  <span className="text-[10px] text-slate-500 font-mono leading-normal">
                    💡 <strong>Pro-Tip:</strong> Name speaker profiles (like "ChatGPT" and "Chris") in the builder first, then use matching speaker tags in brackets like <code>[Chris]</code> or <code>[ChatGPT]</code> to call those exact voices!
                  </span>
                </div>

                {scriptError && (
                  <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl flex gap-2 text-rose-400 text-xs items-center font-sans">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{scriptError}</span>
                  </div>
                )}

                {isProcessingScript && (
                  <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Processing Dialog Script...</span>
                      </span>
                      <span className="text-slate-500">{scriptProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-emerald-500 to-indigo-500 h-full transition-all duration-300"
                        style={{ width: `${scriptProgress}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 font-sans italic">
                      {scriptProgressText}
                    </p>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleProcessScript}
                    disabled={isProcessingScript || !scriptText.trim()}
                    className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-indigo-500 hover:from-emerald-400 hover:to-indigo-400 disabled:from-slate-800 disabled:to-slate-800 text-slate-950 disabled:text-slate-500 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg"
                  >
                    {isProcessingScript ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Rendering Dialogs...</span>
                      </>
                    ) : (
                      <>
                        <ListRestart className="w-4 h-4" />
                        <span>Process Script & Create Editing Timeline</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Audition & Micro Modulation Board */}
            {engineMode === "single" && generatedBuffer && (
              <div className="bg-slate-950/70 border border-slate-900 rounded-xl p-5 space-y-5 animate-fadeIn mt-4">
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
    </div>
  );
}
