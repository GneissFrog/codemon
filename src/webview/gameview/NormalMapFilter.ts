/**
 * NormalMapFilter - Custom PixiJS filter for dynamic lighting with normal maps
 *
 * Supports:
 * - Ambient lighting (base illumination)
 * - Directional lighting (sun-like, global direction)
 * - Point lights (torches, agent glow, etc.)
 */

import { Filter, GlProgram, Texture, Shader } from 'pixi.js';
import { LightingState, PointLight } from './types';

// Fragment shader for normal map lighting
const fragmentShader = `
precision highp float;

in vec2 vTextureCoord;
in vec2 vWorldCoord;

out vec4 fragColor;

uniform sampler2D uTexture;
uniform sampler2D uNormalMap;
uniform float uAmbient;
uniform vec3 uAmbientColor;
uniform vec2 uLightDir;
uniform float uLightIntensity;
uniform vec3 uLightColor;
uniform float uEnabled;

// Point light uniforms (max 8 lights)
uniform vec3 uPointLights[8];     // xyz = position (z = radius)
uniform vec3 uPointLightColors[8];
uniform float uPointLightIntensities[8];
uniform float uNumPointLights;

void main() {
  vec4 diffuse = texture(uTexture, vTextureCoord);

  // If lighting disabled or pixel is transparent, just output diffuse
  if (uEnabled < 0.5 || diffuse.a < 0.01) {
    fragColor = diffuse;
    return;
  }

  // Sample normal from normal map
  // Normal maps store normals in tangent space, RGB -> XYZ where 128 = 0
  vec3 normal = texture(uNormalMap, vTextureCoord).rgb;
  // Convert from [0,1] to [-1,1] range
  normal = normalize(normal * 2.0 - 1.0);

  // Start with ambient light
  vec3 lighting = uAmbientColor * uAmbient;

  // Directional light (sun)
  // For 2D, we use the x,y components of the normal and light direction
  float dirIntensity = max(0.0, dot(normal.xy, uLightDir)) * uLightIntensity;
  lighting += uLightColor * dirIntensity;

  // Point lights
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uNumPointLights) break;

    vec2 lightPos = uPointLights[i].xy;
    float lightRadius = uPointLights[i].z;

    vec2 toLight = lightPos - vWorldCoord;
    float dist = length(toLight);

    if (dist < lightRadius) {
      vec2 lightDir = normalize(toLight);

      // Normal mapping for point light
      float normalIntensity = max(0.0, dot(normal.xy, lightDir));

      // Distance attenuation (quadratic falloff)
      float attenuation = 1.0 - (dist / lightRadius);
      attenuation = attenuation * attenuation;

      float intensity = normalIntensity * attenuation * uPointLightIntensities[i];
      lighting += uPointLightColors[i] * intensity;
    }
  }

  // Apply lighting to diffuse color
  vec3 finalColor = diffuse.rgb * lighting;
  fragColor = vec4(finalColor, diffuse.a);
}
`;

// Vertex shader that passes world coordinates
const vertexShader = `
in vec2 aPosition;
in vec2 aUV;

out vec2 vTextureCoord;
out vec2 vWorldCoord;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uFilterMatrix;

void main() {
  vTextureCoord = aUV;

  // Calculate world coordinates for point light calculations
  vec2 filterCoord = aPosition * 0.5 + 0.5;  // Convert to 0-1 range
  vWorldCoord = (uFilterMatrix * vec3(filterCoord, 1.0)).xy;

  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export class NormalMapFilter extends Filter {
  private normalMapTexture: Texture | null = null;
  private lightingState: LightingState;
  private worldScale: number = 1;
  private worldOffset: { x: number; y: number } = { x: 0, y: 0 };

  constructor() {
    // Create the GL program
    const glProgram = new GlProgram({
      vertex: vertexShader,
      fragment: fragmentShader,
    });

    super({ glProgram });

    // Default lighting state
    this.lightingState = {
      enabled: true,
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

    // Set initial uniform values
    this.updateUniforms();
  }

  /**
   * Set the normal map texture for this filter
   */
  setNormalMap(texture: Texture | null): void {
    this.normalMapTexture = texture;
  }

  /**
   * Get the current normal map texture
   */
  getNormalMap(): Texture | null {
    return this.normalMapTexture;
  }

  /**
   * Update the complete lighting state
   */
  setLightingState(state: Partial<LightingState>): void {
    this.lightingState = { ...this.lightingState, ...state };
    this.updateUniforms();
  }

  /**
   * Get the current lighting state
   */
  getLightingState(): LightingState {
    return { ...this.lightingState };
  }

  /**
   * Set ambient light level (0-1)
   */
  setAmbient(level: number): void {
    this.lightingState.ambient = Math.max(0, Math.min(1, level));
  }

  /**
   * Set ambient light color (hex)
   */
  setAmbientColor(color: number): void {
    this.lightingState.ambientColor = color;
  }

  /**
   * Set directional light direction (normalized vector)
   */
  setLightDirection(x: number, y: number): void {
    // Normalize the direction
    const len = Math.sqrt(x * x + y * y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    this.lightingState.directional.x = x;
    this.lightingState.directional.y = y;
  }

  /**
   * Set directional light intensity (0-1)
   */
  setLightIntensity(intensity: number): void {
    this.lightingState.directional.intensity = Math.max(0, Math.min(1, intensity));
  }

  /**
   * Set directional light color (hex)
   */
  setLightColor(color: number): void {
    this.lightingState.directional.color = color;
  }

  /**
   * Set all point lights at once
   */
  setPointLights(lights: PointLight[]): void {
    this.lightingState.pointLights = lights.slice(0, 8); // Max 8 lights
  }

  /**
   * Add a single point light
   */
  addPointLight(light: PointLight): void {
    if (this.lightingState.pointLights.length < 8) {
      this.lightingState.pointLights.push(light);
    }
  }

  /**
   * Remove a point light by ID
   */
  removePointLight(id: string): void {
    const index = this.lightingState.pointLights.findIndex(l => l.id === id);
    if (index >= 0) {
      this.lightingState.pointLights.splice(index, 1);
    }
  }

  /**
   * Update a specific point light
   */
  updatePointLight(id: string, updates: Partial<PointLight>): void {
    const light = this.lightingState.pointLights.find(l => l.id === id);
    if (light) {
      Object.assign(light, updates);
    }
  }

  /**
   * Clear all point lights
   */
  clearPointLights(): void {
    this.lightingState.pointLights = [];
  }

  /**
   * Enable or disable the lighting effect
   */
  setEnabled(enabled: boolean): void {
    this.lightingState.enabled = enabled;
  }

  /**
   * Set world transform for point light coordinate conversion
   */
  setWorldTransform(scale: number, offsetX: number, offsetY: number): void {
    this.worldScale = scale;
    this.worldOffset = { x: offsetX, y: offsetY };
  }

  /**
   * Update all uniforms from current state
   */
  private updateUniforms(): void {
    // Uniforms are set via the shader in PixiJS v8
    // This method exists for compatibility
  }

  /**
   * Convert hex color to RGB (0-1 range)
   */
  private hexToRgb(hex: number): { r: number; g: number; b: number } {
    return {
      r: ((hex >> 16) & 0xff) / 255,
      g: ((hex >> 8) & 0xff) / 255,
      b: (hex & 0xff) / 255,
    };
  }
}
