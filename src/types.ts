export interface AudioSegment {
  id: string;
  start: number;
  end: number;
  transcript: string;
  keep: boolean;
  customBuffer?: AudioBuffer; // holds custom AI-generated vocal patch
  isPatched?: boolean;
}

export interface AnalysisResult {
  keeps: {
    start: number;
    end: number;
    transcript: string;
  }[];
}
