export interface WeatherProcessSnapshot {
  stdout: string;
  stderr: string;
  exited: boolean;
  exitCode?: number;
  exitSignal?: string;
}

export declare class NativeWeatherProcess {
  constructor(
    scriptPath: string,
    weathrPath: string,
    args: string[],
    configHome: string,
    columns: number,
    rows: number,
  );
  poll(): WeatherProcessSnapshot;
  writeInput(input: string): boolean;
  stop(): void;
  restart(): void;
  resize(columns: number, rows: number): void;
  isRunning(): boolean;
}

