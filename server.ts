import express from "express";
import path from "path";
import dotenv from "dotenv";
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

    const ai = getAI();
    logToServer("info", "api", `Vocal Patch Generation Started. Voice preset: ${voicePreset || "Puck"}, text: "${textToSpeak.slice(0, 60)}${textToSpeak.length > 60 ? "..." : ""}" (${textToSpeak.length} chars). Has Style Guidelines: ${!!styleGuidelines}`);

    let promptText = "";
    const parts: any[] = [];

    if (referenceAudio && mimeType) {
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: referenceAudio
        }
      });
      promptText = `You are a voice replication and speech cloning engine.
Below is an audio recording of a target speaker's voice.
Analyze the speaker's vocal characteristics (pitch, tone, accent, cadence, gender) in that audio recording.
Your task is to speak the following text replicating that speaker's voice, pacing, timbre, and emotional delivery as closely as humanly possible:
"${textToSpeak}"

Guidelines:
1. Speak the text in the EXACT same voice as the target speaker in the provided audio file.
2. Maintain a completely natural, human cadence (avoid sounding robotic or monotonous).
3. Do NOT add any introductory remarks, coughs, ambient sighs, or explanations. Output ONLY the clean spoken words.`;
    } else {
      promptText = `You are a professional voice actor, speech synthesizer, and voice matching engine.
We are patching a podcast or spoken word recording.
Your task is to speak the following text clearly, naturally, and with excellent vocal cadence:
"${textToSpeak}"

Guidelines:
1. Maintain a completely natural, human cadence (avoid sounding robotic or monotonous).
2. Do NOT add any introductory remarks, coughs, ambient sighs, "here is your audio", or explanation. Output ONLY the clean spoken words.`;
    }

    if (styleGuidelines && typeof styleGuidelines === "string" && styleGuidelines.trim()) {
      promptText += `\n3. ADDITIONAL VOCAL STYLE TO EMULATE: ${styleGuidelines.trim()}`;
    }

    parts.push({ text: promptText });

    const contents = [{ parts: parts }];

    const config: any = {
      responseModalities: ["AUDIO"]
    };

    if (voicePreset && voicePreset !== "cloned") {
      config.speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voicePreset
          }
        }
      };
    }

    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
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

// API endpoint to fetch server level logs for Diagnostics panel
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
