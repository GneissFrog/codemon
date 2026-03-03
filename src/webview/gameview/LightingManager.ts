/**
 * LightingManager - Manages light sources for normal map rendering
 *
 * Handles:
 * - Day/night cycle integration (directional light angle/intensity)
 * - Agent-following point light (torch effect)
 * - Activity-based point lights (file highlights)
 * - Ambient light adjustments
 */

import { LightingState, PointLight, DirectionalLight } from './types';

export interface LightingConfig {
  /** Enable normal map lighting system */
  enabled: boolean;
  /** Enable day/night cycle affecting lighting */
  dayNightCycle: boolean;
  /** Agent-following light (torch effect) */
  agentLight: boolean;
  /** Agent light radius in pixels */
  agentLightRadius: number;
  /** Agent light intensity */
  agentLightIntensity: number;
  /** Agent light color (hex) */
  agentLightColor: number;
}

const DEFAULT_CONFIG: LightingConfig = {
  enabled: true,
  dayNightCycle: true,
  agentLight: true,
  agentLightRadius: 80,
  agentLightIntensity: 0.8,
  agentLightColor: 0xffaa44,  // Warm orange
};

export class LightingManager {
  private config: LightingConfig;
  private state: LightingState;
  private agentPosition: { x: number; y: number } = { x: 0, y: 0 };
  private lastDayNightUpdate: number = 0;

  constructor(config: Partial<LightingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.state = {
      enabled: this.config.enabled,
      ambient: 0.3,
      ambientColor: 0xffffff,
      directional: {
        x: 0.5,
        y: -0.7,
        intensity: 0.7,
        color: 0xfff5e6,
      },
      pointLights: [],
    };

    // Add initial agent light if enabled
    if (this.config.agentLight) {
      this.state.pointLights.push({
        id: 'agent',
        x: 0,
        y: 0,
        radius: this.config.agentLightRadius,
        color: this.config.agentLightColor,
        intensity: this.config.agentLightIntensity,
        falloff: 2,
      });
    }
  }

  /**
   * Get the current lighting state
   */
  getState(): LightingState {
    return { ...this.state };
  }

  /**
   * Check if lighting is enabled
   */
  isEnabled(): boolean {
    return this.state.enabled;
  }

  /**
   * Enable or disable the lighting system
   */
  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    this.config.enabled = enabled;
  }

  /**
   * Update agent position (for torch light following)
   */
  setAgentPosition(x: number, y: number): void {
    this.agentPosition = { x, y };

    // Update agent light position
    const agentLight = this.state.pointLights.find(l => l.id === 'agent');
    if (agentLight) {
      agentLight.x = x;
      agentLight.y = y;
    }
  }

  /**
   * Add a temporary activity light at a position
   */
  addActivityLight(id: string, x: number, y: number, color: number = 0x44aaff): void {
    // Remove existing light with same ID
    this.removeLight(id);

    // Add new activity light
    this.state.pointLights.push({
      id,
      x,
      y,
      radius: 50,
      color,
      intensity: 0.6,
      falloff: 2,
    });
  }

  /**
   * Remove a light by ID
   */
  removeLight(id: string): void {
    const index = this.state.pointLights.findIndex(l => l.id === id);
    if (index >= 0 && id !== 'agent') {  // Don't remove agent light
      this.state.pointLights.splice(index, 1);
    }
  }

  /**
   * Clear all activity lights (keep agent light)
   */
  clearActivityLights(): void {
    this.state.pointLights = this.state.pointLights.filter(l => l.id === 'agent');
  }

  /**
   * Update day/night cycle lighting
   * Call this once per frame with current time
   */
  updateDayNightCycle(): void {
    if (!this.config.dayNightCycle) return;

    const now = Date.now();
    // Only update every 5 seconds
    if (now - this.lastDayNightUpdate < 5000) return;
    this.lastDayNightUpdate = now;

    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    const timeOfDay = hour + minute / 60;

    // Calculate sun angle based on time
    // Sunrise at 6, sunset at 18
    let sunAngle = 0;
    let sunIntensity = 0;
    let ambientLevel = 0.3;
    let lightColor = 0xfff5e6;  // Default warm white

    if (timeOfDay < 5) {
      // Deep night (0:00 - 5:00)
      sunAngle = Math.PI * 0.75;  // Sun below horizon
      sunIntensity = 0.1;
      ambientLevel = 0.15;
      lightColor = 0x4466aa;  // Blue-ish moonlight
    } else if (timeOfDay < 7) {
      // Dawn transition (5:00 - 7:00)
      const t = (timeOfDay - 5) / 2;
      sunAngle = Math.PI * (0.75 - t * 0.25);
      sunIntensity = 0.1 + t * 0.5;
      ambientLevel = 0.15 + t * 0.15;
      lightColor = this.lerpColor(0x4466aa, 0xffaa66, t);  // Blue to warm orange
    } else if (timeOfDay < 12) {
      // Morning (7:00 - 12:00)
      const t = (timeOfDay - 7) / 5;
      sunAngle = Math.PI * (0.5 - t * 0.3);
      sunIntensity = 0.6 + t * 0.2;
      ambientLevel = 0.3 + t * 0.1;
      lightColor = this.lerpColor(0xffaa66, 0xfff5e6, t);  // Orange to white
    } else if (timeOfDay < 17) {
      // Midday to afternoon (12:00 - 17:00)
      const t = (timeOfDay - 12) / 5;
      sunAngle = Math.PI * (0.2 + t * 0.3);
      sunIntensity = 0.8 - t * 0.1;
      ambientLevel = 0.4;
    } else if (timeOfDay < 20) {
      // Dusk transition (17:00 - 20:00)
      const t = (timeOfDay - 17) / 3;
      sunAngle = Math.PI * (0.5 + t * 0.25);
      sunIntensity = 0.7 - t * 0.5;
      ambientLevel = 0.4 - t * 0.2;
      lightColor = this.lerpColor(0xfff5e6, 0xff6644, t);  // White to red-orange
    } else {
      // Night (20:00 - 24:00)
      sunAngle = Math.PI * 0.75;
      sunIntensity = 0.1;
      ambientLevel = 0.15;
      lightColor = 0x4466aa;
    }

    // Update directional light
    this.state.directional = {
      x: Math.cos(sunAngle),
      y: Math.sin(sunAngle),
      intensity: sunIntensity,
      color: lightColor,
    };

    this.state.ambient = ambientLevel;
    this.state.ambientColor = lightColor;
  }

  /**
   * Set a fixed time of day (for testing or manual control)
   */
  setTimeOfDay(hour: number): void {
    // Temporarily override day/night cycle
    const savedEnabled = this.config.dayNightCycle;
    this.config.dayNightCycle = true;

    // Mock the current time
    const originalDate = Date.now;
    (globalThis as any).Date = class extends Date {
      constructor() {
        super();
        // Override getHours to return fixed hour
      }
      getHours() {
        return Math.floor(hour);
      }
      getMinutes() {
        return Math.floor((hour % 1) * 60);
      }
    };

    this.updateDayNightCycle();
    this.config.dayNightCycle = savedEnabled;
    (globalThis as any).Date = originalDate;
  }

  /**
   * Configure agent light parameters
   */
  setAgentLightConfig(config: Partial<{
    radius: number;
    intensity: number;
    color: number;
    enabled: boolean;
  }>): void {
    if (config.radius !== undefined) {
      this.config.agentLightRadius = config.radius;
    }
    if (config.intensity !== undefined) {
      this.config.agentLightIntensity = config.intensity;
    }
    if (config.color !== undefined) {
      this.config.agentLightColor = config.color;
    }
    if (config.enabled !== undefined) {
      this.config.agentLight = config.enabled;
    }

    // Update or add/remove agent light
    const agentIndex = this.state.pointLights.findIndex(l => l.id === 'agent');

    if (this.config.agentLight) {
      if (agentIndex >= 0) {
        this.state.pointLights[agentIndex] = {
          id: 'agent',
          x: this.agentPosition.x,
          y: this.agentPosition.y,
          radius: this.config.agentLightRadius,
          color: this.config.agentLightColor,
          intensity: this.config.agentLightIntensity,
          falloff: 2,
        };
      } else {
        this.state.pointLights.push({
          id: 'agent',
          x: this.agentPosition.x,
          y: this.agentPosition.y,
          radius: this.config.agentLightRadius,
          color: this.config.agentLightColor,
          intensity: this.config.agentLightIntensity,
          falloff: 2,
        });
      }
    } else if (agentIndex >= 0) {
      this.state.pointLights.splice(agentIndex, 1);
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<LightingConfig>): void {
    this.config = { ...this.config, ...config };
    this.state.enabled = this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): LightingConfig {
    return { ...this.config };
  }

  /**
   * Linear interpolation between two colors
   */
  private lerpColor(color1: number, color2: number, t: number): number {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;

    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return (r << 16) | (g << 8) | b;
  }
}
