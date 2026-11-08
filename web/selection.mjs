/* Selection-only algorithms adapted from ukr8b3g-cmyk/Speech-Bubble-Comic-Editor-App
 * web/quick-retouch-core.js (MIT). No Quick Retouch editor is included.
 * Source and attribution: THIRD_PARTY_NOTICES.md. */
export function combineMasks(base,incoming,operation='replace') {
  if(base.length!==incoming.length)throw Error('Mask dimensions must agree');
  const output=new Uint8ClampedArray(base.length);
  for(let i=0;i<base.length;i++) {
    const a=base[i],b=incoming[i];
    output[i]=operation==='add'?Math.max(a,b):operation==='subtract'?Math.max(0,a-b):operation==='intersect'?Math.min(a,b):b;
  }
  return output;
}
export function rectangleMask(w,h,x0,y0,x1,y1) {
  const out=new Uint8ClampedArray(w*h),left=Math.max(0,Math.min(w,Math.floor(Math.min(x0,x1)))),right=Math.max(0,Math.min(w,Math.ceil(Math.max(x0,x1))));
  const top=Math.max(0,Math.min(h,Math.floor(Math.min(y0,y1)))),bottom=Math.max(0,Math.min(h,Math.ceil(Math.max(y0,y1))));
  for(let y=top;y<bottom;y++)out.fill(255,y*w+left,y*w+right);return out;
}
export function ellipseMask(w,h,x0,y0,x1,y1) {
  const out=new Uint8ClampedArray(w*h),left=Math.max(0,Math.floor(Math.min(x0,x1))),right=Math.min(w,Math.ceil(Math.max(x0,x1)));
  const top=Math.max(0,Math.floor(Math.min(y0,y1))),bottom=Math.min(h,Math.ceil(Math.max(y0,y1)));
  const rx=Math.max(.5,(right-left)/2),ry=Math.max(.5,(bottom-top)/2),cx=left+rx,cy=top+ry;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)if(((x+.5-cx)/rx)**2+((y+.5-cy)/ry)**2<=1)out[y*w+x]=255;return out;
}
export function pointInPolygon(x,y,points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/((b.y-a.y)||Number.EPSILON)+a.x)inside=!inside;
  }
  return inside;
}
export function polygonMask(w,h,points) {
  const out=new Uint8ClampedArray(w*h);if(points.length<3)return out;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const left=Math.max(0,Math.floor(Math.min(...xs))),right=Math.min(w-1,Math.ceil(Math.max(...xs)));
  const top=Math.max(0,Math.floor(Math.min(...ys))),bottom=Math.min(h-1,Math.ceil(Math.max(...ys)));
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(pointInPolygon(x+.5,y+.5,points))out[y*w+x]=255;return out;
}
export function strokeMask(mask,w,h,a,b,radius) {
  const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/Math.max(1,radius/3)));
  for(let step=0;step<=steps;step++) {
    const cx=a.x+(b.x-a.x)*step/steps,cy=a.y+(b.y-a.y)*step/steps;
    for(let y=Math.max(0,Math.floor(cy-radius));y<Math.min(h,Math.ceil(cy+radius));y++)for(let x=Math.max(0,Math.floor(cx-radius));x<Math.min(w,Math.ceil(cx+radius));x++) {
      const dist=Math.hypot(x+.5-cx,y+.5-cy);if(dist<=radius)mask[y*w+x]=Math.max(mask[y*w+x],Math.round(Math.min(1,radius-dist+.5)*255));
    }
  }
  return mask;
}
export function invertMask(mask){return mask.map(x=>255-x);}
export function maskBounds(mask,w,h){let l=w,t=h,r=0,b=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}return r>l&&b>t?[l,t,r-l,b-t]:null;}
export function maskCanvas(mask,w,h,alpha=false) {
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d'),pixels=ctx.createImageData(w,h);
  for(let i=0;i<mask.length;i++){const j=i*4;pixels.data[j]=alpha?255:mask[i];pixels.data[j+1]=alpha?255:mask[i];pixels.data[j+2]=alpha?255:mask[i];pixels.data[j+3]=alpha?mask[i]:255;}
  ctx.putImageData(pixels,0,0);return c;
}
export function readMask(image,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,w,h);const rgba=ctx.getImageData(0,0,w,h).data,out=new Uint8ClampedArray(w*h);for(let i=0;i<out.length;i++)out[i]=rgba[i*4];return out;}

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    const rMean = (r1 + r2) / 2;
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(
      (2 + rMean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rMean) / 256) * db * db,
    );
  }

  function pixelColor(data, index) {
    const offset = index * 4;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  }

  export function floodSelect(imageData, startX, startY, tolerance = 36) {
    const width = imageData.width;
    const height = imageData.height;
    const x = Math.max(0, Math.min(width - 1, Math.floor(startX)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(startY)));
    const output = new Uint8ClampedArray(width * height);
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let read = 0;
    let write = 0;
    const seed = y * width + x;
    const [sr, sg, sb, sa] = pixelColor(imageData.data, seed);
    queue[write++] = seed;
    visited[seed] = 1;
    const threshold = Math.max(0, Number(tolerance) || 0) * 4.5;

    while (read < write) {
      const index = queue[read++];
      const [r, g, b, a] = pixelColor(imageData.data, index);
      const alphaDistance = Math.abs(a - sa) * 1.5;
      if (colorDistance(r, g, b, sr, sg, sb) + alphaDistance > threshold) continue;
      output[index] = 255;
      const px = index % width;
      const py = Math.floor(index / width);
      if (px > 0) {
        const next = index - 1;
        if (!visited[next]) { visited[next] = 1; queue[write++] = next; }
      }
      if (px + 1 < width) {
        const next = index + 1;
        if (!visited[next]) { visited[next] = 1; queue[write++] = next; }
      }
      if (py > 0) {
        const next = index - width;
        if (!visited[next]) { visited[next] = 1; queue[write++] = next; }
      }
      if (py + 1 < height) {
        const next = index + width;
        if (!visited[next]) { visited[next] = 1; queue[write++] = next; }
      }
    }
    return output;
  }

  export function colorRangeMask(imageData, samples, excludedSamples = [], tolerance = 36, sampleStep = 1) {
    const output = new Uint8ClampedArray(imageData.width * imageData.height);
    const include = Array.isArray(samples) ? samples.filter(Boolean) : [];
    const exclude = Array.isArray(excludedSamples) ? excludedSamples.filter(Boolean) : [];
    if (!include.length) return output;
    const threshold = Math.max(0, Number(tolerance) || 0) * 4.5;
    const step = Math.max(1, Math.floor(Number(sampleStep) || 1));
    for (let y = 0; y < imageData.height; y += step) {
      for (let x = 0; x < imageData.width; x += step) {
      const index = y * imageData.width + x;
      const offset = index * 4;
      const r = imageData.data[offset];
      const g = imageData.data[offset + 1];
      const b = imageData.data[offset + 2];
      const alpha = imageData.data[offset + 3];
      if (!alpha) continue;
      let included = false;
      for (const sample of include) {
        if (colorDistance(r, g, b, sample.r, sample.g, sample.b) <= threshold) {
          included = true;
          break;
        }
      }
      if (!included) continue;
      let blocked = false;
      for (const sample of exclude) {
        if (colorDistance(r, g, b, sample.r, sample.g, sample.b) <= threshold) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        const blockRight = Math.min(imageData.width, x + step);
        const blockBottom = Math.min(imageData.height, y + step);
        for (let blockY = y; blockY < blockBottom; blockY += 1) {
          output.fill(255, blockY * imageData.width + x, blockY * imageData.width + blockRight);
        }
      }
      }
    }
    return output;
  }


  function boxBlurMask(mask, width, height, radius) {
    const r = Math.max(0, Math.min(64, Math.round(Number(radius) || 0)));
    if (!r || !mask?.length) return new Uint8ClampedArray(mask);
    const horizontal = new Float32Array(mask.length);
    const output = new Uint8ClampedArray(mask.length);
    const window = r * 2 + 1;

    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let x = -r; x <= r; x += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x));
        sum += mask[y * width + sampleX];
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[y * width + x] = sum / window;
        const removeX = Math.max(0, Math.min(width - 1, x - r));
        const addX = Math.max(0, Math.min(width - 1, x + r + 1));
        sum += mask[y * width + addX] - mask[y * width + removeX];
      }
    }

    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -r; y <= r; y += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y));
        sum += horizontal[sampleY * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        output[y * width + x] = Math.round(sum / window);
        const removeY = Math.max(0, Math.min(height - 1, y - r));
        const addY = Math.max(0, Math.min(height - 1, y + r + 1));
        sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
      }
    }
    return output;
  }

  export function featherMask(mask, width, height, radius) {
    const r = Math.max(0, Math.round(Number(radius) || 0));
    if (!r) return new Uint8ClampedArray(mask);
    let output = new Uint8ClampedArray(mask);
    const passRadius = Math.max(1, Math.round(r / 2));
    output = boxBlurMask(output, width, height, passRadius);
    output = boxBlurMask(output, width, height, passRadius);
    return output;
  }


export function selectionOperation(shift,alt,fallback='replace') {return shift&&alt?'intersect':alt?'subtract':shift?'add':fallback;}

// Boundary detection follows Quick Retouch's four-neighbor threshold (32).
// Include canvas edges and holes so full selections remain visible.
export function selectionBoundary(mask,w,h){
 const rgba=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(mask[i]<32)continue;
  if(x>0&&x<w-1&&y>0&&y<h-1&&mask[i-1]>=32&&mask[i+1]>=32&&mask[i-w]>=32&&mask[i+w]>=32)continue;
  const v=(Math.floor((x+y)/4)%2)?255:0,j=i*4;rgba[j]=rgba[j+1]=rgba[j+2]=v;rgba[j+3]=255;
 }return rgba;
}
