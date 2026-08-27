import { get } from "./api";

/** One data point on a trend line */
export interface TrendPoint {
  /** Period label (e.g., "2026-08-02", "2026-W31", "2026-08") */
  bucket: string;
  /** Figure for the period — minor units for money, count otherwise */
  value: number;
  /** Number of records that made up the value */
  count: number;
  /** True if the window cuts through this bucket (usually the last one) */
  partial?: boolean;
}

/** A series with context to be read without a second call */
export interface Trend {
  points: TrendPoint[];
  /** Total across all buckets */
  total: number;
  /** Average per non-empty bucket */
  average: number;
  /** Percentage change between first and second halves (null if insufficient data) */
  changePercent?: number | null;
  /** Grain used for bucketing */
  grain: "day" | "week" | "month";
}

/** Overall engagement headline figures */
export interface Engagement {
  /** Congregation size (excluding deceased and transferred) */
  members: number;
  /** How many attended in the window */
  attendedRecently: number;
  /** How many gave in the window */
  gaveRecently: number;
  /** How many did either (union, not sum) */
  engaged: number;
  /** Members engaged in the previous window but not this one */
  drifting: number;
  /** Window size used for "recently" */
  windowDays: number;
}

const AnalyticsService = {
  /**
   * Giving trend over time.
   *
   * Values are in minor units (pesewas). Query params: grain (day/week/month),
   * from (RFC3339), to (RFC3339). Defaults to the last 3 months by week.
   */
  async givingTrend(params?: {
    grain?: "day" | "week" | "month";
    from?: string;
    to?: string;
  }): Promise<Trend> {
    return get<Trend>("/analytics/giving", { params });
  },

  /**
   * Attendance trend over time.
   *
   * Values are headcounts. Query params: grain (day/week/month),
   * from (RFC3339), to (RFC3339). Defaults to the last 3 months by week.
   */
  async attendanceTrend(params?: {
    grain?: "day" | "week" | "month";
    from?: string;
    to?: string;
  }): Promise<Trend> {
    return get<Trend>("/analytics/attendance", { params });
  },

  /**
   * Engagement headline figures.
   *
   * Query param: days (number, defaults to 56). Returns who is engaged,
   * who has drifted, and overall congregational size.
   */
  async engagement(params?: { days?: number }): Promise<Engagement> {
    return get<Engagement>("/analytics/engagement", { params });
  },
};

export default AnalyticsService;
