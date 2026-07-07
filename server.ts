import express from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// SERVER LOGS STORAGE
interface ServerLog {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  category: "api" | "server";
  message: string;
  details?: string;
}

const serverLogsList: ServerLog[] = [];

export function logToServer(level: "info" | "warn" | "error" | "success", category: "api" | "server", message: string, details?: any) {
  const logEntry: ServerLog = {
    id: `srv-${Math.random().toString(36).substring(2, 11)}`,
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details: details ? (typeof details === "object" ? JSON.stringify(details, null, 2) : String(details)) : undefined
  };
  serverLogsList.push(logEntry);
  if (serverLogsList.length > 500) {
    serverLogsList.shift();
  }
  const emoji = level === "success" ? "✅" : level === "warn" ? "⚠️" : level === "error" ? "❌" : "ℹ️";
  console.log(`${emoji} [${category.toUpperCase()}] ${message}`);
}

// Log startup action
logToServer("info", "server", "Vocal Match & Podcast Studio Server initialized");

// Body parsing with large limits for audio data base64 uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy init/helper for Gemini AI SDK
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === "MY_GEMINI_API_KEY") {
      throw new Error("GEMINI_API_KEY environment variable is not configured. Please add your Gemini API Key in the Secrets panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Retry helper for API calls to handle transient/high-demand errors
async function callGeminiWithRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      // Detect transient errors (503 Service Unavailable, 429 Rate Limit, or high demand messages)
      const errorMsg = error.message || "";
      const isTransient = error.status === 503 || 
                          error.status === 429 ||
                          errorMsg.includes("503") ||
                          errorMsg.includes("429") ||
                          errorMsg.toLowerCase().includes("high demand") ||
                          errorMsg.toLowerCase().includes("unavailable") ||
                          errorMsg.toLowerCase().includes("temporary") ||
                          errorMsg.toLowerCase().includes("spikes in demand");
      
      if (isTransient && attempt <= retries) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        console.warn(`Gemini API transient error (attempt ${attempt}/${retries}). Retrying in ${backoff}ms... Error: ${errorMsg}`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
}

// Helper to try a preferred model first, with automatic fallback to other models if we hit a 429 quota or resource exhausted limit
async function generateContentWithFallback(ai: GoogleGenAI, baseOptions: any, fallbackModels: string[] = ["gemini-3.1-flash-lite", "gemini-flash-latest"]): Promise<any> {
  const models = [baseOptions.model || "gemini-3.5-flash", ...fallbackModels];
  let lastError: any = null;

  for (const model of models) {
    try {
      console.log(`Attempting Gemini API call with model: ${model}`);
      const options = { ...baseOptions, model };
      const response = await callGeminiWithRetry(() => ai.models.generateContent(options));
      return response;
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || "";
      const isQuotaLimit = error.status === 429 ||
                           errorMsg.includes("429") ||
                           errorMsg.toLowerCase().includes("quota") ||
                           errorMsg.toLowerCase().includes("rate limit") ||
                           errorMsg.toLowerCase().includes("resource_exhausted") ||
                           errorMsg.toLowerCase().includes("exhausted");
      
      if (isQuotaLimit) {
        console.warn(`Model ${model} returned a quota limit error. Retrying with next available fallback model...`);
        continue;
      }
      // If it's a different kind of error, throw it immediately rather than masking it
      throw error;
    }
  }
  throw lastError;
}

// Helper to call custom local voice-cloning TTS server
async function callLocalTTS(
  url: string,
  token: string,
  textToSpeak: string,
  referenceAudioBase64: string | undefined,
  mimeType: string | undefined,
  styleGuidelines: string | undefined
): Promise<{ audio: string; mimeType: string }> {
  logToServer("info", "api", `Calling local custom voice cloning API at ${url}...`);

  // Strip Data URI scheme prefix (e.g., "data:audio/wav;base64,") if present
  let cleanAudioBase64 = referenceAudioBase64 || "";
  if (cleanAudioBase64.startsWith("data:")) {
    const commaIndex = cleanAudioBase64.indexOf(",");
    if (commaIndex !== -1) {
      cleanAudioBase64 = cleanAudioBase64.slice(commaIndex + 1);
    }
  }

  // Exact body required by the bridge
  const body = {
    text: textToSpeak,
    reference_audio_base64: cleanAudioBase64,
    reference_mime_type: mimeType || "audio/wav",
    engine: "chatterbox"
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-HandAISpoke-Bridge-Token": token,
    "Authorization": `Bearer ${token}` // keeping standard auth header as fallback
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Local TTS endpoint returned status ${response.status}: ${errText.slice(0, 200)}`);
  }

  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("application/json")) {
    const json = await response.json();
    // Support common response structures (e.g. { audio: "...", ... })
    const audioData = json.audio || json.data || json.audio_base64;
    if (!audioData) {
      throw new Error(`JSON response from local TTS missing audio data. Received keys: ${Object.keys(json).join(", ")}`);
    }
    return {
      audio: audioData,
      mimeType: json.mimeType || json.contentType || "audio/wav"
    };
  } else {
    // Binary stream!
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return {
      audio: base64,
      mimeType: contentType || "audio/wav"
    };
  }
}

// API endpoint to analyze audio
app.post("/api/analyze-audio", async (req, res) => {
  try {
    const { audio, mimeType, script, chunkStart, chunkEnd } = req.body;
    if (!audio) {
      logToServer("warn", "api", "Analysis request rejected: Missing 'audio' data.");
      return res.status(400).json({ error: "Missing 'audio' data (base64 string required)." });
    }
    if (!mimeType) {
      logToServer("warn", "api", "Analysis request rejected: Missing 'mimeType'.");
      return res.status(400).json({ error: "Missing 'mimeType' (e.g., audio/mp3, audio/wav, audio/webm)." });
    }

    const ai = getAI();

    const audioSizeKb = Math.round(audio.length / 1024);
    const chunkInfo = chunkStart !== undefined ? `${chunkStart.toFixed(1)}s - ${chunkEnd.toFixed(1)}s` : "Full file";
    logToServer("info", "api", `Audio Analysis Started. MimeType: ${mimeType}, Size: ${audioSizeKb} KB, Script provided: ${!!script}, Interval: ${chunkInfo}`);

    let userInstruction = "";
    if (script && typeof script === "string" && script.trim()) {
      userInstruction = "You are an expert spoken word, voiceover, and podcast editing system.\n" +
        "The user has provided a vocal audio recording and a REFERENCE SCRIPT that the speaker is reading.\n" +
        "The speaker made several mistakes, stutters, or repeated lines, but they eventually read the entire script successfully.\n\n" +
        "Your job is to align the spoken audio to the reference script with absolute completeness and precision.\n\n" +
        "CRITICAL INSTRUCTIONS:\n" +
        "1. COMPLETE SCRIPT COVERAGE: You must produce keep segments covering EVERY SINGLE SENTENCE and CLAUSE in the provided Reference Script. Under no circumstances should you skip, truncate, or omit any sentence of the script that is spoken in the recording.\n" +
        "2. DO NOT SWEEP MESSY SECTIONS AWAY: If a certain section of the audio contains mistakes, stutters, or bad takes, you MUST NOT cut or discard the entire section! Instead, go through that messy section with extreme granularity. Identify the stutters, repetitions, and bad takes, discard ONLY those short sub-segments (usually 1 to 5 seconds each), and KEEP the successful takes for each sentence.\n" +
        "3. NEVER DISCARD PROGRESS: Every single sentence in the script has a final successful spoken version in the audio. You must find and keep that final successful version of every sentence. Do not delete long chunks of continuous speech unless they are direct repetitions of lines spoken later.\n" +
        "4. GRANULAR SEGMENTATION: Do not group multiple long paragraphs or sentences into a single massive segment. Break them down into sentence-level or phrase-level segments (typically 3 to 15 seconds long). This ensures alignment precision and prevents audio skipping.\n" +
        "5. TRANSCRIPTS: The transcript for each kept segment should be the clean, correct words from the script that are spoken in that segment.\n" +
        "6. CHRONOLOGICAL TIMELINE: Return the segments in strict chronological order. Timestamps (in seconds) must be highly accurate and not overlap.\n\n" +
        "REFERENCE SCRIPT:\n" +
        `"${script.trim()}"\n\n`;

      if (typeof chunkStart === "number" && typeof chunkEnd === "number") {
        userInstruction += `\nCHUNK CONTEXT:\n` +
          `- You are analyzing a specific, pre-sliced CHUNK of the audio from global timestamp ${chunkStart.toFixed(2)}s to ${chunkEnd.toFixed(2)}s.\n` +
          `- The audio file provided starts exactly at 0.0s (which corresponds to global time ${chunkStart.toFixed(2)}s) and has a duration of ${(chunkEnd - chunkStart).toFixed(2)}s.\n` +
          `- You MUST return the start and end timestamps relative to the start of this chunk (0.0s represents the beginning of this clip, NOT the global time. Values must be between 0.0 and ${(chunkEnd - chunkStart).toFixed(2)}).\n` +
          `- Find the sentences in the Reference Script that are spoken in this specific ${(chunkEnd - chunkStart).toFixed(1)}s slice, keep only the successful takes, and list them in 'keeps'.`;
      } else {
        userInstruction += "Make sure to scan the entire duration of the audio, and ensure that segments in the middle of the audio (including the 50s to 110s range) are thoroughly mapped to their corresponding sentences in the script.";
      }
    } else {
      userInstruction = "You are an expert spoken word, interview, and podcast production assistant. " +
        "Analyze this recording. It may contain a single speaker reading a text, or a dialogue/interview where an interviewer (such as a female or male voice) asks a question, followed by the speaker's performance or answer. " +
        "The speaker frequently makes mistakes and repeats lines (going back to repeat the correct version of a sentence or phrase). " +
        "Your goal is to perform intelligent 'edit-on-word' detection. Find all the intervals of time that should be kept in the final, clean stitched master. " +
        "Specifically, you MUST: " +
        "1. PRESERVE all interviewer questions, introductions, or comments by other speakers in full. Never cut them out. " +
        "2. For the main speaker's lines or answers: identify and filter out all repeated lines, stuttered starts, and speech errors, KEEPING only the final, complete, correct version of each take. " +
        "3. Keep the intervals of silence or natural pauses between distinct questions or thoughts reasonable, but clean out excessive dead air. " +
        "For each segment to keep, identify its exact start time, end time, and a short transcript of what is spoken. " +
        "Return the keep segments in order as a structured JSON object.";
    }

    const response = await generateContentWithFallback(ai, {
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: audio,
          },
        },
        userInstruction
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            keeps: {
              type: "ARRAY",
              description: "Ordered list of time ranges of the final successful takes that should be kept, with duplicates, mistakes, and bad takes removed.",
              items: {
                type: "OBJECT",
                properties: {
                  start: { type: "NUMBER", description: "Start time of this clean take in seconds (can be decimal)" },
                  end: { type: "NUMBER", description: "End time of this clean take in seconds (can be decimal)" },
                  transcript: { type: "STRING", description: "Accurate transcript of the words spoken in this segment" }
                },
                required: ["start", "end", "transcript"]
              }
            }
          },
          required: ["keeps"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No output text received from Gemini API.");
    }

    const parsed = JSON.parse(text);
    const count = parsed.keeps?.length || 0;
    logToServer("success", "api", `Audio Analysis Successful. Found ${count} non-destructive keep segments to stitch.`);
    return res.json(parsed);

  } catch (error: any) {
    logToServer("error", "api", `Audio Analysis Failed: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during audio analysis."
    });
  }
});

// API endpoint to generate vocal speech patch
app.post("/api/generate-patch", async (req, res) => {
  try {
    const { referenceAudio, mimeType, textToSpeak, voicePreset, styleGuidelines } = req.body;
    if (!textToSpeak) {
      logToServer("warn", "api", "Vocal patch generation rejected: Missing 'textToSpeak' input.");
      return res.status(400).json({ error: "Missing 'textToSpeak' input string." });
    }

    logToServer("info", "api", `Vocal Patch Generation Started. Voice preset: ${voicePreset || "Puck"}, text: "${textToSpeak.slice(0, 60)}${textToSpeak.length > 60 ? "..." : ""}" (${textToSpeak.length} chars). Has Style Guidelines: ${!!styleGuidelines}`);

    // Check if we should route to a custom local voice-cloning TTS service
    const localTtsUrl = process.env.LOCAL_TTS_URL;
    const localTtsToken = process.env.LOCAL_TTS_TOKEN;
    const isClonedRequest = voicePreset === "cloned" || (referenceAudio && mimeType);

    if (isClonedRequest && localTtsUrl) {
      logToServer("info", "api", `Local custom cloning endpoint detected: ${localTtsUrl}. Directing request...`);
      try {
        const result = await callLocalTTS(
          localTtsUrl,
          localTtsToken || "",
          textToSpeak,
          referenceAudio,
          mimeType,
          styleGuidelines
        );
        logToServer("success", "api", `Successfully generated voice patch using local custom cloning model. Format: ${result.mimeType}`);
        return res.json({
          audio: result.audio,
          mimeType: result.mimeType
        });
      } catch (localErr: any) {
        logToServer("error", "api", `Local Voice Cloning failed: ${localErr.message}. No fallback configured.`);
        return res.status(502).json({
          error: `Local custom voice-cloning service failed: ${localErr.message}`,
          details: localErr.stack || ""
        });
      }
    }

    const ai = getAI();
    let extractedGuidelines = "";
    let baseVoicePreset = "Puck";

    // If we have reference audio (for voice cloning), analyze it on-the-fly with gemini-3.5-flash
    // to find the closest prebuilt voice preset and vocal parameters
    if (referenceAudio && mimeType) {
      try {
        logToServer("info", "api", "Analyzing reference audio on-the-fly to extract voice characteristics...");
        const userInstruction = "You are an expert voice scientist, speech dialect coach, and auditory phonetician.\n" +
          "Analyze the vocal characteristics of the speaker in this audio recording.\n" +
          "Extract details such as their perceived gender, pitch level, speaking rate, accent/dialect, and overall emotional tone or vibe.\n" +
          "Based on these characteristics, select the best matching prebuilt voice preset from the following options:\n" +
          "- 'Puck': Deep, warm, professional male narrator.\n" +
          "- 'Charon': Mid-range, energetic, clear male voice.\n" +
          "- 'Fenrir': Intense, slightly raspy, dramatic male voice.\n" +
          "- 'Kore': Clear, high-pitched, crisp female voice.\n" +
          "- 'Zephyr': Warm, smooth, airy female narrator.\n\n" +
          "Return your analysis as a structured JSON object.";

        const analysisResponse = await generateContentWithFallback(ai, {
          model: "gemini-3.5-flash",
          contents: [
            {
              inlineData: {
                mimeType: mimeType,
                data: referenceAudio,
              },
            },
            userInstruction
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                gender: { type: "STRING" },
                pitch: { type: "STRING" },
                speed: { type: "STRING" },
                accent: { type: "STRING" },
                vibe: { type: "STRING" },
                suggestedPreset: { type: "STRING" },
                explanation: { type: "STRING" }
              },
              required: ["gender", "pitch", "speed", "accent", "vibe", "suggestedPreset", "explanation"]
            }
          }
        });

        const parsedAnalysis = JSON.parse(analysisResponse.text);
        baseVoicePreset = parsedAnalysis.suggestedPreset || "Puck";
        extractedGuidelines = `target speaker is ${parsedAnalysis.gender}, with a ${parsedAnalysis.pitch} pitch level, a ${parsedAnalysis.speed} speaking pacing, and a ${parsedAnalysis.accent} accent. Overall tone/vibe to emulate: ${parsedAnalysis.vibe}.`;
        logToServer("success", "api", `On-the-fly voice analysis successful. Closest base voice preset: ${baseVoicePreset}`);
      } catch (err: any) {
        logToServer("warn", "api", `On-the-fly voice analysis failed: ${err.message}. Defaulting to Puck.`);
        baseVoicePreset = "Puck";
      }
    }

    // Now build the prompt for gemini-3.1-flash-tts-preview
    let promptText = `You are a professional voice actor, speech synthesizer, and voice matching engine.
We are patching a podcast or spoken word recording.
Your task is to speak the following text clearly, naturally, and with excellent vocal cadence:
"${textToSpeak}"

Guidelines:
1. Maintain a completely natural, human cadence (avoid sounding robotic or monotonous).
2. Do NOT add any introductory remarks, coughs, ambient sighs, "here is your audio", or explanation. Output ONLY the clean spoken words.`;

    if (extractedGuidelines) {
      promptText += `\n3. EMULATE VOICE STYLE CHARACTERISTICS: ${extractedGuidelines}`;
    }

    if (styleGuidelines && typeof styleGuidelines === "string" && styleGuidelines.trim()) {
      promptText += `\n4. ADDITIONAL VOCAL STYLE TO EMULATE: ${styleGuidelines.trim()}`;
    }

    const contents = [{ parts: [{ text: promptText }] }];

    const config: any = {
      responseModalities: ["AUDIO"]
    };

    // Determine target voice name for the prebuilt speech Config
    let finalVoicePreset = "Puck";
    if (voicePreset && voicePreset !== "cloned") {
      finalVoicePreset = voicePreset;
    } else {
      // If "cloned", use the preset dynamically selected from the voice profile / on-the-fly analysis
      finalVoicePreset = baseVoicePreset;
    }

    config.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: finalVoicePreset
        }
      }
    };

    const modelToUse = "gemini-3.1-flash-tts-preview";
    logToServer("info", "api", `Selected generation model: ${modelToUse} (Preset voice config: ${finalVoicePreset})`);

    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: modelToUse,
      contents: contents,
      config: config
    }));

    const candidates = response.candidates;
    const part = candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("audio/"));

    if (!part || !part.inlineData || !part.inlineData.data) {
      throw new Error("No audio bytes returned from Gemini API. Ensure the selected model and voice support speech generation.");
    }

    const sizeKb = Math.round(part.inlineData.data.length / 1024);
    logToServer("success", "api", `Vocal Patch Generation Successful. Generated audio format: ${part.inlineData.mimeType}, size: ${sizeKb} KB.`);
    return res.json({
      audio: part.inlineData.data,
      mimeType: part.inlineData.mimeType
    });

  } catch (error: any) {
    logToServer("error", "api", `Vocal Patch Generation Failed: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during speech patch generation."
    });
  }
});

// API endpoint to analyze vocal style from reference audio
app.post("/api/analyze-voice", async (req, res) => {
  try {
    const { audio, mimeType } = req.body;
    if (!audio) {
      logToServer("warn", "api", "Voice analysis rejected: Missing 'audio' data.");
      return res.status(400).json({ error: "Missing 'audio' data (base64 string required)." });
    }
    if (!mimeType) {
      logToServer("warn", "api", "Voice analysis rejected: Missing 'mimeType'.");
      return res.status(400).json({ error: "Missing 'mimeType'." });
    }

    const ai = getAI();
    const sizeKb = Math.round(audio.length / 1024);
    logToServer("info", "api", `Voice analysis requested. MimeType: ${mimeType}, Size: ${sizeKb} KB.`);

    const userInstruction = "You are an expert voice scientist, speech dialect coach, and auditory phonetician.\n" +
      "Analyze the vocal characteristics of the speaker in this audio recording.\n" +
      "Extract details such as their perceived gender, pitch level, speaking rate, accent/dialect, and overall emotional tone or vibe.\n" +
      "Based on these characteristics, select the best matching prebuilt voice preset from the following options:\n" +
      "- 'Puck': Deep, warm, professional male narrator.\n" +
      "- 'Charon': Mid-range, energetic, clear male voice.\n" +
      "- 'Fenrir': Intense, slightly raspy, dramatic male voice.\n" +
      "- 'Kore': Clear, high-pitched, crisp female voice.\n" +
      "- 'Zephyr': Warm, smooth, airy female narrator.\n\n" +
      "Return your analysis as a structured JSON object.";

    const response = await generateContentWithFallback(ai, {
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: audio,
          },
        },
        userInstruction
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            gender: { type: "STRING", description: "Perceived gender or voice type (e.g. Female, Male, Non-binary, Warm Neutral)" },
            pitch: { type: "STRING", description: "Vocal pitch classification (e.g. Low, Medium-Low, Medium, Medium-High, High)" },
            speed: { type: "STRING", description: "Speaking speed and pacing (e.g. Slow, Normal, Fast, Measured)" },
            accent: { type: "STRING", description: "Detected accent or regional dialect (e.g. General American, Southern British, French accented, Neutral English)" },
            vibe: { type: "STRING", description: "Overall vocal tone, mood, and delivery style (e.g. Professional and Warm, Crisp and Energetic, Gentle, Raspy and Dramatic)" },
            suggestedPreset: { 
              type: "STRING", 
              description: "The closest prebuilt voice name of the five available: Puck, Charon, Fenrir, Kore, or Zephyr" 
            },
            explanation: { type: "STRING", description: "A detailed 2-3 sentence analysis of the speaker's vocal profile and why the prebuilt preset was chosen as the closest match." }
          },
          required: ["gender", "pitch", "speed", "accent", "vibe", "suggestedPreset", "explanation"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No output text received from Gemini voice analyzer.");
    }

    const parsed = JSON.parse(text);
    logToServer("success", "api", `Voice analysis successful. Recommended preset: ${parsed.suggestedPreset}.`);
    return res.json(parsed);

  } catch (error: any) {
    logToServer("error", "api", `Voice analysis failed: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during vocal profile analysis."
    });
  }
});

// API endpoint to analyze audio volume levels and provide professional mastering recommendation
app.post("/api/analyze-volume", async (req, res) => {
  try {
    const { peakDb, rmsDb, durationSec, filename } = req.body;
    
    if (typeof peakDb !== "number" || typeof rmsDb !== "number") {
      logToServer("warn", "api", "Volume analysis rejected: Invalid amplitude metrics.");
      return res.status(400).json({ error: "Missing or invalid volume stats 'peakDb' and 'rmsDb'." });
    }

    const ai = getAI();
    logToServer("info", "api", `Volume analysis requested. Peak: ${peakDb.toFixed(1)}dB, RMS: ${rmsDb.toFixed(1)}dB, Duration: ${durationSec?.toFixed(1) || 0}s`);

    const userInstruction = `You are an expert audio mastering engineer and restoration professional.
The user has uploaded a spoken-word audio file: "${filename || "SpokenWordTrack.wav"}" (Duration: ${durationSec ? durationSec.toFixed(1) : "unknown"}s).
Here are the calculated audio level characteristics:
- Peak Level: ${peakDb.toFixed(2)} dBFS
- RMS Level (Average Amplitude): ${rmsDb.toFixed(2)} dBFS
- Crest Factor / Dynamic Range: ${(peakDb - rmsDb).toFixed(2)} dB

Analyze these values for a professional spoken-word podcast or voiceover track.
- Standard podcasts target an integrated loudness of around -16 LUFS (which roughly correlates to -18dB to -15dB RMS for speech) and a peak level of -1.0 to -2.0 dBFS.
- If the peak is far below -1.0 dBFS, the track is too quiet.
- If the dynamic range (crest factor) is very high (e.g., > 15 dB), there might be loud spikes or very quiet whispers, meaning a Limiter is highly recommended to compress peaks and raise the overall level.
- If the crest factor is modest (e.g., 6 to 12 dB) and overall volume is low, a simple Peak Normalization is the cleanest approach.

Write a highly engaging, professional, educational diagnostic report on these volume levels. Explain precisely why you recommend the chosen approach.
Select the recommended mode ("normalization" or "limiter") and recommend target settings:
- targetDb (for normalization): e.g. -1.0 dBFS
- inputGainDb (for limiter): e.g. if the audio is quiet, we can apply input gain (e.g. 3 to 12 dB) before limiting
- limitThresholdDb (for limiter): e.g. -3.0 dBFS or -1.5 dBFS
- releaseMs (for limiter): standard speech release, e.g. 100 to 200 ms

Return your analysis and recommendations as a structured JSON object.`;

    const response = await generateContentWithFallback(ai, {
      model: "gemini-3.5-flash",
      contents: [userInstruction],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            analysis: { 
              type: "STRING", 
              description: "A detailed 3-4 sentence professional diagnostic report of the dynamic range, crest factor, and overall level, followed by an explanation of the recommended normalization/limitation strategy." 
            },
            recommendedMode: { 
              type: "STRING", 
              enum: ["normalization", "limiter"],
              description: "The recommended processing tool based on the dynamic profile: 'normalization' (peak scaling) or 'limiter' (dynamic range reduction)." 
            },
            targetDb: { 
              type: "NUMBER", 
              description: "The recommended target peak level in dBFS for normalization (usually between -3.0 and -0.5, e.g., -1.0)." 
            },
            inputGainDb: { 
              type: "NUMBER", 
              description: "The recommended input boost gain in dB for the limiter, if needed to raise the overall body of the audio (usually 0.0 to 12.0)." 
            },
            limitThresholdDb: { 
              type: "NUMBER", 
              description: "The recommended ceiling/threshold in dBFS for the limiter (usually -3.0 to -1.0)." 
            },
            releaseMs: { 
              type: "NUMBER", 
              description: "The recommended release time in milliseconds for the limiter (usually 80 to 250)." 
            }
          },
          required: ["analysis", "recommendedMode", "targetDb", "inputGainDb", "limitThresholdDb", "releaseMs"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No output text received from Gemini volume analyzer.");
    }

    const parsed = JSON.parse(text);
    logToServer("success", "api", `Volume analysis successful. Recommended mode: ${parsed.recommendedMode}.`);
    return res.json(parsed);

  } catch (error: any) {
    logToServer("error", "api", `Volume analysis failed: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during audio volume analysis."
    });
  }
});

// API endpoint to analyze background noise characteristics and tune DSP settings via Gemini AI
app.post("/api/analyze-noise", async (req, res) => {
  try {
    const { peakDb, rmsDb, durationSec, filename, envelope } = req.body;

    if (typeof peakDb !== "number" || typeof rmsDb !== "number") {
      logToServer("warn", "api", "Noise analysis rejected: Invalid amplitude metrics.");
      return res.status(400).json({ error: "Missing or invalid volume stats 'peakDb' and 'rmsDb'." });
    }

    const ai = getAI();
    logToServer("info", "api", `Noise analysis requested via Gemini. Peak: ${peakDb.toFixed(1)}dB, RMS: ${rmsDb.toFixed(1)}dB, Duration: ${durationSec?.toFixed(1) || 0}s`);

    const userInstruction = `You are an expert audio restoration engineer.
The user has uploaded a spoken-word track: "${filename || "SpokenWordTrack.wav"}" (Duration: ${durationSec ? durationSec.toFixed(1) : "unknown"}s).
Here are the dynamic level characteristics:
- Peak Level: ${peakDb.toFixed(2)} dBFS
- RMS Level: ${rmsDb.toFixed(2)} dBFS
- Envelope values across 50 steps: [${envelope ? envelope.join(", ") : ""}]

Analyze this dynamic data to detect background noise levels, ambient room hums, and pauses.
Suggest:
1. Recommended Noise Gate Threshold (dBFS) to silence pure silence zones (must be below the general spoken RMS level but above the lowest background envelope level, usually between -55 and -35 dBFS).
2. Recommended Spectral Reduction dB (usually between 6 and 18 dB).
3. Recommended Gate Attenuation/Reduction dB (usually between -80 and -40 dB).
4. Provide a professional loudness/noise diagnosis describing the acoustic profile and presence of background room noise or hiss.

Return your analysis and recommendations as a structured JSON object.`;

    const response = await generateContentWithFallback(ai, {
      model: "gemini-3.5-flash",
      contents: [userInstruction],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            loudnessDiagnosis: {
              type: "STRING",
              description: "A detailed 2-3 sentence acoustic diagnosis of background hiss, noise profile, room hum, and recommended attenuation strategy."
            },
            recommendedGateThresholdDb: {
              type: "NUMBER",
              description: "The recommended threshold level in dBFS for the noise gate (e.g., -45)."
            },
            recommendedGateReductionDb: {
              type: "NUMBER",
              description: "The recommended attenuation when gate is closed in dB (e.g., -60)."
            },
            recommendedSpectralReductionDb: {
              type: "NUMBER",
              description: "The recommended spectral subtraction reduction level in dB (usually 10 to 18)."
            },
            recommendedSensitivity: {
              type: "NUMBER",
              description: "The recommended subtraction sensitivity multiplier (usually 0.8 to 1.5)."
            }
          },
          required: ["loudnessDiagnosis", "recommendedGateThresholdDb", "recommendedGateReductionDb", "recommendedSpectralReductionDb", "recommendedSensitivity"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No output text received from Gemini noise analyzer.");
    }

    const parsed = JSON.parse(text);
    logToServer("success", "api", `AI Noise signature modeling successful. Suggested gate threshold: ${parsed.recommendedGateThresholdDb} dBFS.`);
    return res.json(parsed);

  } catch (error: any) {
    logToServer("error", "api", `Noise analysis failed: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during audio noise analysis."
    });
  }
});

// API endpoint to parse descriptive natural language editing instructions using Gemini AI
app.post("/api/descriptive-edit", async (req, res) => {
  try {
    const { prompt, startSec, endSec, durationSec, totalDuration } = req.body;

    if (!prompt) {
      logToServer("warn", "api", "Descriptive edit rejected: Missing prompt parameter.");
      return res.status(400).json({ error: "Missing required 'prompt' parameter." });
    }

    const ai = getAI();
    logToServer("info", "api", `Descriptive edit requested: "${prompt}" on range [${startSec?.toFixed(1) || 0}s - ${endSec?.toFixed(1) || 0}s]`);

    const userInstruction = `You are an expert audio DSP co-producer and editing system.
The user wants to edit their voice/audio recording using a natural language command.
User command: "${prompt}"
Current selected range: ${startSec !== undefined ? startSec.toFixed(2) : "0.00"}s to ${endSec !== undefined ? endSec.toFixed(2) : "0.00"}s (Duration: ${durationSec !== undefined ? durationSec.toFixed(2) : "0.00"}s)
Total track duration: ${totalDuration !== undefined ? totalDuration.toFixed(2) : "0.00"}s

Your job is to determine the most appropriate DSP (Digital Signal Processing) operation to perform on the selected range.
Supported operations:
1. "volume": Adjust volume/gain of the selection. Requires parameter "gain" (number multiplier: e.g., 0.5 to reduce volume by half or -6dB, 2.0 to double volume or +6dB, 0.1 for very quiet, 1.5 for a boost).
2. "mute": Silence the audio selection completely (sets gain to 0.0). No extra parameters.
3. "fade-in": Smooth linear fade-in over the start of the selection. Requires parameter "duration" (number of seconds, e.g. 1.0, must not exceed the selection duration).
4. "fade-out": Smooth linear fade-out over the end of the selection. Requires parameter "duration" (number of seconds, e.g. 1.0, must not exceed the selection duration).
5. "reverse": Play the selected audio backwards. No extra parameters.
6. "muffle": Low-pass filter effect to make it sound muffled or underwater. No extra parameters.
7. "telephone": Band-pass filter effect to sound like a low-fidelity old telephone. No extra parameters.
8. "pitch": Pitch shifting of the selection. Requires parameter "factor" (number: e.g. 1.5 to make it sound like a high-pitched chipmunk, 0.7 to make it sound like a deep slow robot).

Acknowledge the user's intent politely, describe what changes you are applying, and output the structured operation.
If the command doesn't match any supported operation, default to "volume" with gain 1.0 and state that it is not supported but you'll play it back.

Return your response as a structured JSON object.`;

    const response = await generateContentWithFallback(ai, {
      model: "gemini-3.5-flash",
      contents: [userInstruction],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            explanation: {
              type: "STRING",
              description: "A friendly, expert description of what you are doing in response to the user's command (e.g., 'Applying a phone filter effect to the selected 2-second range to make it sound retro.')."
            },
            operation: {
              type: "STRING",
              enum: ["volume", "mute", "fade-in", "fade-out", "reverse", "muffle", "telephone", "pitch"],
              description: "The core DSP operation to invoke."
            },
            gain: {
              type: "NUMBER",
              description: "For 'volume' operation: multiplier for amplitude. Standard is 1.0."
            },
            duration: {
              type: "NUMBER",
              description: "For 'fade-in' or 'fade-out': length of the fade in seconds."
            },
            factor: {
              type: "NUMBER",
              description: "For 'pitch': pitch multiplier (0.5 to 2.0)."
            }
          },
          required: ["explanation", "operation"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No output received from Gemini descriptive editor model.");
    }

    const parsed = JSON.parse(text);
    logToServer("success", "api", `AI parsed descriptive command to operation: ${parsed.operation}`);
    return res.json(parsed);

  } catch (error: any) {
    logToServer("error", "api", `Descriptive edit failed: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during audio descriptive editing."
    });
  }
});

// Server-side safe storage of WordPress connection settings
const WP_CONFIG_PATH = path.join(process.cwd(), "wp-config-store.json");

interface WordPressConfig {
  wpUrl: string;
  username: string;
  appPassword: string;
}

function getWordPressConfig(): WordPressConfig {
  // First, check process environment for standard parameters
  if (process.env.WP_URL && process.env.WP_USERNAME && process.env.WP_APP_PASSWORD) {
    return {
      wpUrl: process.env.WP_URL.trim(),
      username: process.env.WP_USERNAME.trim(),
      appPassword: process.env.WP_APP_PASSWORD.trim(),
    };
  }

  // Next, try server-side file store
  try {
    if (fs.existsSync(WP_CONFIG_PATH)) {
      const fileData = fs.readFileSync(WP_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(fileData);
      return {
        wpUrl: parsed.wpUrl || "",
        username: parsed.username || "",
        appPassword: parsed.appPassword || ""
      };
    }
  } catch (err: any) {
    logToServer("warn", "server", `Could not read WordPress config file: ${err.message}`);
  }

  return { wpUrl: "", username: "", appPassword: "" };
}

function saveWordPressConfig(config: WordPressConfig) {
  try {
    fs.writeFileSync(WP_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    logToServer("success", "server", "Saved WordPress site credentials to secure server store.");
  } catch (err: any) {
    logToServer("error", "server", `Failed to persist WordPress config server-side: ${err.message}`);
    throw err;
  }
}

// 1. GET Settings endpoint: Hides/masks the actual application password from browser
app.get("/api/wordpress/settings", (req, res) => {
  try {
    const config = getWordPressConfig();
    return res.json({
      wpUrl: config.wpUrl,
      username: config.username,
      hasAppPassword: config.appPassword.length > 0
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to fetch settings: ${err.message}` });
  }
});

// 2. POST Settings endpoint: Persists credentials server-side
app.post("/api/wordpress/settings", (req, res) => {
  try {
    const { wpUrl, username, appPassword } = req.body;

    if (!wpUrl || !username) {
      return res.status(400).json({ error: "Missing required parameter wpUrl or username" });
    }

    const currentConfig = getWordPressConfig();
    let finalPassword = currentConfig.appPassword;

    // Only update the stored password if it's not empty and not the placeholder mask
    if (appPassword && appPassword.trim() !== "" && !appPassword.includes("•")) {
      finalPassword = appPassword.trim();
    }

    saveWordPressConfig({
      wpUrl: wpUrl.trim(),
      username: username.trim(),
      appPassword: finalPassword
    });

    return res.json({
      success: true,
      message: "WordPress configuration saved securely on server.",
      wpUrl: wpUrl.trim(),
      username: username.trim(),
      hasAppPassword: finalPassword.length > 0
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to save configuration: ${err.message}` });
  }
});

// 3. POST Test connection endpoint: Validates Basic Auth with WP Users endpoint
app.post("/api/wordpress/test", async (req, res) => {
  try {
    // Allow testing passed-in credentials or stored fallback
    const { wpUrl: paramUrl, username: paramUser, appPassword: paramPass } = req.body;
    const config = getWordPressConfig();

    const wpUrl = (paramUrl && paramUrl.trim() !== "") ? paramUrl : config.wpUrl;
    const username = (paramUser && paramUser.trim() !== "") ? paramUser : config.username;
    
    let appPassword = config.appPassword;
    if (paramPass && paramPass.trim() !== "" && !paramPass.includes("•")) {
      appPassword = paramPass.trim();
    }

    if (!wpUrl || !username || !appPassword) {
      return res.status(400).json({ error: "Connection testing requires configured URL, username, and application password." });
    }

    // Standardize URL formatting
    let normalizedUrl = wpUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    normalizedUrl = normalizedUrl.replace(/\/+$/, "");

    logToServer("info", "api", `Testing connection credentials to WordPress site: ${normalizedUrl} for user: ${username}`);

    const credentialsBase64 = Buffer.from(`${username}:${appPassword}`).toString("base64");

    const testResponse = await fetch(`${normalizedUrl}/wp-json/wp/v2/users/me`, {
      method: "GET",
      headers: {
        "Authorization": `Basic ${credentialsBase64}`,
        "Accept": "application/json"
      }
    });

    if (!testResponse.ok) {
      const errText = await testResponse.text();
      logToServer("error", "api", `WordPress connection test failed with HTTP status ${testResponse.status}: ${errText.substring(0, 200)}`);
      return res.status(testResponse.status).json({
        success: false,
        status: testResponse.status,
        error: `Authentication failed (HTTP ${testResponse.status}): ${errText.substring(0, 150)}`
      });
    }

    const userData = await testResponse.json();
    logToServer("success", "api", `WordPress connection verified successfully! Authorized as user: "${userData.name}" (ID: ${userData.id})`);

    return res.json({
      success: true,
      user: {
        id: userData.id,
        name: userData.name,
        slug: userData.slug,
        link: userData.link
      }
    });

  } catch (err: any) {
    logToServer("error", "api", `WordPress connection testing failed: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: `WordPress connection failed: ${err.message}`
    });
  }
});

// 4. POST Media Upload endpoint: Decodes and pushes binary audio payload to WordPress REST API
app.post("/api/wordpress/upload", async (req, res) => {
  try {
    const { audioBase64, fileName, title } = req.body;
    const config = getWordPressConfig();

    if (!config.wpUrl || !config.username || !config.appPassword) {
      logToServer("warn", "api", "WordPress upload aborted: No saved credentials on server.");
      return res.status(400).json({ error: "WordPress credentials are not configured. Please save credentials in the settings panel first." });
    }

    if (!audioBase64) {
      logToServer("warn", "api", "WordPress upload aborted: Missing binary audio payload.");
      return res.status(400).json({ error: "Missing processed audio buffer. Please process or apply audio repair first." });
    }

    // Standardize URL formatting
    let normalizedUrl = config.wpUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    normalizedUrl = normalizedUrl.replace(/\/+$/, "");

    // Clean up base64 payload to get pure binary Buffer
    let base64Data = audioBase64;
    if (base64Data.includes(";base64,")) {
      base64Data = base64Data.split(";base64,").pop() || "";
    }
    const binaryData = Buffer.from(base64Data, "base64");

    // Dynamic MIME Mapping based on File Extension
    const nameToUse = fileName || `vocal_take_${Date.now()}.wav`;
    const titleToUse = title || `Vocal Match Audio Take`;
    const ext = nameToUse.toLowerCase().split(".").pop();
    
    let mimeType = "audio/wav";
    if (ext === "mp3") {
      mimeType = "audio/mpeg";
    } else if (ext === "wav" || ext === "wave") {
      mimeType = "audio/wav";
    } else if (ext === "ogg") {
      mimeType = "audio/ogg";
    } else if (ext === "m4a") {
      mimeType = "audio/mp4";
    }

    logToServer("info", "api", `[UPLOAD_START] Attempting WordPress REST API upload. Target: ${normalizedUrl}/wp-json/wp/v2/media | File: "${nameToUse}" | Size: ${binaryData.length} bytes | MIME-type: ${mimeType}`);

    const credentialsBase64 = Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

    const wpResponse = await fetch(`${normalizedUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentialsBase64}`,
        "Content-Disposition": `attachment; filename="${nameToUse}"`,
        "Content-Type": mimeType,
        "Accept": "application/json"
      },
      body: binaryData
    });

    logToServer("info", "api", `[UPLOAD_RESPONSE] WordPress REST API returned HTTP Status: ${wpResponse.status}`);

    if (!wpResponse.ok) {
      const errorText = await wpResponse.text();
      let parsedError;
      try {
        parsedError = JSON.parse(errorText);
      } catch (e) {
        parsedError = null;
      }
      
      const errMsg = parsedError?.message || `WordPress returned status ${wpResponse.status}: ${errorText.substring(0, 200)}`;
      logToServer("error", "api", `[UPLOAD_FAILURE] Media upload failed. HTTP status=${wpResponse.status} | Error: ${errMsg}`);
      
      return res.status(wpResponse.status).json({
        error: errMsg,
        code: parsedError?.code || "wordpress_error",
        status: wpResponse.status
      });
    }

    const mediaDetails = await wpResponse.json();

    // Secondary meta update to set Title, Caption, Description properly
    try {
      logToServer("info", "api", `[META_UPDATE_START] Updating media meta for attachment ID #${mediaDetails.id}`);
      const updateResponse = await fetch(`${normalizedUrl}/wp-json/wp/v2/media/${mediaDetails.id}`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentialsBase64}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: titleToUse,
          caption: "Processed & Uploaded via Vocal Match Studio",
          description: `High fidelity professional vocal take. Size: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB. Mime-type: ${mimeType}.`
        })
      });

      if (updateResponse.ok) {
        const updatedMeta = await updateResponse.json();
        mediaDetails.title.rendered = updatedMeta.title?.rendered || titleToUse;
        logToServer("success", "api", `[META_UPDATE_SUCCESS] Metadata updated for media attachment #${mediaDetails.id}`);
      } else {
        logToServer("warn", "api", `[META_UPDATE_WARN] WordPress metadata update returned HTTP ${updateResponse.status}`);
      }
    } catch (updateErr: any) {
      logToServer("warn", "api", `[META_UPDATE_ERROR] Could not update WordPress media metadata: ${updateErr.message}`);
    }

    logToServer("success", "api", `[UPLOAD_SUCCESS] WordPress media upload completed successfully! Media ID: #${mediaDetails.id} | Name: "${nameToUse}" | URL: "${mediaDetails.source_url}" | MIME: "${mediaDetails.mime_type || mimeType}" | File Size: ${binaryData.length} bytes`);

    return res.json({
      success: true,
      mediaId: mediaDetails.id,
      sourceUrl: mediaDetails.source_url,
      link: mediaDetails.link,
      title: mediaDetails.title?.rendered || titleToUse,
      mimeType: mediaDetails.mime_type || mimeType,
      fileSize: binaryData.length
    });

  } catch (error: any) {
    logToServer("error", "api", `[UPLOAD_ERROR] WordPress media upload integration crash: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during the WordPress upload execution."
    });
  }
});

// 5. POST Create Post (Draft Episode) endpoint: Prepares architecture for automated draft post creation
app.post("/api/wordpress/create-post", async (req, res) => {
  try {
    const { mediaUrl, mediaId, title, summary } = req.body;
    const config = getWordPressConfig();

    if (!config.wpUrl || !config.username || !config.appPassword) {
      logToServer("warn", "api", "WordPress post draft aborted: No credentials.");
      return res.status(400).json({ error: "WordPress credentials are not configured." });
    }

    if (!mediaUrl) {
      return res.status(400).json({ error: "Missing mediaUrl parameter." });
    }

    // Standardize URL formatting
    let normalizedUrl = config.wpUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    normalizedUrl = normalizedUrl.replace(/\/+$/, "");

    const postTitle = title ? `Episode: ${title}` : `New Podcast Episode - ${new Date().toLocaleDateString()}`;
    const cleanSummary = summary || "In this episode, we explore professional voice synthesis, repair, and advanced audio processing algorithms.";

    // Simple HTML structure containing a beautiful player and description text
    const postContent = `
<!-- WordPress Audio Podcast Block -->
<p><em>${cleanSummary}</em></p>

<div class="wp-block-audio">
  <audio controls src="${mediaUrl}"></audio>
  <p><a href="${mediaUrl}">Download episode audio file directly (.wav)</a></p>
</div>

<hr class="wp-block-separator" />
<p>Processed with high fidelity vocal match repair engines. Powered by Vocal Match & Podcast Studio.</p>
    `.trim();

    logToServer("info", "api", `[DRAFT_POST_START] Creating WordPress draft post. Site: ${normalizedUrl} | Media ID: #${mediaId}`);

    const credentialsBase64 = Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

    const postResponse = await fetch(`${normalizedUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentialsBase64}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        title: postTitle,
        content: postContent,
        status: "draft",
        excerpt: cleanSummary,
        format: "audio"
      })
    });

    if (!postResponse.ok) {
      const errText = await postResponse.text();
      logToServer("error", "api", `[DRAFT_POST_FAILURE] Failed to create draft post. Status: ${postResponse.status} | Response: ${errText.substring(0, 200)}`);
      return res.status(postResponse.status).json({
        error: `Could not create WordPress draft post: ${errText.substring(0, 150)}`
      });
    }

    const postDetails = await postResponse.json();
    logToServer("success", "api", `[DRAFT_POST_SUCCESS] WordPress draft post created successfully! Post ID: #${postDetails.id} | Link: "${postDetails.link}"`);

    return res.json({
      success: true,
      postId: postDetails.id,
      link: postDetails.link,
      title: postDetails.title?.rendered || postTitle,
      status: postDetails.status
    });

  } catch (error: any) {
    logToServer("error", "api", `[DRAFT_POST_ERROR] WordPress draft creation crashed: ${error.message}`);
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during draft post creation."
    });
  }
});

// API endpoint to fetch server level logs for Diagnostics panel
const SPEAKER_PROFILES_PATH = path.join(process.cwd(), "speaker-profiles.json");

function readSpeakerProfiles(): any[] {
  try {
    if (fs.existsSync(SPEAKER_PROFILES_PATH)) {
      const data = fs.readFileSync(SPEAKER_PROFILES_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch (err: any) {
    logToServer("error", "server", `Failed to read speaker profiles file: ${err.message}`);
  }
  return [];
}

function writeSpeakerProfiles(profiles: any[]): boolean {
  try {
    fs.writeFileSync(SPEAKER_PROFILES_PATH, JSON.stringify(profiles, null, 2), "utf8");
    return true;
  } catch (err: any) {
    logToServer("error", "server", `Failed to write speaker profiles file: ${err.message}`);
    return false;
  }
}

// GET speaker profiles
app.get("/api/speaker-profiles", (req, res) => {
  const profiles = readSpeakerProfiles();
  return res.json(profiles);
});

// POST save/update speaker profile
app.post("/api/speaker-profiles", (req, res) => {
  try {
    const profile = req.body;
    if (!profile || !profile.name) {
      return res.status(400).json({ error: "Missing speaker profile data or name." });
    }
    
    const profiles = readSpeakerProfiles();
    const cleanName = profile.name.trim();
    const cleanId = profile.id || cleanName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    
    const existingIndex = profiles.findIndex((p: any) => p.id === cleanId || p.name.toLowerCase() === cleanName.toLowerCase());
    
    const newProfile = {
      ...profile,
      id: cleanId,
      name: cleanName,
      updatedAt: new Date().toISOString()
    };
    
    if (existingIndex > -1) {
      profiles[existingIndex] = newProfile;
      logToServer("info", "api", `Updated speaker profile: ${cleanName}`);
    } else {
      profiles.push(newProfile);
      logToServer("info", "api", `Created new speaker profile: ${cleanName}`);
    }
    
    writeSpeakerProfiles(profiles);
    return res.json({ success: true, profile: newProfile });
  } catch (error: any) {
    logToServer("error", "api", `Failed to save speaker profile: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// POST delete speaker profile
app.post("/api/speaker-profiles/delete", (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Missing profile 'id' for deletion." });
    }
    
    let profiles = readSpeakerProfiles();
    const target = profiles.find((p: any) => p.id === id);
    if (!target) {
      return res.status(404).json({ error: "Speaker profile not found." });
    }
    
    profiles = profiles.filter((p: any) => p.id !== id);
    writeSpeakerProfiles(profiles);
    logToServer("info", "api", `Deleted speaker profile: ${target.name}`);
    return res.json({ success: true });
  } catch (error: any) {
    logToServer("error", "api", `Failed to delete speaker profile: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/logs", (req, res) => {
  return res.json(serverLogsList);
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
