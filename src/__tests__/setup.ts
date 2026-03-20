import "@testing-library/jest-dom";

// Mock AudioContext — not available in jsdom
Object.defineProperty(window, "AudioContext", {
  writable: true,
  value: class MockAudioContext {
    createAnalyser() {
      return { fftSize: 256, getFloatTimeDomainData: () => {} };
    }
    createBufferSource() {
      return { connect: () => {}, start: () => {}, buffer: null, onended: null };
    }
    createMediaStreamDestination() {
      return { stream: null };
    }
    resume() {
      return Promise.resolve();
    }
    decodeAudioData(_: ArrayBuffer, success: (b: AudioBuffer) => void) {
      success({ duration: 0 } as AudioBuffer);
    }
    get state() {
      return "running";
    }
    get currentTime() {
      return 0;
    }
  },
});

// Mock MediaRecorder — not available in jsdom
global.MediaRecorder = class MockMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  start() {}
  stop() {}
  ondataavailable = null;
  onstop = null;
} as unknown as typeof MediaRecorder;
