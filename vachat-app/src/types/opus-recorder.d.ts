declare module 'opus-recorder' {
  interface RecorderConfig {
    encoderPath?: string;
    mediaTrackConstraints?: MediaTrackConstraints | boolean;
    numberOfChannels?: number;
    encoderApplication?: number;
    encoderSampleRate?: number;
    encoderBitRate?: number;
    streamPages?: boolean;
    sourceNode?: MediaStreamAudioSourceNode;
    monitorGain?: number;
  }

  export default class Recorder {
    constructor(config?: RecorderConfig);
    ondataavailable: (data: Uint8Array) => void;
    onstop: () => void;
    start(): Promise<void>;
    stop(): Promise<void>;
    setMonitorGain?(gain: number): void;
    static isRecordingSupported(): boolean;
  }
}
