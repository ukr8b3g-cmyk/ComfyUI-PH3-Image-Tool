// Background pattern controls adapted from Speech-Bubble-Comic-Editor-App
// (web/canvas-background-patterns.js, MIT, copyright (c) 2026 ukr8b3g-cmyk).
export const BACKGROUND_PATTERNS = {
  'linear-gradient': {label:'backgroundLinear', color:'#808080', fields:[['angle',-180,180,0]]},
  'radial-gradient': {label:'backgroundRadial', color:'#808080', fields:[
    ['centerX',0,100,50], ['centerY',0,100,50], ['radius',1,150,70],
  ]},
  halftone: {label:'backgroundHalftone', color:'#111111', fields:[
    ['size',1,256,4], ['spacing',1,256,12], ['angle',-180,180,0], ['strength',0,100,80],
  ]},
  'parallel-lines': {label:'backgroundLines', color:'#111111', fields:[
    ['size',1,256,2], ['spacing',1,256,12], ['angle',-180,180,-20], ['strength',0,100,70],
  ]},
  checker: {label:'checker', color:'#111111', fields:[
    ['size',1,256,24], ['angle',-180,180,0], ['strength',0,100,100],
  ]},
};

export function newBackgroundPattern(type) {
  if (!Object.hasOwn(BACKGROUND_PATTERNS, type)) return null;
  const config = BACKGROUND_PATTERNS[type];
  return {type, color:config.color, ...Object.fromEntries(config.fields.map(([key,,,value])=>[key,value]))};
}

function repeatingTile(pattern) {
  const {type, size, spacing, color, strength} = pattern;
  const tile = document.createElement('canvas');
  if (type === 'halftone') {
    tile.width = tile.height = Math.max(size * 2, spacing);
  } else if (type === 'parallel-lines') {
    tile.width = 1;
    tile.height = spacing;
  } else {
    tile.width = tile.height = size * 2;
  }
  const ctx = tile.getContext('2d');
  ctx.fillStyle = color;
  ctx.globalAlpha = strength / 100;
  if (type === 'halftone') {
    ctx.beginPath();
    ctx.arc(tile.width / 2, tile.height / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'parallel-lines') {
    const line = Math.min(size, spacing);
    ctx.fillRect(0, Math.floor((spacing - line) / 2), 1, line);
  } else {
    ctx.fillRect(0, 0, size, size);
    ctx.fillRect(size, size, size, size);
  }
  return tile;
}

export function drawCanvasBackground(ctx, doc) {
  if (doc.transparent) return;
  const {width, height, background, background_pattern:pattern} = doc;
  ctx.save();
  ctx.fillStyle = background;
  if (pattern?.type === 'linear-gradient') {
    const angle = pattern.angle * Math.PI / 180;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
    const x = width / 2, y = height / 2;
    const gradient = ctx.createLinearGradient(x - dx * half, y - dy * half, x + dx * half, y + dy * half);
    gradient.addColorStop(0, background);
    gradient.addColorStop(1, pattern.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else if (pattern?.type === 'radial-gradient') {
    const x = width * pattern.centerX / 100, y = height * pattern.centerY / 100;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(width, height) * pattern.radius / 100);
    gradient.addColorStop(0, background);
    gradient.addColorStop(1, pattern.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else if (pattern && Object.hasOwn(BACKGROUND_PATTERNS, pattern.type)) {
    ctx.fillRect(0, 0, width, height);
    // Draw a small repeating tile even at the maximum canvas size.
    const repeat = ctx.createPattern(repeatingTile(pattern), 'repeat');
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(pattern.angle * Math.PI / 180);
    ctx.translate(-width / 2, -height / 2);
    ctx.fillStyle = repeat;
    const span = Math.hypot(width, height);
    ctx.fillRect(-span, -span, 3 * span, 3 * span);
  } else {
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}
