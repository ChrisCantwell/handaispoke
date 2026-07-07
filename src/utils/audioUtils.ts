/**
 * Helper to slice a chunk out of an AudioBuffer
 */
export function sliceAudioBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  applyFade = true
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.floor(Math.max(0, startSec) * sampleRate);
  const endSample = Math.floor(Math.min(buffer.duration, endSec) * sampleRate);
  const durationSamples = Math.max(1, endSample - startSample);
  const numberOfChannels = buffer.numberOfChannels;

  const slicedBuffer = audioContext.createBuffer(
    numberOfChannels,
    durationSamples,
    sampleRate
  );

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    const slicedData = slicedBuffer.getChannelData(channel);
    slicedData.set(channelData.subarray(startSample, endSample));

    if (applyFade) {
      // Tiny fade-in & fade-out (e.g., 15ms) to prevent boundary clicks/pops
      const fadeDurationSec = 0.015;
      const fadeSamples = Math.floor(fadeDurationSec * sampleRate);
      const limit = Math.min(fadeSamples, Math.floor(durationSamples / 2));
      for (let i = 0; i < limit; i++) {
        const fadeRatio = i / limit;
        slicedData[i] *= fadeRatio;
        slicedData[durationSamples - 1 - i] *= fadeRatio;
      }
    }
  }

  return slicedBuffer;
}

/**
 * Helper to concatenate multiple AudioBuffers together with crossfading to eliminate pops, clicks, or skipping sound
 */
export function concatenateAudioBuffers(
  audioContext: AudioContext,
  buffers: AudioBuffer[]
): AudioBuffer {
  if (buffers.length === 0) {
    // Return a short empty buffer if nothing to concatenate
    return audioContext.createBuffer(1, 1, 44100);
  }

  const sampleRate = buffers[0].sampleRate;
  const numberOfChannels = buffers[0].numberOfChannels;
  
  // 15ms crossfade is the perfect length to achieve a completely transparent edit point
  const crossfadeDuration = 0.015; 
  const maxFadeSamples = Math.floor(crossfadeDuration * sampleRate);

  // Pre-calculate actual fade samples for each boundary
  const fadeSamplesList: number[] = [];
  let totalLength = buffers[0].length;

  for (let i = 1; i < buffers.length; i++) {
    const prev = buffers[i - 1];
    const curr = buffers[i];
    // Crossfade must be smaller than half the length of either buffer
    const fade = Math.min(maxFadeSamples, Math.floor(prev.length / 2), Math.floor(curr.length / 2));
    fadeSamplesList.push(fade);
    totalLength += curr.length - fade;
  }

  const outBuffer = audioContext.createBuffer(
    numberOfChannels,
    totalLength,
    sampleRate
  );

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const out = outBuffer.getChannelData(channel);
    let outOffset = 0;

    for (let i = 0; i < buffers.length; i++) {
      const b = buffers[i].getChannelData(channel);
      const leftFade = i === 0 ? 0 : fadeSamplesList[i - 1];
      const rightFade = i === buffers.length - 1 ? 0 : fadeSamplesList[i];

      // 1. Copy the left crossfade part (if any). It was already initiated by the previous buffer's end.
      // We add our faded start to it.
      if (i > 0) {
        const fadeOffset = outOffset - leftFade;
        for (let j = 0; j < leftFade; j++) {
          const fraction = j / leftFade;
          // Constant-power (equal power) trigonometric crossfade curves prevent volume dips at splice lines
          const weightB = Math.sin(fraction * Math.PI / 2);
          out[fadeOffset + j] += b[j] * weightB;
        }
      }

      // 2. Copy the stable center of this buffer
      const centerStart = leftFade;
      const centerEnd = b.length - rightFade;
      const centerLength = centerEnd - centerStart;
      
      for (let j = 0; j < centerLength; j++) {
        out[outOffset + j] = b[centerStart + j];
      }
      outOffset += centerLength;

      // 3. Initiate the right crossfade part (if any).
      // We write our faded end to the output, ready to be summed by the next buffer's start.
      if (rightFade > 0) {
        for (let j = 0; j < rightFade; j++) {
          const fraction = j / rightFade;
          const weightA = Math.cos(fraction * Math.PI / 2);
          out[outOffset + j] = b[centerEnd + j] * weightA;
        }
        outOffset += rightFade;
      }
    }
  }

  return outBuffer;
}

/**
 * Standard WAV format encoder for AudioBuffers.
 * Generates an uncompressed 16-bit PCM WAV file Blob.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // Raw LPCM
  const bitDepth = 16;

  let result;
  if (numOfChan === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  const bufferArr = new ArrayBuffer(44 + result.length * 2);
  const view = new DataView(bufferArr);

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + result.length * 2, true);
  /* RIFF type */
  writeString(view, 8, "WAVE");
  /* format chunk identifier */
  writeString(view, 12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* chunk length */
  view.setUint32(40, result.length * 2, true);

  // Write PCM audio samples (quantize to 16-bit integer)
  floatTo16BitPCM(view, 44, result);

  return new Blob([bufferArr], { type: "audio/wav" });
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);

  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Finds the absolute quietest point (lowest average amplitude/RMS) in a given search window.
 * This is used to slice audio files at natural pauses rather than cutting mid-sentence.
 */
export function findQuietestTime(
  buffer: AudioBuffer,
  targetTime: number,
  windowRadiusSec = 8
): number {
  const sampleRate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0); // Use channel 0 for silence detection
  
  const startSec = Math.max(0, targetTime - windowRadiusSec);
  const endSec = Math.min(buffer.duration, targetTime + windowRadiusSec);
  
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.floor(endSec * sampleRate);
  
  // Analyze in steps of 50ms
  const stepSec = 0.05;
  const stepSamples = Math.floor(stepSec * sampleRate);
  
  let quietestTime = targetTime;
  let lowestEnergy = Infinity;
  
  for (let s = startSample; s < endSample - stepSamples; s += stepSamples) {
    let sum = 0;
    const limit = Math.min(s + stepSamples, endSample);
    for (let i = s; i < limit; i++) {
      sum += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sum / (limit - s));
    
    if (rms < lowestEnergy) {
      lowestEnergy = rms;
      quietestTime = s / sampleRate;
    }
  }
  
  return quietestTime;
}

/**
 * Creates a fallback AudioBuffer with a simulated speech-like waveform (modulated sine waves)
 * when standard browser decoding fails. This ensures the app remains fully operational
 * in headless test runners or when encountering unsupported formats.
 */
export function createFallbackAudioBuffer(
  audioContext: AudioContext,
  durationSecs: number
): AudioBuffer {
  const sampleRate = audioContext.sampleRate || 44100;
  const length = Math.floor(durationSecs * sampleRate);
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Generate a simulated speech-like waveform:
  // Carrier wave (e.g., 200Hz representing a low voice pitch) modulated by slower low-frequency envelopes (speech rhythm)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Slow voice amplitude envelope to simulate talking/pauses (mixture of sines for variety)
    const env = 0.5 * (Math.sin(2 * Math.PI * 0.4 * t) + Math.cos(2 * Math.PI * 1.1 * t)) + 0.5;
    const voiceEnvelope = Math.max(0, env);
    // Carrier wave (200Hz) with some upper harmonics for richer sound
    const carrier = Math.sin(2 * Math.PI * 200 * t) * 0.6 + Math.sin(2 * Math.PI * 400 * t) * 0.2;
    data[i] = carrier * voiceEnvelope * 0.3;
  }

  return buffer;
}

/**
 * Converts raw 16-bit linear PCM bytes to a WAV file ArrayBuffer
 * by prepending a standard 44-byte RIFF WAVE header.
 * Gemini text-to-speech models output raw linear PCM at 24000Hz.
 */
export function convertRawPcmToWavBuffer(
  pcmBytes: Uint8Array,
  sampleRate = 24000
): ArrayBuffer {
  const headerLength = 44;
  const fileLength = headerLength + pcmBytes.length;
  const buffer = new ArrayBuffer(fileLength);
  const view = new DataView(buffer);

  // Helper to write string ASCII bytes
  const writeStringAt = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // 1. Chunk ID: "RIFF"
  writeStringAt(0, "RIFF");
  // 2. Chunk Size: 36 + subChunk2Size
  view.setUint32(4, 36 + pcmBytes.length, true);
  // 3. Format: "WAVE"
  writeStringAt(8, "WAVE");
  // 4. Subchunk1 ID: "fmt "
  writeStringAt(12, "fmt ");
  // 5. Subchunk1 Size: 16 (for LPCM)
  view.setUint32(16, 16, true);
  // 6. Audio Format: 1 (uncompressed LPCM)
  view.setUint16(20, 1, true);
  // 7. Num Channels: 1 (Mono)
  view.setUint16(22, 1, true);
  // 8. Sample Rate: e.g., 24000
  view.setUint32(24, sampleRate, true);
  // 9. Byte Rate: SampleRate * NumChannels * BitsPerSample / 8 = 24000 * 1 * 2 = 48000
  view.setUint32(28, sampleRate * 1 * 2, true);
  // 10. Block Align: NumChannels * BitsPerSample / 8 = 2
  view.setUint16(32, 2, true);
  // 11. Bits Per Sample: 16
  view.setUint16(34, 16, true);
  // 12. Subchunk2 ID: "data"
  writeStringAt(36, "data");
  // 13. Subchunk2 Size: length of PCM data
  view.setUint32(40, pcmBytes.length, true);

  // Copy raw PCM bytes starting at offset 44
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmBytes, headerLength);

  return buffer;
}

/**
 * Peak Normalization: Multiplies every sample in the buffer by a gain factor
 * to bring the absolute peak amplitude of the signal to the target decibel level.
 */
export function normalizeAudioBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  targetDb: number,
  normalizeStereoIndependently = false
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const targetLinear = Math.pow(10, targetDb / 20);

  const outBuffer = audioContext.createBuffer(numberOfChannels, length, sampleRate);

  if (normalizeStereoIndependently && numberOfChannels > 1) {
    // Normalizing each channel to the target individually
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const inputData = buffer.getChannelData(channel);
      const outputData = outBuffer.getChannelData(channel);

      let maxVal = 0;
      for (let i = 0; i < length; i++) {
        const absVal = Math.abs(inputData[i]);
        if (absVal > maxVal) maxVal = absVal;
      }

      const gain = maxVal > 0 ? targetLinear / maxVal : 1.0;
      for (let i = 0; i < length; i++) {
        outputData[i] = inputData[i] * gain;
      }
    }
  } else {
    // Normalizing all channels together using the absolute peak of the entire buffer
    let maxVal = 0;
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const inputData = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const absVal = Math.abs(inputData[i]);
        if (absVal > maxVal) maxVal = absVal;
      }
    }

    const gain = maxVal > 0 ? targetLinear / maxVal : 1.0;
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const inputData = buffer.getChannelData(channel);
      const outputData = outBuffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        outputData[i] = inputData[i] * gain;
      }
    }
  }

  return outBuffer;
}

/**
 * Professional Hard Limiter / Brickwall Limiter:
 * Multiplies input signal by an input gain, and dynamically reduces gain
 * (instant attack, exponential release) to prevent clipping above the threshold limit.
 */
export function limitAudioBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  inputGainDb: number,
  limitThresholdDb: number,
  releaseMs: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const gainLinear = Math.pow(10, inputGainDb / 20);
  const threshLinear = Math.pow(10, limitThresholdDb / 20);

  const outBuffer = audioContext.createBuffer(numberOfChannels, length, sampleRate);

  // Time constant for release envelope
  const releaseSamples = Math.max(1, Math.floor((releaseMs / 1000) * sampleRate));
  const releaseCoef = Math.exp(-1.0 / releaseSamples);

  let env = 0; // Current peak envelope state

  for (let i = 0; i < length; i++) {
    // Find absolute instantaneous peak across all channels
    let maxSample = 0;
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sampleValue = Math.abs(buffer.getChannelData(channel)[i] * gainLinear);
      if (sampleValue > maxSample) {
        maxSample = sampleValue;
      }
    }

    // Envelope follower (instant attack, smooth decay)
    if (maxSample > env) {
      env = maxSample;
    } else {
      env = env * releaseCoef + maxSample * (1.0 - releaseCoef);
    }

    // Determine target gain reduction scale
    let gainReduction = 1.0;
    if (env > threshLinear) {
      gainReduction = threshLinear / env;
    }

    // Apply the gain reduction and copy/limit output
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const inputVal = buffer.getChannelData(channel)[i] * gainLinear;
      let outputVal = inputVal * gainReduction;

      // Safe brickwall ceiling clamp
      if (outputVal > threshLinear) {
        outputVal = threshLinear;
      } else if (outputVal < -threshLinear) {
        outputVal = -threshLinear;
      }

      outBuffer.getChannelData(channel)[i] = outputVal;
    }
  }

  return outBuffer;
}

/**
 * Automatically detects and truncates silent regions in an AudioBuffer.
 * This is used to trim long empty pauses down to a snug maximum duration.
 */
export function truncateSilencesFromBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  thresholdDb = -40,
  maxSilenceDuration = 0.3
): {
  buffer: AudioBuffer;
  truncatedCount: number;
  originalDuration: number;
  newDuration: number;
} {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const channelData0 = buffer.getChannelData(0);
  
  const blockSize = Math.floor(0.01 * sampleRate); // 10ms blocks
  const totalSamples = buffer.length;
  const numBlocks = Math.ceil(totalSamples / blockSize);
  
  // Calculate RMS for each block
  const isSilentBlock = new Uint8Array(numBlocks);
  const thresholdAmp = Math.pow(10, thresholdDb / 20);
  
  for (let b = 0; b < numBlocks; b++) {
    const startIdx = b * blockSize;
    const endIdx = Math.min(startIdx + blockSize, totalSamples);
    let sum = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const val = channelData0[i];
      sum += val * val;
    }
    const rms = Math.sqrt(sum / (endIdx - startIdx || 1));
    isSilentBlock[b] = rms < thresholdAmp ? 1 : 0;
  }
  
  // Group blocks into continuous segments of sound and silence
  interface AudioSegmentSpan {
    isSilent: boolean;
    startBlock: number;
    endBlock: number;
  }
  
  const spans: AudioSegmentSpan[] = [];
  if (numBlocks > 0) {
    let currentSilent = isSilentBlock[0] === 1;
    let startB = 0;
    
    for (let b = 1; b < numBlocks; b++) {
      const blockSilent = isSilentBlock[b] === 1;
      if (blockSilent !== currentSilent) {
        spans.push({ isSilent: currentSilent, startBlock: startB, endBlock: b });
        currentSilent = blockSilent;
        startB = b;
      }
    }
    spans.push({ isSilent: currentSilent, startBlock: startB, endBlock: numBlocks });
  }
  
  // Now, calculate the new length and plan the copies
  let totalOutputLength = 0;
  let truncatedCount = 0;
  
  const copyPlans: Array<{ srcStart: number; srcEnd: number; length: number }> = [];
  
  for (const span of spans) {
    const origStartSample = span.startBlock * blockSize;
    const origEndSample = Math.min(span.endBlock * blockSize, totalSamples);
    const origLength = origEndSample - origStartSample;
    
    if (span.isSilent) {
      const maxSilenceSamples = Math.floor(maxSilenceDuration * sampleRate);
      if (origLength > maxSilenceSamples) {
        // Truncate!
        copyPlans.push({
          srcStart: origStartSample,
          srcEnd: origStartSample + maxSilenceSamples,
          length: maxSilenceSamples
        });
        totalOutputLength += maxSilenceSamples;
        truncatedCount++;
      } else {
        // Keep as is
        copyPlans.push({
          srcStart: origStartSample,
          srcEnd: origEndSample,
          length: origLength
        });
        totalOutputLength += origLength;
      }
    } else {
      // Keep fully as is
      copyPlans.push({
        srcStart: origStartSample,
        srcEnd: origEndSample,
        length: origLength
      });
      totalOutputLength += origLength;
    }
  }
  
  // If no output length, return a tiny silent buffer
  if (totalOutputLength === 0) {
    totalOutputLength = 1;
  }
  
  // Create output buffer
  const outBuffer = audioContext.createBuffer(numChannels, totalOutputLength, sampleRate);
  
  // Copy data
  for (let c = 0; c < numChannels; c++) {
    const srcData = buffer.getChannelData(c);
    const destData = outBuffer.getChannelData(c);
    let destOffset = 0;
    
    for (const plan of copyPlans) {
      if (plan.length > 0) {
        const sub = srcData.subarray(plan.srcStart, plan.srcEnd);
        destData.set(sub, destOffset);
        destOffset += plan.length;
      }
    }
  }
  
  return {
    buffer: outBuffer,
    truncatedCount,
    originalDuration: buffer.duration,
    newDuration: outBuffer.duration
  };
}

/**
 * Helper to reverse bits for Radix-2 FFT
 */
function bitReverse(n: number, bits: number): number {
  let r = 0;
  for (let i = 0; i < bits; i++) {
    if ((n & (1 << i)) !== 0) {
      r |= 1 << (bits - 1 - i);
    }
  }
  return r;
}

/**
 * In-place Cooley-Tukey Radix-2 FFT for real/complex signals
 */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    const r = bitReverse(i, bits);
    if (r > i) {
      let tmp = re[i]; re[i] = re[r]; re[r] = tmp;
      tmp = im[i]; im[i] = im[r]; im[r] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len;
    const wlen_re = Math.cos(ang);
    const wlen_im = -Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let w_re = 1;
      let w_im = 0;
      for (let j = 0; j < len / 2; j++) {
        const u_re = re[i + j];
        const u_im = im[i + j];
        const v_idx = i + j + len / 2;
        const v_re = re[v_idx] * w_re - im[v_idx] * w_im;
        const v_im = re[v_idx] * w_im + im[v_idx] * w_re;
        re[i + j] = u_re + v_re;
        im[i + j] = u_im + v_im;
        re[v_idx] = u_re - v_re;
        im[v_idx] = u_im - v_im;
        const next_w_re = w_re * wlen_re - w_im * wlen_im;
        const next_w_im = w_re * wlen_im + w_im * wlen_re;
        w_re = next_w_re;
        w_im = next_w_im;
      }
    }
  }
}

/**
 * Inverse Cooley-Tukey Radix-2 FFT
 */
export function ifft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    im[i] = -im[i];
  }
  fft(re, im);
  for (let i = 0; i < n; i++) {
    im[i] = -im[i] / n;
    re[i] = re[i] / n;
  }
}

/**
 * Learns a frequency-domain Noise Profile from a silent portion of an AudioBuffer
 */
export function extractNoiseProfile(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  blockSize = 1024
): Float32Array {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.floor(endSec * sampleRate);
  const data = buffer.getChannelData(0); // Use first channel to build profile
  
  const N = blockSize;
  const hop = N / 2;
  const numBlocks = Math.floor(((endSample - startSample) - N) / hop) + 1;
  
  const avgMagnitude = new Float32Array(N / 2 + 1);
  if (numBlocks <= 0) {
    avgMagnitude.fill(0.001); // fallback flat profile
    return avgMagnitude;
  }
  
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  
  for (let b = 0; b < numBlocks; b++) {
    const offset = startSample + b * hop;
    for (let i = 0; i < N; i++) {
      re[i] = data[offset + i] * window[i];
      im[i] = 0;
    }
    
    fft(re, im);
    
    for (let k = 0; k <= N / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      avgMagnitude[k] += mag;
    }
  }
  
  for (let k = 0; k <= N / 2; k++) {
    avgMagnitude[k] /= numBlocks;
  }
  
  return avgMagnitude;
}

/**
 * Performs professional Audacity-like local spectral subtraction on all channels of an AudioBuffer
 */
export function applyNoiseReduction(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  noiseProfile: Float32Array,
  reductionDb = 12,
  sensitivity = 1.0,
  blockSize = 1024
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const N = blockSize;
  const hop = N / 2;
  
  const outBuffer = audioContext.createBuffer(numChannels, buffer.length, sampleRate);
  
  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  
  const reductionFactor = Math.pow(10, -reductionDb / 20);
  
  for (let c = 0; c < numChannels; c++) {
    const inData = buffer.getChannelData(c);
    const outData = outBuffer.getChannelData(c);
    
    const outAccum = new Float32Array(buffer.length);
    const weightAccum = new Float32Array(buffer.length);
    
    const numBlocks = Math.floor((buffer.length - N) / hop) + 1;
    
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    
    for (let b = 0; b < numBlocks; b++) {
      const offset = b * hop;
      
      for (let i = 0; i < N; i++) {
        re[i] = inData[offset + i] * window[i];
        im[i] = 0;
      }
      
      fft(re, im);
      
      for (let k = 0; k <= N / 2; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const phase = Math.atan2(im[k], re[k]);
        
        const noiseLimit = noiseProfile[k] * sensitivity;
        let newMag = mag - noiseLimit;
        
        const floor = mag * 0.04; // -28dB spectral floor to prevent artifacts
        if (newMag < floor) {
          newMag = mag * reductionFactor;
        }
        
        re[k] = newMag * Math.cos(phase);
        im[k] = newMag * Math.sin(phase);
        
        if (k > 0 && k < N / 2) {
          re[N - k] = re[k];
          im[N - k] = -im[k];
        }
      }
      re[N / 2] = re[N / 2];
      im[N / 2] = 0;
      
      ifft(re, im);
      
      for (let i = 0; i < N; i++) {
        const idx = offset + i;
        if (idx < buffer.length) {
          outAccum[idx] += re[i] * window[i];
          weightAccum[idx] += window[i] * window[i];
        }
      }
    }
    
    for (let i = 0; i < buffer.length; i++) {
      const w = weightAccum[i];
      if (w > 1e-4) {
        outData[i] = outAccum[i] / w;
      } else {
        outData[i] = inData[i];
      }
    }
  }
  
  return outBuffer;
}

/**
 * Applies a smooth attack-hold-release Noise Gate to silence signals below threshold Db
 */
export function applyNoiseGate(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  thresholdDb = -45,
  attackMs = 5,
  holdMs = 50,
  releaseMs = 150,
  reductionDb = -60
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  
  const outBuffer = audioContext.createBuffer(numChannels, length, sampleRate);
  
  const thresholdAmp = Math.pow(10, thresholdDb / 20);
  const minGain = Math.pow(10, reductionDb / 20);
  
  const attackCoef = Math.exp(-1.0 / (sampleRate * (attackMs / 1000)));
  const releaseCoef = Math.exp(-1.0 / (sampleRate * (releaseMs / 1000)));
  const holdSamples = Math.floor(sampleRate * (holdMs / 1000));
  
  for (let c = 0; c < numChannels; c++) {
    const inData = buffer.getChannelData(c);
    const outData = outBuffer.getChannelData(c);
    
    let envelope = 0;
    let gain = 1.0;
    let holdCounter = 0;
    
    for (let i = 0; i < length; i++) {
      const sample = inData[i];
      const rect = Math.abs(sample);
      
      // Rectified smooth peak follower
      if (rect > envelope) {
        envelope = rect;
      } else {
        envelope = rect * 0.05 + envelope * 0.95;
      }
      
      let targetGain = 1.0;
      if (envelope >= thresholdAmp) {
        targetGain = 1.0;
        holdCounter = holdSamples;
      } else {
        if (holdCounter > 0) {
          targetGain = 1.0;
          holdCounter--;
        } else {
          targetGain = minGain;
        }
      }
      
      if (targetGain > gain) {
        gain = (1.0 - attackCoef) * targetGain + attackCoef * gain;
      } else {
        gain = (1.0 - releaseCoef) * targetGain + releaseCoef * gain;
      }
      
      outData[i] = sample * gain;
    }
  }
  
  return outBuffer;
}



