import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

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
      return res.status(400).json({ error: "Missing 'audio' data (base64 string required)." });
    }
    if (!mimeType) {
      return res.status(400).json({ error: "Missing 'mimeType' (e.g., audio/mp3, audio/wav, audio/webm)." });
    }

    const ai = getAI();

    console.log(`Analyzing audio with Gemini. MimeType: ${mimeType}, Size: ${Math.round(audio.length / 1024)} KB, Reference Script: ${!!script}, Chunk: ${chunkStart !== undefined ? chunkStart + "s - " + chunkEnd + "s" : "Full"}`);

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

    console.log("Analysis completed successfully.");
    const parsed = JSON.parse(text);
    return res.json(parsed);

  } catch (error: any) {
    console.error("Error analyzing audio:", error);
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during audio analysis."
    });
  }
});

// API endpoint to generate vocal speech patch
app.post("/api/generate-patch", async (req, res) => {
  try {
    const { referenceAudio, mimeType, textToSpeak, voicePreset } = req.body;
    if (!textToSpeak) {
      return res.status(400).json({ error: "Missing 'textToSpeak' input string." });
    }

    const ai = getAI();
    console.log(`Generating speech patch with voice: ${voicePreset || "Puck"}, text length: ${textToSpeak.length} characters. Reference audio: ${!!referenceAudio}`);

    // Note: Since 'gemini-3.1-flash-tts-preview' is a dedicated text-to-speech model, it accepts ONLY text input.
    // Multimodal audio ingestion (reference audio) is not supported for TTS-specific models and causes an error.
    const promptText = `You are a professional voice actor, speech synthesizer, and voice matching engine.
We are patching a podcast or spoken word recording.
Your task is to speak the following text clearly, naturally, and with excellent vocal cadence:
"${textToSpeak}"

Guidelines:
1. Maintain a completely natural, human cadence (avoid sounding robotic or monotonous).
2. Do NOT add any introductory remarks, coughs, ambient sighs, "here is your audio", or explanation. Output ONLY the clean spoken words.`;

    const contents = [{ parts: [{ text: promptText }] }];

    // Call Gemini with the AUDIO response modality config using the official TTS model
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: contents,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voicePreset || "Puck" // Supported prebuilt voices: Puck, Charon, Fenrir, Kore, Zephyr
            }
          }
        }
      }
    }));

    // Find the audio parts inside the candidates returned
    const candidates = response.candidates;
    const part = candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("audio/"));

    if (!part || !part.inlineData || !part.inlineData.data) {
      throw new Error("No audio bytes returned from Gemini API. Ensure the selected model and voice support speech generation.");
    }

    console.log("Speech patch generation completed successfully.");
    return res.json({
      audio: part.inlineData.data,
      mimeType: part.inlineData.mimeType
    });

  } catch (error: any) {
    console.error("Error generating speech patch:", error);
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during speech patch generation."
    });
  }
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
