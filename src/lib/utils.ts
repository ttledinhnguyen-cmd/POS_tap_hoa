import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Phát âm thanh "beep" khi quét mã thành công.
 * Dùng Web Audio API thay vì file mp3 để giảm bundle.
 */
let audioCtx: AudioContext | null = null;
export function beep(frequency = 880, durationMs = 80) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioCtx.currentTime + durationMs / 1000,
    );
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {
    // Im lặng nếu trình duyệt chưa cho phép audio
  }
}

/**
 * Rung điện thoại — phản hồi haptic
 */
export function vibrate(pattern: number | number[] = 30) {
  if ("vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
