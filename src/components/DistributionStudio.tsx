import React, { useState, useEffect } from "react";
import {
  Globe,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Clock,
  HelpCircle,
  FileAudio,
  Settings,
  Clipboard,
  ExternalLink,
  ChevronRight,
  Info,
  KeyRound,
  User,
  LayoutGrid
} from "lucide-react";
import { audioBufferToWav } from "../utils/audioUtils";

interface DistributionStudioProps {
  audioBuffer: AudioBuffer | null;
  originalFile: {
    name: string;
    type: string;
    base64?: string;
  } | null;
  addLog: (
    level: "info" | "warn" | "error" | "success",
    category: "click" | "action" | "api" | "browser" | "server",
    message: string,
    details?: any
  ) => void;
}

interface WordPressResponse {
  success: boolean;
  mediaId: number;
  sourceUrl: string;
  link: string;
  title: string;
  mimeType: string;
}

export default function DistributionStudio({
  audioBuffer,
  originalFile,
  addLog
}: DistributionStudioProps) {
  // WordPress Connection Credentials State
  const [wpUrl, setWpUrl] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [appPassword, setAppPassword] = useState<string>("");
  const [hasStoredPassword, setHasStoredPassword] = useState<boolean>(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(false);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);

  // Connection Test State
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; user?: any } | null>(null);

  // Success message feedback state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Post Draft creation state
  const [createDraftPost, setCreateDraftPost] = useState<boolean>(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState<boolean>(false);
  const [draftPostStatus, setDraftPostStatus] = useState<{ id: number; link: string; title: string } | null>(null);

  const triggerSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage((prev) => prev === msg ? null : prev);
    }, 5000);
  };

  // Media Meta state
  const [mediaTitle, setMediaTitle] = useState<string>("");
  const [mediaFileName, setMediaFileName] = useState<string>("");

  // UI state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<WordPressResponse | null>(null);
  const [copiedEmbed, setCopiedEmbed] = useState<boolean>(false);

  // Load saved credentials from secure server store
  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoadingSettings(true);
      try {
        const res = await fetch("/api/wordpress/settings");
        if (res.ok) {
          const data = await res.json();
          setWpUrl(data.wpUrl || "");
          setUsername(data.username || "");
          if (data.hasAppPassword) {
            setAppPassword("••••••••••••••••••••••••");
            setHasStoredPassword(true);
          } else {
            setAppPassword("");
            setHasStoredPassword(false);
          }
        }
      } catch (err: any) {
        addLog("error", "browser", `Failed to fetch WordPress configuration: ${err.message}`);
      } finally {
        setIsLoadingSettings(false);
      }
    };
    fetchSettings();
  }, []);

  // Update media metadata defaults when a new originalFile is set
  useEffect(() => {
    if (originalFile) {
      const cleanName = originalFile.name.replace(/\.[^/.]+$/, "");
      setMediaTitle(`${cleanName} (Vocal Cleaned)`);
      setMediaFileName(`${cleanName}_processed.wav`);
    } else {
      setMediaTitle("Podcast Take (Vocal Cleaned)");
      setMediaFileName("podcast_processed.wav");
    }
  }, [originalFile]);

  // Handle saving credentials to secure server store
  const saveCredentials = async () => {
    setIsSavingSettings(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/wordpress/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          wpUrl: wpUrl.trim(),
          username: username.trim(),
          appPassword: appPassword.trim()
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Failed with status code ${res.status}`);
      }

      const data = await res.json();
      setWpUrl(data.wpUrl);
      setUsername(data.username);
      if (data.hasAppPassword) {
        setAppPassword("••••••••••••••••••••••••");
        setHasStoredPassword(true);
      }
      addLog("success", "action", "WordPress connection settings saved securely on server config store.");
      triggerSuccess("Connection settings saved securely on the server!");
    } catch (e: any) {
      setErrorMsg(`Failed to save configuration: ${e.message}`);
      addLog("error", "browser", `Failed to save credentials: ${e.message}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Test WordPress Connection helper
  const testConnection = async () => {
    setIsTestingConnection(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/wordpress/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          wpUrl: wpUrl.trim(),
          username: username.trim(),
          appPassword: appPassword.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          success: true,
          message: `Connected successfully! Authorized as user: "${data.user.name}"`,
          user: data.user
        });
        addLog("success", "api", `WordPress credentials verified as: ${data.user.name}`);
        triggerSuccess(`WordPress connection verified! Logged in as ${data.user.name}.`);
      } else {
        setTestResult({
          success: false,
          message: data.error || `Authentication failed (HTTP ${res.status})`
        });
        addLog("error", "api", `WordPress connection test failed: ${data.error}`);
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Network failure connecting to server: ${err.message}`
      });
      addLog("error", "browser", `WordPress connection validation crashed: ${err.message}`);
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Draft Post helper
  const handleCreateDraftPost = async (mediaUrl: string, mediaId: number, title: string) => {
    setIsCreatingDraft(true);
    setDraftPostStatus(null);
    try {
      const res = await fetch("/api/wordpress/create-post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mediaUrl,
          mediaId,
          title,
          summary: `Professional vocal master processed and published to WordPress. Title: ${title}.`
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Status ${res.status}`);
      }

      const data = await res.json();
      setDraftPostStatus({
        id: data.postId,
        link: data.link,
        title: data.title
      });
      addLog("success", "api", `WordPress draft post built successfully! ID #${data.postId}`);
      triggerSuccess(`Draft episode post created successfully! Post ID: #${data.postId}`);
    } catch (err: any) {
      addLog("error", "api", `Failed to build WordPress episode draft post: ${err.message}`);
      setErrorMsg(`Audio uploaded successfully, but draft post build failed: ${err.message}`);
    } finally {
      setIsCreatingDraft(false);
    }
  };

  // Convert current audioBuffer to WAV and upload via backend proxy
  const handleWordPressUpload = async () => {
    if (!audioBuffer) return;
    setIsUploading(true);
    setUploadStatus("Encoding audio to WAV format...");
    setErrorMsg(null);
    setSuccessData(null);
    setDraftPostStatus(null);

    try {
      // 1. Generate standard WAV Blob from the local audioBuffer
      const wavBlob = audioBufferToWav(audioBuffer);
      
      setUploadStatus("Reading audio binary data...");
      
      // 2. Read Blob as Base64 to transfer to Express backend safely
      const reader = new FileReader();
      reader.readAsDataURL(wavBlob);
      
      reader.onloadend = async () => {
        const audioBase64 = reader.result as string;
        
        setUploadStatus("Uploading media to WordPress REST API...");
        addLog("info", "api", "Initiating proxy WordPress REST API upload request");

        try {
          const response = await fetch("/api/wordpress/upload", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              audioBase64,
              fileName: mediaFileName.trim() || "audio.wav",
              title: mediaTitle.trim() || "Vocal Match Audio Take"
            })
          });

          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `Upload failed with status code ${response.status}`);
          }

          const resData: WordPressResponse = await response.json();
          setSuccessData(resData);
          addLog("success", "action", `WordPress upload completed! URL: ${resData.sourceUrl}`);
          triggerSuccess("Audio uploaded successfully to WordPress Media Library!");

          if (createDraftPost) {
            setUploadStatus("Creating WordPress Draft Episode Post...");
            await handleCreateDraftPost(resData.sourceUrl, resData.mediaId, mediaTitle);
          }
        } catch (uploadErr: any) {
          setErrorMsg(uploadErr.message || "An error occurred during WordPress transmission.");
          addLog("error", "api", `WordPress transmission failed: ${uploadErr.message}`);
        } finally {
          setIsUploading(false);
          setUploadStatus("");
        }
      };

    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during audio WAV generation.");
      addLog("error", "browser", `WAV build failed: ${err.message}`);
      setIsUploading(false);
      setUploadStatus("");
    }
  };

  // Copy standard HTML embed block to clipboard
  const handleCopyEmbed = (url: string) => {
    const embedCode = `<audio controls src="${url}"></audio>`;
    navigator.clipboard.writeText(embedCode);
    setCopiedEmbed(true);
    addLog("info", "action", "WordPress HTML embed code copied to clipboard.");
    setTimeout(() => setCopiedEmbed(false), 2000);
  };

  const isFormValid = wpUrl.trim() && username.trim() && appPassword.trim() && audioBuffer;

  return (
    <div className="flex flex-col gap-6 p-6 min-h-[calc(100vh-140px)] bg-slate-950 text-slate-100" id="distribution-studio">
      
      {/* Success Notification Alert */}
      {successMessage && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/35 text-emerald-400 rounded-xl text-xs flex items-center justify-between gap-3 animate-fade-in" id="dist-success-alert">
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

      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6">
        
        {/* Left Column: Media File Details & Credentials */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Workspace Title Card */}
          <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm shadow-xl flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-100 tracking-tight flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                Distribution Studio
              </h2>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-widest">
                  WordPress REST API
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              Distribute your cleaned podcast, voiceovers, or speech-repaired audio directly to your WordPress Site Media Library using secure application passwords.
            </p>
          </div>

          {/* Credentials Form Card */}
          <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800/80 shadow-2xl flex flex-col gap-4">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-emerald-400" />
                WordPress Connection Settings
              </span>
              <span className="text-[9px] text-emerald-500/70 lowercase font-mono">
                Credentials saved server-side only
              </span>
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Target Site URL */}
              <div className="flex flex-col gap-1.5 col-span-1 md:col-span-2">
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
                    className="w-full bg-slate-950 border border-slate-800/80 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                    id="wp-settings-url"
                  />
                </div>
              </div>

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
                    className="w-full bg-slate-950 border border-slate-800/80 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                    id="wp-settings-username"
                  />
                </div>
              </div>

              {/* Application Password */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                  <span>Application Password</span>
                  <span className="text-slate-500 font-normal">24 characters</span>
                </label>
                <div className="relative flex items-center">
                  <KeyRound className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                  <input
                    type="password"
                    placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800/80 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                    id="wp-settings-password"
                  />
                </div>
              </div>
            </div>

            {/* Test connection output block */}
            {testResult && (
              <div className={`p-3 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2.5 ${
                testResult.success 
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                  : "bg-rose-500/10 border-rose-500/20 text-rose-400"
              }`} id="wp-connection-test-result">
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <div>
                  <span className="font-bold">{testResult.success ? "Connection Verified! " : "Connection Failed: "}</span>
                  <span>{testResult.message}</span>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 gap-3">
              <span className="text-[10px] text-slate-500 italic max-w-[250px]">
                Passwords are never stored in browser cookies or localStorage.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={testConnection}
                  disabled={!wpUrl.trim() || !username.trim() || !appPassword.trim() || isTestingConnection}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  id="wp-btn-test-connection"
                >
                  {isTestingConnection ? "Testing..." : "Test WordPress Connection"}
                </button>
                <button
                  onClick={saveCredentials}
                  disabled={!wpUrl.trim() || !username.trim() || !appPassword.trim() || isSavingSettings}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  id="wp-btn-save-credentials"
                >
                  {isSavingSettings ? "Saving..." : "Save Credentials"}
                </button>
              </div>
            </div>
          </div>

          {/* Media Upload Settings Card */}
          <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800/80 shadow-2xl flex flex-col gap-4">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
              <FileAudio className="w-3.5 h-3.5 text-emerald-400" />
              WordPress Media Details
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  WordPress Media Title
                </label>
                <input
                  type="text"
                  placeholder="Vocal Cleaned Audio"
                  value={mediaTitle}
                  onChange={(e) => setMediaTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800/80 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                  id="wp-media-title"
                />
              </div>

              {/* Filename */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                  <span>Destination Filename</span>
                  <span className="text-slate-500 font-mono text-[9px] lowercase">Supports .wav or .mp3</span>
                </label>
                <input
                  type="text"
                  placeholder="podcast_clean.wav"
                  value={mediaFileName}
                  onChange={(e) => setMediaFileName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800/80 hover:border-slate-700 focus:border-emerald-500/50 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                  id="wp-media-filename"
                />
              </div>
            </div>

            {/* Production Readiness MIME Information banner */}
            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-900 flex gap-2.5 items-start">
              <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-400 font-sans leading-relaxed">
                <strong>MIME type enforcement</strong>: Files ending in <code>.mp3</code> are delivered with <code>audio/mpeg</code> headers. Files ending in <code>.wav</code> are delivered with <code>audio/wav</code> headers automatically.
              </p>
            </div>

            {/* Create Draft Episode Option Box */}
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-850 flex items-start gap-3">
              <input
                type="checkbox"
                id="wp-create-draft-toggle"
                checked={createDraftPost}
                onChange={(e) => setCreateDraftPost(e.target.checked)}
                className="w-4 h-4 rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40 mt-0.5 cursor-pointer"
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="wp-create-draft-toggle" className="text-xs font-bold text-slate-200 cursor-pointer">
                  Create Draft Episode Post in WordPress
                </label>
                <p className="text-[10px] text-slate-500 leading-normal">
                  If selected, an empty WordPress post draft will automatically be created in the background, embedding this audio track in a clean Gutenberg audio block.
                </p>
              </div>
            </div>

            {/* Active Buffer Metadata Preview */}
            {audioBuffer ? (
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <FileAudio className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-slate-200">Active Audio Track Loaded</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      WAV Format • {audioBuffer.sampleRate} Hz • {audioBuffer.numberOfChannels} {audioBuffer.numberOfChannels === 1 ? 'Channel' : 'Channels'}
                    </span>
                  </div>
                </div>
                <div className="text-right flex flex-col gap-0.5 font-mono text-[10px] text-slate-400">
                  <div className="flex items-center gap-1.5 justify-end">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-bold text-emerald-400">{audioBuffer.duration.toFixed(2)}s</span>
                  </div>
                  <span>~{(audioBuffer.duration * audioBuffer.sampleRate * 2 * audioBuffer.numberOfChannels / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-rose-500/5 rounded-xl border border-rose-500/15 text-center text-xs text-rose-400 flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>Please upload, record, or generate an audio track first to allow uploading to WordPress.</span>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="p-4 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-xl text-xs flex items-start gap-2.5 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">WordPress Upload Failed: </span>
                  <span>{errorMsg}</span>
                </div>
              </div>
            )}

            {/* Submit Upload Trigger Button */}
            <button
              onClick={handleWordPressUpload}
              disabled={!isFormValid || isUploading}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-lg shadow-emerald-500/10 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
              id="wp-btn-upload-submit"
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-slate-950" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>{uploadStatus}</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Upload to WordPress Media Library</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: WordPress Response Output & Instructions */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Upload Success Details Container */}
          {successData && (
            <div className="p-6 bg-emerald-500/5 rounded-2xl border border-emerald-500/20 shadow-2xl flex flex-col gap-4 animate-fade-in" id="wp-upload-success-panel">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-xs font-bold text-emerald-400 font-sans">Successfully Distributed!</h3>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Your audio track has been catalogued in your WordPress media archive.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 bg-slate-950/80 p-4 rounded-xl border border-slate-800/80 font-mono text-[10px] text-slate-400 leading-relaxed">
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-500">Attachment ID:</span>
                  <span className="text-slate-200 font-bold">#{successData.mediaId}</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-500">Media Title:</span>
                  <span className="text-slate-200 truncate max-w-[200px]">{successData.title}</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-500">MIME Type:</span>
                  <span className="text-emerald-500 font-mono font-medium">{successData.mimeType}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500">Source URL:</span>
                  <span className="text-emerald-400 break-all select-all leading-tight text-[9px] bg-slate-950 p-2 rounded border border-slate-900/60 mt-1">
                    {successData.sourceUrl}
                  </span>
                </div>
              </div>

              {/* Action Buttons for Media Links */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(successData.sourceUrl);
                    addLog("info", "action", "WordPress direct audio URL copied.");
                    triggerSuccess("WordPress direct audio URL copied to clipboard!");
                  }}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-200 rounded-lg transition-all font-semibold"
                  title="Copy Audio URL"
                >
                  <span>Copy URL</span>
                </button>
                <a
                  href={successData.link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-200 rounded-lg transition-all font-semibold"
                  title="View Media Attachment details in WordPress"
                >
                  <span>Open Item</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
                <a
                  href={successData.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-200 rounded-lg transition-all font-semibold"
                  title="Listen directly to uploaded audio binary file"
                >
                  <span>Listen File</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
              </div>

              {/* Dynamic Draft post details if created or option to create manually after-the-fact */}
              {draftPostStatus ? (
                <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20 flex flex-col gap-2.5 animate-fade-in">
                  <span className="text-[9px] uppercase font-bold tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    WordPress Draft Post Created!
                  </span>
                  <div className="flex flex-col gap-1 text-[10px] font-mono text-slate-400 bg-slate-950/80 p-2.5 rounded border border-slate-900">
                    <div className="flex justify-between">
                      <span>Post ID:</span>
                      <span className="text-slate-200">#{draftPostStatus.id}</span>
                    </div>
                    <div className="flex justify-between mt-1 truncate">
                      <span>Post Title:</span>
                      <span className="text-slate-200 truncate max-w-[150px]">{draftPostStatus.title}</span>
                    </div>
                  </div>
                  <a
                    href={draftPostStatus.link}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-center font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-1.5"
                  >
                    <span>Edit Episode Draft Post</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : (
                <div className="p-4 bg-slate-900/40 rounded-xl border border-slate-800 flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-slate-300">Create Draft Episode Post?</span>
                  <p className="text-[9px] text-slate-500 leading-normal">
                    Didn't auto-create on upload? You can build and catalog a draft post for this audio now.
                  </p>
                  <button
                    onClick={() => handleCreateDraftPost(successData.sourceUrl, successData.mediaId, mediaTitle)}
                    disabled={isCreatingDraft}
                    className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    {isCreatingDraft ? "Building Draft..." : "Create Post Draft Now"}
                  </button>
                </div>
              )}

              {/* Embed Block Copy */}
              <div className="flex flex-col gap-2 bg-slate-950/40 p-4 rounded-xl border border-slate-800/40">
                <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">
                  HTML Embed Code
                </span>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    readOnly
                    value={`<audio controls src="${successData.sourceUrl}"></audio>`}
                    className="w-full bg-slate-950 border border-slate-900 text-[10px] font-mono text-slate-400 rounded-lg pl-3 pr-20 py-2 focus:outline-none"
                  />
                  <button
                    onClick={() => handleCopyEmbed(successData.sourceUrl)}
                    className="absolute right-1.5 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-[9px] text-emerald-400 font-bold border border-slate-800 rounded-md transition-all cursor-pointer"
                  >
                    {copiedEmbed ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Informational Guide Card */}
          <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col gap-4 text-xs text-slate-400 leading-relaxed">
            <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 uppercase tracking-wide text-[10px] border-b border-slate-800 pb-2">
              <Info className="w-4 h-4 text-emerald-400" />
              WordPress API Integration Guide
            </h4>
            <ul className="flex flex-col gap-3 list-decimal list-inside ml-1">
              <li>
                <strong>Generate App Password</strong>: In your WordPress dashboard, navigate to <em>Users &rarr; Profile</em>, scroll down to the "Application Passwords" section, write down "Vocal Studio", and click "Add New Application Password".
              </li>
              <li>
                <strong>Retrieve credentials</strong>: Copy the generated 24-character passcode (e.g. <code>xxxx xxxx xxxx xxxx xxxx xxxx</code>).
              </li>
              <li>
                <strong>Configure Settings</strong>: Paste the credentials into the panel on the left, save them, and write a custom title.
              </li>
              <li>
                <strong>Distribute with peace of mind</strong>: Click "Upload" to package your clean WAV/MP3 timeline and push it securely as media without leaving the app!
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
