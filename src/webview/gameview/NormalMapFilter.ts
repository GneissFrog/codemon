/**
 * NormalMapFilter - Custom PixiJS filter for dynamic lighting with normal maps
 *
 * Supports:
 * - Ambient lighting (base illumination)
 * - Directional lighting (sun-like, global direction)
 * - Point lights (torches, agent glow, etc.)
 */

import { Filter, Texture, BufferImageSource } from 'pixi.js';
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
uniform bool uEnabled;

// Point light uniforms (max 8 lights)
uniform vec3 uPointLights[8];     // xyz = position (z = radius)
uniform vec3 uPointLightColors[8];
uniform float uPointLightIntensities[8];
uniform int uNumPointLights;

void main() {
  vec4 diffuse = texture(uTexture, vTextureCoord);

  // If lighting disabled or pixel is transparent, just output diffuse
  if (!uEnabled || diffuse.a < 0.01) {
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
    if (i >= uNumPointLights) break;

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
    super({
      glProgram: {
        vertex: vertexShader,
        fragment: fragmentShader,
      },
      resources: {
        uNormalMap: undefined as unknown as Texture,
        uAmbient: { value: 0.3 },
        uAmbientColor: { value: [1, 1, 1] },
        uLightDir: { value: [0.5, -0.5] },
        uLightIntensity: { value: 0.7 },
        uLightColor: { value: [1, 0.95, 0.9] },
        uEnabled: { value: 1 },
        uPointLights: { value: new Float32Array(24) },
        uPointLightColors: { value: new Float32Array(24) },
        uPointLightIntensities: { value: new Float32Array(8) },
        uNumPointLights: { value: 0 },
      },
    });

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

    this.updateUniforms();
  }

  /**
   * Set the normal map texture for this filter
   */
  setNormalMap(texture: Texture | null): void {
    this.normalMapTexture = texture;
    // Update the uniform - in PixiJS v8 we set texture resources directly
    if (texture) {
      this.resources.uNormalMap = texture;
    }
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
    this.resources.uAmbient = this.lightingState.ambient;
  }

  /**
   * Set ambient light color (hex)
   */
  setAmbientColor(color: number): void {
    this.lightingState.ambientColor = color;
    const rgb = this.hexToRgb(color);
    this.resources.uAmbientColor = [rgb.r, rgb.g, rgb.b];
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
    this.resources.uLightDir = [x, y];
  }

  /**
   * Set directional light intensity (0-1)
   */
  setLightIntensity(intensity: number): void {
    this.lightingState.directional.intensity = Math.max(0, Math.min(1, intensity));
    this.resources.uLightIntensity = this.lightingState.directional.intensity;
  }

  /**
   * Set directional light color (hex)
   */
  setLightColor(color: number): void {
    this.lightingState.directional.color = color;
    const rgb = this.hexToRgb(color);
    this.resources.uLightColor = [rgb.r, rgb.g, rgb.b];
  }

  /**
   * Set all point lights at once
   */
  setPointLights(lights: PointLight[]): void {
    this.lightingState.pointLights = lights.slice(0, 8); // Max 8 lights
    this.updatePointLightUniforms();
  }

  /**
   * Add a single point light
   */
  addPointLight(light: PointLight): void {
    if (this.lightingState.pointLights.length < 8) {
      this.lightingState.pointLights.push(light);
      this.updatePointLightUniforms();
    }
  }

  /**
   * Remove a point light by ID
   */
  removePointLight(id: string): void {
    const index = this.lightingState.pointLights.findIndex(l => l.id === id);
    if (index >= 0) {
      this.lightingState.pointLights.splice(index, 1);
      this.updatePointLightUniforms();
    }
  }

  /**
   * Update a specific point light
   */
  updatePointLight(id: string, updates: Partial<PointLight>): void {
    const light = this.lightingState.pointLights.find(l => l.id === id);
    if (light) {
      Object.assign(light, updates);
      this.updatePointLightUniforms();
    }
  }

  /**
   * Clear all point lights
   */
  clearPointLights(): void {
    this.lightingState.pointLights = [];
    this.updatePointLightUniforms();
  }

  /**
   * Enable or disable the lighting effect
   */
  setEnabled(enabled: boolean): void {
    this.lightingState.enabled = enabled;
    this.resources.uEnabled = enabled ? 1 : 0;
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
    this.resources.uEnabled = this.lightingState.enabled ? 1 : 0;
    this.resources.uAmbient = this.lightingState.ambient;

    const ambientRgb = this.hexToRgb(this.lightingState.ambientColor);
    this.resources.uAmbientColor = [ambientRgb.r, ambientRgb.g, ambientRgb.b];

    this.resources.uLightDir = [
      this.lightingState.directional.x,
      this.lightingState.directional.y,
    ];
    this.resources.uLightIntensity = this.lightingState.directional.intensity;

    const lightRgb = this.hexToRgb(this.lightingState.directional.color);
    this.resources.uLightColor = [lightRgb.r, lightRgb.g, lightRgb.b];

    this.updatePointLightUniforms();
  }

  /**
   * Update point light uniform arrays
   */
  private updatePointLightUniforms(): void {
    const positions = new Float32Array(24);  // 8 lights * 3 components
    const colors = new Float32Array(24);
    const intensities = new Float32Array(8);

    const lights = this.lightingState.pointLights;
    for (let i = 0; i < 8; i++) {
      if (i < lights.length) {
        const light = lights[i];
        // Convert world coordinates if needed
        positions[i * 3] = light.x;
        positions[i * 3 + 1] = light.y;
        positions[i * 3 + 2] = light.radius;

        const rgb = this.hexToRgb(light.color);
        colors[i * 3] = rgb.r;
        colors[i * 3 + 1] = rgb.g;
        colors[i * 3 + 2] = rgb.b;

        intensities[i] = light.intensity;
      } else {
        // Zero out unused lights
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;
        colors[i * 3] = 0;
        colors[i * 3 + 1] = 0;
        colors[i * 3 + 2] = 0;
        intensities[i] = 0;
      }
    }

    this.resources.uPointLights = positions;
    this.resources.uPointLightColors = colors;
    this.resources.uPointLightIntensities = intensities;
    this.resources.uNumPointLights = lights.length;
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
