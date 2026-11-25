import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Database, onValue, ref, Unsubscribe } from '@angular/fire/database';
import {
  ChartData,
  ComfortAssessment,
  GridLine,
  MetricKey,
  MetricStats,
  SensorReading,
  SeverityLevel
} from './models/sensor-data.model';

const MAX_HISTORY = 40;
const STALE_TIMEOUT_MS = 8000;
const GAUGE_RADIUS = 46;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  private database = inject(Database);
  private unsubscribeDb: Unsubscribe | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;

  data: SensorReading | null = null;
  history: SensorReading[] = [];
  selectedMetric: MetricKey = 'distance';

  lastUpdated: Date | null = null;
  private lastUpdateMs = 0;
  isOnline = false;

  sessionSeconds = 0;
  optimalSeconds = 0;
  warningSeconds = 0;
  criticalSeconds = 0;

  distanceStats: MetricStats = { min: 0, max: 0, avg: 0, current: 0 };
  tempStats: MetricStats = { min: 0, max: 0, avg: 0, current: 0 };
  humStats: MetricStats = { min: 0, max: 0, avg: 0, current: 0 };

  ergonomicScore = 0;
  postureSubScore = 0;
  thermalSubScore = 0;
  humiditySubScore = 0;

  readonly gaugeCircumference = GAUGE_CIRCUMFERENCE;
  scoreDashOffset = GAUGE_CIRCUMFERENCE;

  postureAssessment: ComfortAssessment = {
    label: 'En attente',
    detail: 'Aucune mesure disponible',
    level: 'warning'
  };
  tempAssessment: ComfortAssessment = {
    label: 'En attente',
    detail: 'Plage idéale : 20–24 °C',
    level: 'warning'
  };
  humAssessment: ComfortAssessment = {
    label: 'En attente',
    detail: 'Plage idéale : 40–60 %',
    level: 'warning'
  };

  chartData: ChartData = {
    linePoints: '',
    areaPoints: '',
    gridLines: [],
    lastX: 0,
    lastY: 0,
    thresholdY: null,
    thresholdLabel: null,
    startTime: 0,
    endTime: 0
  };

  ngOnInit(): void {
    const dbRef = ref(this.database, 'capteurs');
    this.unsubscribeDb = onValue(dbRef, (snapshot) => {
      if (!snapshot.exists()) {
        return;
      }

      const raw = snapshot.val() as Record<string, unknown>;
      const reading: SensorReading = {
        distance: Number(raw['distance'] ?? 0),
        posture: String(raw['posture'] ?? 'Posture correcte'),
        temperature: Number(raw['temperature'] ?? 0),
        humidite: Number(raw['humidite'] ?? 0),
        timestamp: Date.now()
      };

      this.data = reading;
      this.lastUpdateMs = reading.timestamp;
      this.lastUpdated = new Date(reading.timestamp);
      this.isOnline = true;

      this.history = [...this.history.slice(-(MAX_HISTORY - 1)), reading];
      this.recomputeMetrics();
    });

    this.timerId = setInterval(() => {
      this.isOnline =
        this.lastUpdateMs > 0 && Date.now() - this.lastUpdateMs < STALE_TIMEOUT_MS;

      if (this.data && this.isOnline) {
        this.sessionSeconds++;
        if (this.data.distance >= 30) {
          this.optimalSeconds++;
        } else if (this.data.distance >= 10) {
          this.warningSeconds++;
        } else {
          this.criticalSeconds++;
        }
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.unsubscribeDb) {
      this.unsubscribeDb();
    }
    if (this.timerId) {
      clearInterval(this.timerId);
    }
  }

  selectMetric(metric: MetricKey): void {
    this.selectedMetric = metric;
    this.chartData = this.buildChartData(metric);
  }

  resetSession(): void {
    this.sessionSeconds = 0;
    this.optimalSeconds = 0;
    this.warningSeconds = 0;
    this.criticalSeconds = 0;
    this.history = this.data ? [{ ...this.data, timestamp: Date.now() }] : [];
    this.recomputeMetrics();
  }

  get postureLevel(): SeverityLevel {
    if (!this.data) {
      return 'warning';
    }
    if (this.data.distance >= 30) {
      return 'optimal';
    }
    return this.data.distance >= 10 ? 'warning' : 'critical';
  }

  get scoreStatus(): { label: string; level: SeverityLevel; stroke: string } {
    if (this.ergonomicScore >= 85) {
      return { label: 'Excellent', level: 'optimal', stroke: '#16a34a' };
    }
    if (this.ergonomicScore >= 65) {
      return { label: 'Bon', level: 'optimal', stroke: '#22c55e' };
    }
    if (this.ergonomicScore >= 45) {
      return { label: 'À améliorer', level: 'warning', stroke: '#d97706' };
    }
    return { label: 'Critique', level: 'critical', stroke: '#dc2626' };
  }

  get activeMetricColor(): string {
    if (this.selectedMetric === 'temperature') {
      return '#ea580c';
    }
    if (this.selectedMetric === 'humidite') {
      return '#0891b2';
    }
    return '#2563eb';
  }

  get activeMetricUnit(): string {
    if (this.selectedMetric === 'temperature') {
      return '°C';
    }
    if (this.selectedMetric === 'humidite') {
      return '%';
    }
    return 'cm';
  }

  getZonePercent(zoneSeconds: number): number {
    if (this.sessionSeconds === 0) {
      return 0;
    }
    return Math.round((zoneSeconds / this.sessionSeconds) * 100);
  }

  formatDuration(totalSeconds: number): string {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  }

  formatTime(timestamp: number | Date | null): string {
    if (!timestamp) {
      return '--:--:--';
    }
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  getSparklinePoints(metric: MetricKey): string {
    const values = this.history.map((item) => item[metric]);
    if (values.length === 0) {
      return '';
    }
    if (values.length === 1) {
      return '0,18 120,18';
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const width = 120;
    const height = 36;
    const padY = 4;

    return values
      .map((val, idx) => {
        const x = (idx / (values.length - 1)) * width;
        const y = height - padY - ((val - min) / span) * (height - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  private recomputeMetrics(): void {
    if (!this.data) {
      return;
    }

    this.distanceStats = this.computeStats('distance', 0);
    this.tempStats = this.computeStats('temperature', 1);
    this.humStats = this.computeStats('humidite', 0);

    this.updateAssessments(this.data);
    this.updateErgonomicScore(this.data);
    this.chartData = this.buildChartData(this.selectedMetric);
  }

  private computeStats(metric: MetricKey, decimals: number): MetricStats {
    const values = this.history.map((item) => item[metric]);
    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, current: 0 };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
    const current = values[values.length - 1];
    const factor = Math.pow(10, decimals);

    return {
      min: Math.round(min * factor) / factor,
      max: Math.round(max * factor) / factor,
      avg: Math.round(avg * factor) / factor,
      current: Math.round(current * factor) / factor
    };
  }

  private updateAssessments(reading: SensorReading): void {
    if (reading.distance >= 35 && reading.distance <= 80) {
      this.postureAssessment = {
        label: 'Distance optimale',
        detail: 'Recul confortable (35–80 cm)',
        level: 'optimal'
      };
    } else if (reading.distance >= 30) {
      this.postureAssessment = {
        label: 'Correcte',
        detail: reading.distance > 80 ? 'Écran assez éloigné (> 80 cm)' : 'Proche du seuil minimal (30 cm)',
        level: 'optimal'
      };
    } else if (reading.distance >= 10) {
      this.postureAssessment = {
        label: 'Attention distance',
        detail: 'Rapprochez-vous du recul conseillé (≥ 30 cm)',
        level: 'warning'
      };
    } else {
      this.postureAssessment = {
        label: 'Trop proche',
        detail: 'Distance critique (< 10 cm) — reculez de l’écran',
        level: 'critical'
      };
    }

    if (reading.temperature >= 20 && reading.temperature <= 24) {
      this.tempAssessment = {
        label: 'Confort optimal',
        detail: 'Plage recommandée : 20–24 °C',
        level: 'optimal'
      };
    } else if (reading.temperature >= 18 && reading.temperature < 20) {
      this.tempAssessment = {
        label: 'Légèrement frais',
        detail: 'En dessous de 20 °C',
        level: 'warning'
      };
    } else if (reading.temperature > 24 && reading.temperature <= 26) {
      this.tempAssessment = {
        label: 'Légèrement chaud',
        detail: 'Au-dessus de 24 °C',
        level: 'warning'
      };
    } else if (reading.temperature < 18) {
      this.tempAssessment = {
        label: 'Trop froid',
        detail: 'Inférieur au seuil de confort (< 18 °C)',
        level: 'critical'
      };
    } else {
      this.tempAssessment = {
        label: 'Trop chaud',
        detail: 'Supérieur au seuil de confort (> 26 °C)',
        level: 'critical'
      };
    }

    if (reading.humidite >= 40 && reading.humidite <= 60) {
      this.humAssessment = {
        label: 'Humidité idéale',
        detail: 'Plage recommandée : 40–60 %',
        level: 'optimal'
      };
    } else if (reading.humidite >= 30 && reading.humidite < 40) {
      this.humAssessment = {
        label: 'Air un peu sec',
        detail: 'Sous le seuil de 40 %',
        level: 'warning'
      };
    } else if (reading.humidite > 60 && reading.humidite <= 70) {
      this.humAssessment = {
        label: 'Air humide',
        detail: 'Au-dessus de 60 %',
        level: 'warning'
      };
    } else if (reading.humidite < 30) {
      this.humAssessment = {
        label: 'Air trop sec',
        detail: 'Risque de fatigue oculaire (< 30 %)',
        level: 'critical'
      };
    } else {
      this.humAssessment = {
        label: 'Humidité excessive',
        detail: 'Supérieur à 70 % — pensez à aérer',
        level: 'critical'
      };
    }
  }

  private updateErgonomicScore(reading: SensorReading): void {
    if (reading.distance >= 35 && reading.distance <= 80) {
      this.postureSubScore = 50;
    } else if (reading.distance >= 30) {
      this.postureSubScore = 42;
    } else if (reading.distance >= 10) {
      this.postureSubScore = 20;
    } else {
      this.postureSubScore = 5;
    }

    if (reading.temperature >= 20 && reading.temperature <= 24) {
      this.thermalSubScore = 25;
    } else if (reading.temperature >= 18 && reading.temperature <= 26) {
      this.thermalSubScore = 16;
    } else {
      this.thermalSubScore = 6;
    }

    if (reading.humidite >= 40 && reading.humidite <= 60) {
      this.humiditySubScore = 25;
    } else if (reading.humidite >= 30 && reading.humidite <= 70) {
      this.humiditySubScore = 16;
    } else {
      this.humiditySubScore = 6;
    }

    this.ergonomicScore = this.postureSubScore + this.thermalSubScore + this.humiditySubScore;
    this.scoreDashOffset = GAUGE_CIRCUMFERENCE * (1 - this.ergonomicScore / 100);
  }

  private buildChartData(metric: MetricKey): ChartData {
    const width = 640;
    const height = 180;
    const padLeft = 40;
    const padRight = 16;
    const padTop = 16;
    const padBottom = 26;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    if (this.history.length === 0) {
      return {
        linePoints: '',
        areaPoints: '',
        gridLines: [],
        lastX: padLeft,
        lastY: padTop + plotHeight / 2,
        thresholdY: null,
        thresholdLabel: null,
        startTime: 0,
        endTime: 0
      };
    }

    const values = this.history.map((item) => item[metric]);
    const defaults: Record<MetricKey, [number, number]> = {
      distance: [0, 80],
      temperature: [15, 32],
      humidite: [25, 80]
    };

    const [baseMin, baseMax] = defaults[metric];
    const minVal = Math.min(baseMin, ...values);
    const maxVal = Math.max(baseMax, ...values);
    const span = maxVal - minVal || 1;

    const toY = (val: number) => padTop + plotHeight - ((val - minVal) / span) * plotHeight;

    const gridLines: GridLine[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const ratio = i / steps;
      const val = minVal + ratio * span;
      gridLines.push({
        y: Math.round(toY(val) * 10) / 10,
        label: metric === 'temperature' ? val.toFixed(1) : Math.round(val).toString()
      });
    }

    const coords = values.map((val, idx) => {
      const x =
        values.length === 1
          ? padLeft + plotWidth / 2
          : padLeft + (idx / (values.length - 1)) * plotWidth;
      const y = toY(val);
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });

    const linePoints = coords.map((pt) => `${pt.x},${pt.y}`).join(' ');
    const baselineY = padTop + plotHeight;
    const first = coords[0];
    const last = coords[coords.length - 1];
    const areaPoints = `${first.x},${baselineY} ${linePoints} ${last.x},${baselineY}`;

    let thresholdY: number | null = null;
    let thresholdLabel: string | null = null;
    if (metric === 'distance') {
      thresholdY = Math.round(toY(30) * 10) / 10;
      thresholdLabel = 'Seuil 30 cm';
    }

    return {
      linePoints,
      areaPoints,
      gridLines,
      lastX: last.x,
      lastY: last.y,
      thresholdY,
      thresholdLabel,
      startTime: this.history[0].timestamp,
      endTime: this.history[this.history.length - 1].timestamp
    };
  }
}
