import React, { useState, useEffect } from "react";
import { 
  Settings, 
  Sparkles, 
  Globe, 
  KeyRound, 
  User, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Check, 
  Wand2, 
  Sliders, 
  Activity, 
  Database,
  Link,
  Lock
} from "lucide-react";
import { AppLog } from "../types";

interface SettingsStudioProps {
  addLog: (
    level: "info" | "warn" | "error" | "success",
    category: "click" | "action" | "api" | "browser" | "server",
    message: string,
    details?: any
  ) => void;
}

export default function SettingsStudio({ addLog }: SettingsStudioProps) {
  // Gemini State
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [isGeminiSaving, setIsGeminiSaving] = useState(false);
  const [isGeminiTesting, setIsGeminiTesting] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [geminiSuccessMsg, setGeminiSuccessMsg] = useState<string | null>(null);

  // TTS State
  const [localTtsUrl, setLocalTtsUrl] = useState("");
  const [localTtsToken, setLocalTtsToken] = useState("");
  const [hasTtsToken, setHasTtsToken] = useState(false);
  const [isTtsSaving, setIsTtsSaving] = useState(false);
  const [isTtsTesting, setIsTtsTesting] = useState(false);
  const [ttsTestResult, setTtsTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [ttsSuccessMsg, setTtsSuccessMsg] = useState<string | null>(null);

  // WordPress State
  const [wpUrl, setWpUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [hasWpPassword, setHasWpPassword] = useState(false);
  const [isWpSaving, setIsWpSaving] = useState(false);
  const [isWpTesting, setIsWpTesting] = useState(false);
  const [wpTestResult, setWpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [wpSuccessMsg, setWpSuccessMsg] = useState<string | null>(null);

  // HandAISpoke Local STT State
  const [sttEngine, setSttEngine] = useState<"gemini" | "handaispoke">("handaispoke");
  const [handaiSpokeUrl, setHandaiSpokeUrl] = useState("https://handaispokeapi.thehandaiman.com");
  const [handaiSpokeToken, setHandaiSpokeToken] = useState("");
  const [hasHandaiSpokeToken, setHasHandaiSpokeToken] = useState(false);
  const [isHandaiSpokeSaving, setIsHandaiSpokeSaving] = useState(false);
  const [isHandaiSpokeTesting, setIsHandaiSpokeTesting] = useState(false);
  const [handaiSpokeTestResult, setHandaiSpokeTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [handaiSpokeSuccessMsg, setHandaiSpokeSuccessMsg] = useState<string | null>(null);

  const [isWhisperXTesting, setIsWhisperXTesting] = useState(false);
  const [whisperXTestResult, setWhisperXTestResult] = useState<{ success: boolean; message: string; details?: any } | null>(null);

  // Load existing settings
  useEffect(() => {
    const fetchGeminiSettings = async () => {
      try {
        const res = await fetch("/api/gemini/settings");
        if (res.ok) {
          const data = await res.json();
          setGeminiApiKey(data.geminiApiKey || "");
          setHasGeminiKey(data.hasKey || false);
        }
      } catch (err) {
        console.error("Failed to load Gemini settings:", err);
      }
    };

    const fetchTtsSettings = async () => {
      try {
        const res = await fetch("/api/tts/settings");
        if (res.ok) {
          const data = await res.json();
          setLocalTtsUrl(data.localTtsUrl || "");
          setLocalTtsToken(data.localTtsToken || "");
          setHasTtsToken(data.hasToken || false);
        }
      } catch (err) {
        console.error("Failed to load TTS settings:", err);
      }
    };

    const fetchWpSettings = async () => {
      try {
        const res = await fetch("/api/wordpress/settings");
        if (res.ok) {
          const data = await res.json();
          setWpUrl(data.wpUrl || "");
          setUsername(data.username || "");
          setHasWpPassword(data.hasAppPassword || false);
          if (data.hasAppPassword) {
            setAppPassword("••••••••••••••••••••••••");
          }
        }
      } catch (err) {
        console.error("Failed to load WordPress settings:", err);
      }
    };

    const fetchHandaiSpokeSettings = async () => {
      try {
        const res = await fetch("/api/handaispoke/settings");
        if (res.ok) {
          const data = await res.json();
          setSttEngine(data.sttEngine || "handaispoke");
          setHandaiSpokeUrl(data.handaiSpokeUrl || "https://handaispokeapi.thehandaiman.com");
          setHandaiSpokeToken(data.handaiSpokeToken || "");
          setHasHandaiSpokeToken(data.hasToken || false);
        }
      } catch (err) {
        console.error("Failed to load HandAISpoke settings:", err);
      }
    };

    fetchGeminiSettings();
    fetchTtsSettings();
    fetchWpSettings();
    fetchHandaiSpokeSettings();
  }, []);

  // Save HandAISpoke Settings
  const handleSaveHandaiSpoke = async () => {
    setIsHandaiSpokeSaving(true);
    setHandaiSpokeSuccessMsg(null);
    setHandaiSpokeTestResult(null);
    addLog("info", "action", `Initiating save of HandAISpoke Settings (Engine: ${sttEngine}) server-side...`);

    try {
      const res = await fetch("/api/handaispoke/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sttEngine, handaiSpokeUrl, handaiSpokeToken })
      });

      if (res.ok) {
        const data = await res.json();
        setHasHandaiSpokeToken(data.hasToken);
        if (data.hasToken && handaiSpokeToken.trim() !== "") {
          setHandaiSpokeToken("••••••••");
        }
        setHandaiSpokeSuccessMsg("HandAISpoke settings saved successfully on the server!");
        addLog("success", "action", "HandAISpoke settings saved securely on server.");
        setTimeout(() => setHandaiSpokeSuccessMsg(null), 4000);
      } else {
        const err = await res.json();
        addLog("error", "action", `Failed to save HandAISpoke settings: ${err.error}`);
      }
    } catch (err: any) {
      addLog("error", "action", `HandAISpoke save crashed: ${err.message}`);
    } finally {
      setIsHandaiSpokeSaving(false);
    }
  };

  // Test HandAISpoke Connection
  const handleTestHandaiSpoke = async () => {
    setIsHandaiSpokeTesting(true);
    setHandaiSpokeTestResult(null);
    addLog("info", "action", "Testing connection to local HandAISpoke bridge...");

    try {
      const res = await fetch("/api/handaispoke/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handaiSpokeUrl, handaiSpokeToken })
      });

      const data = await res.json();
      if (res.ok) {
        setHandaiSpokeTestResult({ success: true, message: data.message });
        addLog("success", "api", `HandAISpoke Bridge test succeeded: ${data.message}`);
      } else {
        setHandaiSpokeTestResult({ success: false, message: data.error || "Connection test failed." });
        addLog("error", "api", `HandAISpoke Bridge test failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setHandaiSpokeTestResult({ success: false, message: err.message || "Test call failed." });
      addLog("error", "api", `HandAISpoke Bridge test call crashed: ${err.message}`);
    } finally {
      setIsHandaiSpokeTesting(false);
    }
  };

  // Test HandAISpoke WhisperX Speech-to-Text Capabilities
  const handleTestWhisperX = async () => {
    setIsWhisperXTesting(true);
    setWhisperXTestResult(null);
    addLog("info", "action", "Initiating WhisperX direct transcription capabilities test...");

    try {
      const res = await fetch("/api/handaispoke/test-whisperx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handaiSpokeUrl, handaiSpokeToken })
      });

      const data = await res.json();
      if (res.ok) {
        setWhisperXTestResult({ 
          success: true, 
          message: data.message || "WhisperX transcription endpoint responded perfectly!", 
          details: data.details 
        });
        addLog("success", "api", `HandAISpoke WhisperX test succeeded: ${data.message}`);
      } else {
        setWhisperXTestResult({ 
          success: false, 
          message: data.error || "WhisperX endpoint responded with an error." 
        });
        addLog("error", "api", `HandAISpoke WhisperX test failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setWhisperXTestResult({ 
        success: false, 
        message: err.message || "WhisperX test call crashed/timeout." 
      });
      addLog("error", "api", `HandAISpoke WhisperX test call crashed: ${err.message}`);
    } finally {
      setIsWhisperXTesting(false);
    }
  };

  // Save Gemini Settings
  const handleSaveGemini = async () => {
    setIsGeminiSaving(true);
    setGeminiSuccessMsg(null);
    setGeminiTestResult(null);
    addLog("info", "action", "Initiating save of custom Gemini API Key server-side...");

    try {
      const res = await fetch("/api/gemini/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiApiKey })
      });

      if (res.ok) {
        const data = await res.json();
        setHasGeminiKey(data.hasKey);
        if (data.hasKey && geminiApiKey.trim() !== "") {
          setGeminiApiKey("••••••••");
        }
        setGeminiSuccessMsg("Gemini API Key saved successfully on the server!");
        addLog("success", "action", "Gemini API key saved securely on server-side store.");
        setTimeout(() => setGeminiSuccessMsg(null), 4000);
      } else {
        const err = await res.json();
        addLog("error", "action", `Failed to save Gemini settings: ${err.error}`);
      }
    } catch (err: any) {
      addLog("error", "action", `Gemini save crashed: ${err.message}`);
    } finally {
      setIsGeminiSaving(false);
    }
  };

  // Test Gemini Connection
  const handleTestGemini = async () => {
    setIsGeminiTesting(true);
    setGeminiTestResult(null);
    addLog("info", "action", "Testing custom Gemini API connection...");

    try {
      const res = await fetch("/api/gemini/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiApiKey })
      });

      const data = await res.json();
      if (res.ok) {
        setGeminiTestResult({ success: true, message: data.message });
        addLog("success", "api", `Gemini API key test completed successfully: ${data.message}`);
      } else {
        setGeminiTestResult({ success: false, message: data.error });
        addLog("error", "api", `Gemini API connection failed: ${data.error}`);
      }
    } catch (err: any) {
      setGeminiTestResult({ success: false, message: err.message });
      addLog("error", "api", `Gemini test crashed: ${err.message}`);
    } finally {
      setIsGeminiTesting(false);
    }
  };

  // Save TTS Settings
  const handleSaveTts = async () => {
    setIsTtsSaving(true);
    setTtsSuccessMsg(null);
    setTtsTestResult(null);
    addLog("info", "action", "Initiating save of custom TTS API configuration server-side...");

    try {
      const res = await fetch("/api/tts/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localTtsUrl, localTtsToken })
      });

      if (res.ok) {
        const data = await res.json();
        setHasTtsToken(data.hasToken);
        if (data.hasToken && localTtsToken.trim() !== "") {
          setLocalTtsToken("••••••••");
        }
        setTtsSuccessMsg("TTS Configuration saved successfully on the server!");
        addLog("success", "action", "TTS configuration saved securely on server-side store.");
        setTimeout(() => setTtsSuccessMsg(null), 4000);
      } else {
        const err = await res.json();
        addLog("error", "action", `Failed to save TTS settings: ${err.error}`);
      }
    } catch (err: any) {
      addLog("error", "action", `TTS save crashed: ${err.message}`);
    } finally {
      setIsTtsSaving(false);
    }
  };

  // Test TTS Connection
  const handleTestTts = async () => {
    setIsTtsTesting(true);
    setTtsTestResult(null);
    addLog("info", "action", `Testing custom TTS API connection to: ${localTtsUrl}...`);

    try {
      const res = await fetch("/api/tts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localTtsUrl, localTtsToken })
      });

      const data = await res.json();
      if (res.ok) {
        setTtsTestResult({ success: true, message: data.message });
        addLog("success", "api", `Custom TTS test completed successfully: ${data.message}`);
      } else {
        setTtsTestResult({ success: false, message: data.error });
        addLog("error", "api", `Custom TTS connection failed: ${data.error}`);
      }
    } catch (err: any) {
      setTtsTestResult({ success: false, message: err.message });
      addLog("error", "api", `TTS test crashed: ${err.message}`);
    } finally {
      setIsTtsTesting(false);
    }
  };

  // Save WP Settings
  const handleSaveWp = async () => {
    setIsWpSaving(true);
    setWpSuccessMsg(null);
    setWpTestResult(null);
    addLog("info", "action", "Initiating save of WordPress connection credentials server-side...");

    try {
      const res = await fetch("/api/wordpress/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wpUrl, username, appPassword })
      });

      if (res.ok) {
        const data = await res.json();
        setHasWpPassword(data.hasAppPassword);
        if (data.hasAppPassword) {
          setAppPassword("••••••••••••••••••••••••");
        }
        setWpSuccessMsg("WordPress configuration saved successfully on the server!");
        addLog("success", "action", "WordPress connection settings saved securely on server config store.");
        setTimeout(() => setWpSuccessMsg(null), 4000);
      } else {
        const err = await res.json();
        addLog("error", "action", `Failed to save WordPress settings: ${err.error}`);
      }
    } catch (err: any) {
      addLog("error", "action", `WordPress save crashed: ${err.message}`);
    } finally {
      setIsWpSaving(false);
    }
  };

  // Test WP Connection
  const handleTestWp = async () => {
    setIsWpTesting(true);
    setWpTestResult(null);
    addLog("info", "action", `Testing WordPress credential authorization to: ${wpUrl}...`);

    try {
      const res = await fetch("/api/wordpress/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wpUrl, username, appPassword })
      });

      const data = await res.json();
      if (res.ok) {
        setWpTestResult({ success: true, message: data.message });
        addLog("success", "api", `WordPress credentials verified successfully! Authorized as user "${data.user?.name || username}"`);
      } else {
        setWpTestResult({ success: false, message: data.error });
        addLog("error", "api", `WordPress credential validation failed: ${data.error}`);
      }
    } catch (err: any) {
      setWpTestResult({ success: false, message: err.message });
      addLog("error", "api", `WordPress connection testing failed: ${err.message}`);
    } finally {
      setIsWpTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" id="settings-studio-container">
      {/* Title Header */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-emerald-400">
            <Settings className="w-5 h-5 animate-spin-slow" />
          </div>
          <div>
            <h1 className="text-lg font-sans font-bold tracking-tight text-slate-100 flex items-center gap-2">
              System Settings Control Panel
            </h1>
            <p className="text-xs text-slate-400">
              Configure and test integration credentials for external API servers, vocal speech generators, and publication targets.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GEMINI API KEY DETAILS CARD */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <span className="text-[11px] uppercase font-bold tracking-wider text-slate-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Gemini API Details
            </span>
            <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-mono">
              Workspace Core
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Provide a custom Gemini API Key to run content analysis, text-to-speech transcription patching, and WordPress SEO metadata generation. If left empty, the server automatically defaults to the workspace's pre-configured key.
          </p>

          <div className="flex flex-col gap-4">
            {/* Custom Key */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                <span>Gemini API Key</span>
                {hasGeminiKey && <span className="text-emerald-400 font-bold text-[9px] font-mono">🔒 Stored on server</span>}
              </label>
              <div className="relative flex items-center">
                <KeyRound className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                <input
                  type="password"
                  placeholder={hasGeminiKey ? "••••••••" : "AI Studio / Cloud Secret Key"}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                  id="gemini-settings-key"
                />
              </div>
            </div>
          </div>

          {/* Action Status Output */}
          {geminiSuccessMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2 animate-pulse">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{geminiSuccessMsg}</span>
            </div>
          )}

          {geminiTestResult && (
            <div className={`p-3 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2.5 ${
              geminiTestResult.success 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            }`} id="gemini-connection-test-result">
              {geminiTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <div>
                <span className="font-bold">{geminiTestResult.success ? "Gemini Key verified! " : "Verification Failed: "}</span>
                <span>{geminiTestResult.message}</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-2 gap-3 border-t border-slate-800/40 mt-auto">
            <span className="text-[10px] text-slate-500 italic max-w-[200px]">
              Keys are encrypted on transit and saved in secure system memory.
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleTestGemini}
                disabled={isGeminiTesting}
                className="px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                id="gemini-btn-test"
              >
                {isGeminiTesting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <span>Test Key</span>
                )}
              </button>
              <button
                onClick={handleSaveGemini}
                disabled={isGeminiSaving}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                id="gemini-btn-save"
              >
                {isGeminiSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Key</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* TTS API DETAILS CARD */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <span className="text-[11px] uppercase font-bold tracking-wider text-slate-300 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              TTS API Details
            </span>
            <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-mono">
              Server Encrypted
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Specify credentials for your custom high-fidelity voice-cloning text-to-speech service. These settings are persisted securely on the backend server and will be utilized when "Clone Voice" preset is activated.
          </p>

          <div className="flex flex-col gap-4">
            {/* Target Site URL */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                <span>Custom TTS API URL</span>
                <span className="text-slate-500 font-normal">HTTP / HTTPS Endpoint</span>
              </label>
              <div className="relative flex items-center">
                <Link className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="https://tts-api.yourserver.com/generate"
                  value={localTtsUrl}
                  onChange={(e) => setLocalTtsUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                  id="tts-settings-url"
                />
              </div>
            </div>

            {/* Custom Token */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                <span>Bearer Authentication Token / Key</span>
                {hasTtsToken && <span className="text-emerald-400 font-bold text-[9px] font-mono">🔒 Stored in secure store</span>}
              </label>
              <div className="relative flex items-center">
                <KeyRound className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                <input
                  type="password"
                  placeholder={hasTtsToken ? "••••••••" : "Bearer token / api key"}
                  value={localTtsToken}
                  onChange={(e) => setLocalTtsToken(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                  id="tts-settings-token"
                />
              </div>
            </div>
          </div>

          {/* Action Status Output */}
          {ttsSuccessMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2 animate-pulse">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{ttsSuccessMsg}</span>
            </div>
          )}

          {ttsTestResult && (
            <div className={`p-3 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2.5 ${
              ttsTestResult.success 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            }`} id="tts-connection-test-result">
              {ttsTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <div>
                <span className="font-bold">{ttsTestResult.success ? "TTS Verified! " : "TTS Contact Failed: "}</span>
                <span>{ttsTestResult.message}</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-2 gap-3 border-t border-slate-800/40 mt-auto">
            <span className="text-[10px] text-slate-500 italic max-w-[200px]">
              Tokens are never stored in browser cookies or localStorage.
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleTestTts}
                disabled={!localTtsUrl.trim() || isTtsTesting}
                className="px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                id="tts-btn-test"
              >
                {isTtsTesting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <span>Test Connection</span>
                )}
              </button>
              <button
                onClick={handleSaveTts}
                disabled={!localTtsUrl.trim() || isTtsSaving}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                id="tts-btn-save"
              >
                {isTtsSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save TTS Settings</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* WORDPRESS SITE SETTINGS CARD */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <span className="text-[11px] uppercase font-bold tracking-wider text-slate-300 flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              WordPress Connection Settings
            </span>
            <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-mono">
              Server Encrypted
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Establish authorization with your self-hosted WordPress site. These details let you directly compile podcast files, write custom dynamic descriptions, and publish drafts to your WordPress media library.
          </p>

          <div className="flex flex-col gap-4">
            {/* Target Site URL */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                <span>WordPress Site URL</span>
                <span className="text-slate-500 font-normal">Must support HTTPS</span>
              </label>
              <div className="relative flex items-center">
                <Globe className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="https://example.com"
                  value={wpUrl}
                  onChange={(e) => setWpUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                  id="wp-settings-url-tab"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Username */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  WordPress Username
                </label>
                <div className="relative flex items-center">
                  <User className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                    id="wp-settings-username-tab"
                  />
                </div>
              </div>

              {/* Application Password */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                  <span>Application Password</span>
                  {hasWpPassword && <span className="text-emerald-400 font-bold text-[9px] font-mono">🔒 Saved</span>}
                </label>
                <div className="relative flex items-center">
                  <KeyRound className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                  <input
                    type="password"
                    placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                    id="wp-settings-password-tab"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Action Status Output */}
          {wpSuccessMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2 animate-pulse">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{wpSuccessMsg}</span>
            </div>
          )}

          {wpTestResult && (
            <div className={`p-3 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2.5 ${
              wpTestResult.success 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            }`} id="wp-connection-test-result-tab">
              {wpTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <div>
                <span className="font-bold">{wpTestResult.success ? "WordPress Verified! " : "WP Connection Failed: "}</span>
                <span>{wpTestResult.message}</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-2 gap-3 border-t border-slate-800/40 mt-auto font-sans">
            <span className="text-[10px] text-slate-500 italic max-w-[200px]">
              Passwords are never stored in browser cookies or localStorage.
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleTestWp}
                disabled={!wpUrl.trim() || !username.trim() || !appPassword.trim() || isWpTesting}
                className="px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                id="wp-btn-test-tab"
              >
                {isWpTesting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <span>Test Connection</span>
                )}
              </button>
              <button
                onClick={handleSaveWp}
                disabled={!wpUrl.trim() || !username.trim() || !appPassword.trim() || isWpSaving}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                id="wp-btn-save-tab"
              >
                {isWpSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save WP Settings</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* HANDAISPOKE STT & LOCAL ENGINE CARD */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <span className="text-[11px] uppercase font-bold tracking-wider text-slate-300 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              Speech-to-Text (STT) Settings
            </span>
            <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-mono">
              Engine Control
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Choose whether to perform speech repair transcription via Gemini cloud inference or your local GPU-powered speech engine.
          </p>

          <div className="flex flex-col gap-4">
            {/* STT Engine Select */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stt-engine-select" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                Transcription Engine
              </label>
              <select
                id="stt-engine-select"
                value={sttEngine}
                onChange={(e) => setSttEngine(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/50 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none transition-colors cursor-pointer"
              >
                <option value="gemini">Gemini 3.5 Flash (Cloud Model)</option>
                <option value="handaispoke">HandAISpoke Local (Faster-Whisper / WhisperX)</option>
              </select>
            </div>

            {sttEngine === "handaispoke" && (
              <>
                {/* HandAISpoke Bridge URL */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="handaispoke-url" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                    <span>HandAISpoke API URL</span>
                    <span className="text-slate-500 font-normal">Cloudflare Tunnel / Local Bridge</span>
                  </label>
                  <div className="relative flex items-center">
                    <Link className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                    <input
                      id="handaispoke-url"
                      type="text"
                      placeholder="https://handaispokeapi.thehandaiman.com"
                      value={handaiSpokeUrl}
                      onChange={(e) => setHandaiSpokeUrl(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                    />
                  </div>
                </div>

                {/* HandAISpoke Token */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="handaispoke-token" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                    <span>X-HandAISpoke-Bridge-Token</span>
                    {hasHandaiSpokeToken && <span className="text-emerald-400 font-bold text-[9px] font-mono">🔒 Saved</span>}
                  </label>
                  <div className="relative flex items-center">
                    <KeyRound className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                    <input
                      id="handaispoke-token"
                      type="password"
                      placeholder={hasHandaiSpokeToken ? "••••••••" : "Enter local bridge token"}
                      value={handaiSpokeToken}
                      onChange={(e) => setHandaiSpokeToken(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Action Status Output */}
          {handaiSpokeSuccessMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2 animate-pulse">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{handaiSpokeSuccessMsg}</span>
            </div>
          )}

          {handaiSpokeTestResult && (
            <div className={`p-3 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2.5 ${
              handaiSpokeTestResult.success 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            }`} id="handaispoke-test-result">
              {handaiSpokeTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <div>
                <span className="font-bold">{handaiSpokeTestResult.success ? "Bridge Connected! " : "Connection Failed: "}</span>
                <span>{handaiSpokeTestResult.message}</span>
              </div>
            </div>
          )}

          {whisperXTestResult && (
            <div className={`p-3 rounded-xl border text-[11px] leading-relaxed flex flex-col gap-1.5 ${
              whisperXTestResult.success 
                ? "bg-teal-500/10 border-teal-500/20 text-teal-400" 
                : "bg-amber-500/10 border-amber-500/20 text-amber-400"
            }`} id="whisperx-test-result">
              <div className="flex items-start gap-2.5">
                {whisperXTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-teal-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                )}
                <div>
                  <span className="font-bold">{whisperXTestResult.success ? "WhisperX STT Ready! " : "WhisperX Check: "}</span>
                  <span>{whisperXTestResult.message}</span>
                </div>
              </div>
              {whisperXTestResult.details && (
                <pre className="text-[10px] font-mono bg-slate-950/80 p-2 rounded border border-slate-900/60 overflow-x-auto max-h-[140px] text-slate-300">
                  {JSON.stringify(whisperXTestResult.details, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-2 gap-3 border-t border-slate-800/40 mt-auto">
            <span className="text-[10px] text-slate-500 italic max-w-[200px]">
              {sttEngine === "handaispoke" 
                ? "Transcription and alignment are processed locally/via your private API bridge." 
                : "Audio chunks are securely processed via Gemini cloud speech models."}
            </span>
            <div className="flex gap-2">
              {sttEngine === "handaispoke" && (
                <>
                  <button
                    onClick={handleTestHandaiSpoke}
                    disabled={!handaiSpokeUrl.trim() || isHandaiSpokeTesting || isWhisperXTesting}
                    className="px-3 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {isHandaiSpokeTesting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                        <span>Testing...</span>
                      </>
                    ) : (
                      <span>Test Bridge</span>
                    )}
                  </button>
                  <button
                    onClick={handleTestWhisperX}
                    disabled={!handaiSpokeUrl.trim() || isHandaiSpokeTesting || isWhisperXTesting}
                    className="px-3 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-emerald-400 text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
                    title="Sends a tiny silent chunk to test if WhisperX/STT endpoint is loaded & works"
                  >
                    {isWhisperXTesting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                        <span>Testing STT...</span>
                      </>
                    ) : (
                      <span>Test WhisperX (STT)</span>
                    )}
                  </button>
                </>
              )}
              <button
                onClick={handleSaveHandaiSpoke}
                disabled={isHandaiSpokeSaving}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isHandaiSpokeSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Engine Settings</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
