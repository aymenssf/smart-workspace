export type MetricKey = 'distance' | 'temperature' | 'humidite';

export type SeverityLevel = 'optimal' | 'warning' | 'critical';

export interface SensorReading {
  distance: number;
  posture: string;
  temperature: number;
  humidite: number;
  timestamp: number;
}

export interface MetricStats {
  min: number;
  max: number;
  avg: number;
  current: number;
}

export interface ComfortAssessment {
  label: string;
  detail: string;
  level: SeverityLevel;
}

export interface GridLine {
  y: number;
  label: string;
}

export interface ChartData {
  linePoints: string;
  areaPoints: string;
  gridLines: GridLine[];
  lastX: number;
  lastY: number;
  thresholdY: number | null;
  thresholdLabel: string | null;
  startTime: number;
  endTime: number;
}
