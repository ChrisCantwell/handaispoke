import { useState } from "react";
import { AudioSegment } from "../types";
import { Play, Pause, Trash2, CheckCircle2, XCircle, Edit, Scissors, Undo2, Sparkles } from "lucide-react";

interface SegmentListProps {
  segments: AudioSegment[];
  originalDuration: number;
  onUpdateSegment: (updated: AudioSegment) => void;
  onAddSegment: (newSeg: AudioSegment) => void;
  onDeleteSegment: (id: string) => void;
  onPlaySegmentOnly: (start: number, end: number) => void;
  currentlyAuditioning: { start: number; end: number } | null;
  onPatchSegment: (seg: AudioSegment) => void;
  onRemovePatch: (seg: AudioSegment) => void;
}

export default function SegmentList({
  segments,
  originalDuration,
  onUpdateSegment,
  onAddSegment,
  onDeleteSegment,
  onPlaySegmentOnly,
  currentlyAuditioning,
  onPatchSegment,
  onRemovePatch,
}: SegmentListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editTranscript, setEditTranscript] = useState("");

  const startEdit = (seg: AudioSegment) => {
    setEditingId(seg.id);
    setEditStart(seg.start.toFixed(2));
    setEditEnd(seg.end.toFixed(2));
    setEditTranscript(seg.transcript);
  };

  const saveEdit = (seg: AudioSegment) => {
    const s = parseFloat(editStart);
    const e = parseFloat(editEnd);

    if (isNaN(s) || isNaN(e) || s < 0 || e > originalDuration || s >= e) {
      alert("Invalid start or end times. Must be numbers, within original audio bounds, and start must be less than end.");
      return;
    }

    onUpdateSegment({
      ...seg,
      start: s,
      end: e,
      transcript: editTranscript,
    });
    setEditingId(null);
  };

  const createManualSegment = () => {
    const start = 0;
    const end = Math.min(originalDuration, 5);
    const newSeg: AudioSegment = {
      id: `manual_${Date.now()}`,
      start,
      end,
      transcript: "New manual edit block...",
      keep: true,
    };
    onAddSegment(newSeg);
    startEdit(newSeg);
  };

  const toggleKeep = (seg: AudioSegment) => {
    onUpdateSegment({
      ...seg,
      keep: !seg.keep,
    });
  };

  const isCurrentAudition = (seg: AudioSegment) => {
    if (!currentlyAuditioning) return false;
    return Math.abs(currentlyAuditioning.start - seg.start) < 0.05 && Math.abs(currentlyAuditioning.end - seg.end) < 0.05;
  };

  return (
    <div id="segment-list-container" className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
            Audio Takes & Splices
          </h2>
          <p className="text-xs text-slate-400">
            Preview, toggle, or fine-tune individual lines and takes below.
          </p>
        </div>

        <button
          id="add-custom-slice-btn"
          onClick={createManualSegment}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer"
        >
          <Scissors className="w-3.5 h-3.5 text-slate-400" />
          <span>Add Custom Slice</span>
        </button>
      </div>

      <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto pr-1">
        {segments.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
            No cuts or takes defined yet. Upload audio and run analysis to populate.
          </div>
        ) : (
          segments.map((seg) => {
            const isEditing = editingId === seg.id;
            const isAuditioning = isCurrentAudition(seg);

            return (
              <div
                key={seg.id}
                className={`p-4 rounded-xl border transition-all flex flex-col gap-3 ${
                  seg.keep
                    ? "bg-slate-900/40 border-emerald-950/40 hover:border-emerald-900/60"
                    : "bg-slate-900/10 border-slate-900 hover:border-slate-800/60 opacity-65"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      id={`audition-btn-${seg.id}`}
                      onClick={() => onPlaySegmentOnly(seg.start, seg.end)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all ${
                        isAuditioning
                          ? "bg-emerald-500 text-slate-950 animate-pulse"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                      }`}
                      title={isAuditioning ? "Stop audition" : "Audition this segment"}
                    >
                      {isAuditioning ? (
                        <Pause className="w-3.5 h-3.5 fill-slate-950" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>

                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium text-slate-300">
                          {seg.start.toFixed(2)}s – {seg.end.toFixed(2)}s
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          ({(seg.end - seg.start).toFixed(2)}s)
                        </span>
                      </div>
                      {seg.isPatched && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase tracking-wider">
                            🎙️ AI Voice Patched
                          </span>
                          <button
                            onClick={() => onRemovePatch(seg)}
                            className="inline-flex items-center gap-1 text-[9px] text-amber-500 hover:text-amber-400 font-mono font-medium cursor-pointer transition-colors"
                            title="Remove AI vocal patch and restore original"
                          >
                            <Undo2 className="w-2.5 h-2.5" />
                            <span>Restore Original</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {seg.keep && !seg.isPatched && (
                      <button
                        id={`patch-segment-${seg.id}`}
                        onClick={() => onPatchSegment(seg)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-emerald-400 text-[11px] font-semibold rounded-lg cursor-pointer transition-all"
                        title="Patch this segment with cloned AI Voice"
                      >
                        <Sparkles className="w-3 h-3 text-emerald-400" />
                        <span>AI Patch</span>
                      </button>
                    )}

                    <button
                      id={`toggle-keep-${seg.id}`}
                      onClick={() => toggleKeep(seg)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${
                        seg.keep
                          ? "bg-emerald-950/60 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-900/40"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700/60"
                      }`}
                    >
                      {seg.keep ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Keeping Take</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-slate-500" />
                          <span>Discarded</span>
                        </>
                      )}
                    </button>

                    <button
                      id={`edit-segment-${seg.id}`}
                      onClick={() => (isEditing ? saveEdit(seg) : startEdit(seg))}
                      className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded cursor-pointer"
                      title={isEditing ? "Save edits" : "Edit timing / transcript"}
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>

                    <button
                      id={`delete-segment-${seg.id}`}
                      onClick={() => onDeleteSegment(seg.id)}
                      className="p-1.5 hover:bg-red-950/40 text-slate-500 hover:text-red-400 rounded cursor-pointer"
                      title="Delete slice"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                    <div className="col-span-3 flex flex-col gap-1.5">
                      <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Start (secs)</label>
                      <input
                        type="text"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100 font-mono focus:border-slate-700 focus:outline-none"
                      />
                    </div>
                    <div className="col-span-3 flex flex-col gap-1.5">
                      <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">End (secs)</label>
                      <input
                        type="text"
                        value={editEnd}
                        onChange={(e) => setEditEnd(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100 font-mono focus:border-slate-700 focus:outline-none"
                      />
                    </div>
                    <div className="col-span-6 flex flex-col gap-1.5">
                      <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Transcript</label>
                      <input
                        type="text"
                        value={editTranscript}
                        onChange={(e) => setEditTranscript(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100 focus:border-slate-700 focus:outline-none"
                      />
                    </div>
                    <div className="col-span-12 flex justify-end gap-2 mt-1">
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(seg)}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold rounded"
                      >
                        Apply Splicing
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={`text-xs ${seg.keep ? "text-slate-300" : "text-slate-500 line-through italic"}`}>
                    "{seg.transcript}"
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
