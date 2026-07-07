import { useState, useRef, useEffect } from "react";
import { Mic, Square, Play, RotateCcw, AlertCircle, Volume2 } from "lucide-react";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
}

export default function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "finished">("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      stopTimer();
      stopAudioVisualization();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startTimer = () => {
    setRecordingTime(0);
    timerRef.current = window.setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startAudioVisualization = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      drawVolumeMeter();
    } catch (e) {
      console.error("Could not set up visualizer", e);
    }
  };

  const stopAudioVisualization = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
    }
  };

  const drawVolumeMeter = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (status === "finished") return;
      animationFrameRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 1.5;
      let barHeight;
      let x = 0;

      // Draw subtle background bars
      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        // Gradient color for vocal performance recording (emerald to cyan to blue)
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, "#10b981"); // emerald
        gradient.addColorStop(0.6, "#06b6d4"); // cyan
        gradient.addColorStop(1, "#3b82f6"); // blue

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

        x += barWidth;
      }
    };

    draw();
  };

  const startRecording = async () => {
    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const options = { mimeType: "audio/webm" };
      let recorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch (e) {
        // Fallback for browsers that do not support webm audio directly
        recorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        onRecordingComplete(audioBlob);
        setStatus("finished");
      };

      recorder.start(200); // chunk every 200ms
      setStatus("recording");
      startTimer();
      startAudioVisualization(stream);
    } catch (err: any) {
      console.error("Microphone access failed:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Microphone permission was denied. Please unlock permission in your browser address bar.");
      } else {
        setError(`Could not access microphone: ${err.message || err}`);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && status === "recording") {
      mediaRecorderRef.current.stop();
      stopTimer();
      stopAudioVisualization();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  return (
    <div id="audio-recorder-container" className="flex flex-col items-center justify-center p-6 bg-slate-900/60 rounded-xl border border-slate-800 backdrop-blur-md w-full max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-3 h-3 rounded-full ${status === "recording" ? "bg-red-500 animate-pulse" : "bg-slate-600"}`} />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">
          {status === "idle" && "Ready to record"}
          {status === "recording" && "Recording spoken word..."}
          {status === "finished" && "Recording complete"}
        </span>
      </div>

      <div className="text-4xl font-mono text-slate-100 font-semibold tracking-tight mb-4">
        {formatTime(recordingTime)}
      </div>

      {/* Visualizer Canvas */}
      <div className="w-full h-16 bg-slate-950/80 rounded-lg overflow-hidden border border-slate-800/80 mb-6 flex items-center justify-center relative">
        {status === "recording" ? (
          <canvas ref={canvasRef} className="w-full h-full" width={400} height={64} />
        ) : (
          <div className="text-slate-600 flex items-center gap-2 text-xs">
            <Volume2 className="w-4 h-4 opacity-40" />
            <span className="font-mono">Visualizer inactive</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-red-400 bg-red-950/40 p-3 rounded-lg border border-red-900/30 text-xs mb-4 w-full">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-4">
        {status === "idle" && (
          <button
            id="start-recording-btn"
            onClick={startRecording}
            className="flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white rounded-full font-medium transition-all shadow-lg shadow-red-900/30 cursor-pointer"
          >
            <Mic className="w-4 h-4" />
            <span>Record Performance</span>
          </button>
        )}

        {status === "recording" && (
          <button
            id="stop-recording-btn"
            onClick={stopRecording}
            className="flex items-center gap-2 px-5 py-3 bg-slate-100 hover:bg-white active:bg-slate-200 text-slate-950 rounded-full font-medium transition-all shadow-lg cursor-pointer"
          >
            <Square className="w-4 h-4 fill-slate-950" />
            <span>Stop Recording</span>
          </button>
        )}

        {status === "finished" && (
          <button
            id="retry-recording-btn"
            onClick={() => setStatus("idle")}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full text-xs font-medium transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Record Again</span>
          </button>
        )}
      </div>
    </div>
  );
}
