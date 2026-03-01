/**
 * Pixel Art Theme CSS
 * Shared styles for all CodeMon webviews
 */

export const PIXEL_THEME_CSS = `
  /* Pixel Art Font - using system monospace as fallback */
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

  :root {
    /* PICO-8 inspired palette */
    --pixel-bg: #1a1c2c;
    --pixel-bg-light: #2a2d3e;
    --pixel-bg-lighter: #3a3d4e;
    --pixel-fg: #f4f4f4;
    --pixel-muted: #8a8a8a;
    --pixel-accent: #29adff;
    --pixel-success: #00e436;
    --pixel-warning: #ffec27;
    --pixel-error: #ff004d;
    --pixel-purple: #83769c;
    --pixel-orange: #ff77a8;
    --pixel-border: #5a5d6e;
    --pixel-shadow: #0a0c14;

    /* Sprite colors by model type */
    --sprite-opus: #ff77a8;
    --sprite-sonnet: #29adff;
    --sprite-haiku: #00e436;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Press Start 2P', 'Consolas', 'Monaco', monospace;
    font-size: 10px;
    background: var(--pixel-bg);
    color: var(--pixel-fg);
    padding: 8px;
    line-height: 1.6;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  /* Pixel border effect */
  .pixel-border {
    border: 2px solid var(--pixel-border);
    box-shadow:
      inset -2px -2px 0 0 var(--pixel-shadow),
      inset 2px 2px 0 0 var(--pixel-bg-lighter),
      0 0 0 2px var(--pixel-shadow);
  }

  /* CRT scanline effect (optional) */
  .crt-effect {
    position: relative;
  }

  .crt-effect::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.1) 0px,
      rgba(0, 0, 0, 0.1) 1px,
      transparent 1px,
      transparent 2px
    );
    pointer-events: none;
    opacity: 0.3;
  }

  /* Typography */
  .label {
    color: var(--pixel-muted);
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .value {
    color: var(--pixel-fg);
    font-size: 10px;
  }

  .accent { color: var(--pixel-accent); }
  .success { color: var(--pixel-success); }
  .warning { color: var(--pixel-warning); }
  .error { color: var(--pixel-error); }

  /* Animations */
  @keyframes idle-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-2px); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  @keyframes flash-error {
    0%, 100% { background-color: var(--pixel-bg-light); }
    50% { background-color: rgba(255, 0, 77, 0.3); }
  }

  @keyframes flash-success {
    0%, 100% { background-color: var(--pixel-bg-light); }
    50% { background-color: rgba(0, 228, 54, 0.3); }
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* Utility classes */
  .animate-idle { animation: idle-bounce 1s ease-in-out infinite; }
  .animate-pulse { animation: pulse 2s ease-in-out infinite; }
  .animate-error { animation: flash-error 0.3s ease-in-out; }
  .animate-success { animation: flash-success 0.3s ease-in-out; }
  .animate-shake { animation: shake 0.2s ease-in-out; }
  .animate-slide-in { animation: slide-in 0.2s ease-out; }

  /* Scrollbar styling */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: var(--pixel-bg);
  }

  ::-webkit-scrollbar-thumb {
    background: var(--pixel-border);
    border: 1px solid var(--pixel-shadow);
  }

  ::-webkit-scrollbar-thumb:hover {
    background: var(--pixel-muted);
  }

  /* Button styling */
  .pixel-btn {
    font-family: 'Press Start 2P', monospace;
    font-size: 8px;
    padding: 8px 12px;
    background: var(--pixel-bg-light);
    border: 2px solid var(--pixel-border);
    color: var(--pixel-fg);
    cursor: pointer;
    box-shadow:
      inset -2px -2px 0 0 var(--pixel-shadow),
      inset 2px 2px 0 0 var(--pixel-bg-lighter);
    transition: all 0.1s;
  }

  .pixel-btn:hover {
    background: var(--pixel-bg-lighter);
  }

  .pixel-btn:active {
    box-shadow:
      inset 2px 2px 0 0 var(--pixel-shadow),
      inset -2px -2px 0 0 var(--pixel-bg-lighter);
    transform: translate(1px, 1px);
  }

  /* Progress bar */
  .pixel-bar {
    height: 12px;
    background: var(--pixel-bg);
    border: 2px solid var(--pixel-border);
    box-shadow: inset 2px 2px 0 0 var(--pixel-shadow);
    overflow: hidden;
  }

  .pixel-bar-fill {
    height: 100%;
    transition: width 0.3s ease-out;
    background: var(--pixel-success);
  }

  .pixel-bar-fill.warning {
    background: var(--pixel-warning);
  }

  .pixel-bar-fill.danger {
    background: var(--pixel-error);
    animation: pulse 0.5s ease-in-out infinite;
  }

  .pixel-bar-fill.critical {
    background: var(--pixel-error);
    animation: pulse 0.25s ease-in-out infinite;
  }
`;

/**
 * Get CSS for sprite-based character
 */
export function getSpriteCss(spriteType: 'knight' | 'ranger' | 'rogue'): string {
  const colors = {
    knight: 'var(--sprite-opus)',
    ranger: 'var(--sprite-sonnet)',
    rogue: 'var(--sprite-haiku)',
  };

  return `
    .sprite-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 16px;
      background: var(--pixel-bg-light);
      border: 2px solid var(--pixel-border);
      margin-bottom: 8px;
    }

    .sprite {
      width: 48px;
      height: 48px;
      position: relative;
      background: ${colors[spriteType]};
      border-radius: 4px;
      box-shadow:
        inset -4px -4px 0 0 rgba(0,0,0,0.3),
        inset 4px 4px 0 0 rgba(255,255,255,0.2);
    }

    .sprite.animated {
      animation: idle-bounce 1s ease-in-out infinite;
    }

    /* Sprite "face" using pseudo-elements */
    .sprite::before {
      content: '';
      position: absolute;
      top: 12px;
      left: 8px;
      width: 8px;
      height: 8px;
      background: var(--pixel-bg);
      box-shadow: 24px 0 0 var(--pixel-bg);
    }

    .sprite::after {
      content: '';
      position: absolute;
      top: 28px;
      left: 16px;
      width: 16px;
      height: 4px;
      background: var(--pixel-bg);
    }

    /* Animation states */
    .sprite.investigating::before {
      box-shadow: 24px 0 0 var(--pixel-bg), 36px -4px 0 4px transparent;
      border: 2px solid var(--pixel-bg);
      border-radius: 50%;
    }

    .sprite.writing {
      animation: shake 0.1s ease-in-out infinite;
    }

    .sprite.casting {
      animation: pulse 0.2s ease-in-out infinite;
      box-shadow:
        inset -4px -4px 0 0 rgba(0,0,0,0.3),
        inset 4px 4px 0 0 rgba(255,255,255,0.2),
        0 0 16px ${colors[spriteType]};
    }

    .sprite.error {
      animation: shake 0.1s ease-in-out;
      background: var(--pixel-error);
    }

    .sprite.success {
      background: var(--pixel-success);
    }
  `;
}
