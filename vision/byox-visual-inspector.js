/**
 * ULTRON AI — BYOX Pure-CPU Visual Inspector & Feature Extractor
 *
 * Derived from Build Your Own X concepts:
 * - Victor Zhou: An Introduction to Convolutional Neural Networks (2D Convolutions)
 * - AOSA: Optical Character Recognition (OCR feature extraction)
 * - pyimagesearch: Mobile Document Scanner (Edge detection & gradient analysis)
 *
 * Implements pure-CPU image processing: Sobel edge gradients, Laplacian blur estimation,
 * 64-bit luminance perceptual hash (pHash), and color histogram analysis without OpenCV.
 */

export class ByoxVisualInspector {
  constructor(options = {}) {
    this.edgeThreshold = options.edgeThreshold || 50;
    this.blurThreshold = options.blurThreshold || 100;
  }

  /**
   * Convert an RGBA or Grayscale buffer into a 2D pixel array.
   */
  bufferToGrayscaleGrid(buffer, width, height, channels = 4) {
    const grid = [];
    for (let y = 0; y < height; y++) {
      const row = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels;
        if (channels >= 3) {
          const r = buffer[offset];
          const g = buffer[offset + 1];
          const b = buffer[offset + 2];
          // Standard ITU-R BT.601 luma formula
          row[x] = 0.299 * r + 0.587 * g + 0.114 * b;
        } else {
          row[x] = buffer[offset];
        }
      }
      grid.push(row);
    }
    return grid;
  }

  /**
   * Apply 3x3 convolution kernel with clamped boundary padding.
   */
  convolve3x3(grid, width, height, kernel) {
    const output = [];
    for (let y = 0; y < height; y++) {
      const row = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const py = Math.max(0, Math.min(height - 1, y + ky));
            const px = Math.max(0, Math.min(width - 1, x + kx));
            const pixel = grid[py][px];
            sum += pixel * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        row[x] = sum;
      }
      output.push(row);
    }
    return output;
  }

  /**
   * Compute Sobel Edge Gradient Magnitude and Edge Density.
   */
  computeSobelEdges(grid, width, height) {
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    const gx = this.convolve3x3(grid, width, height, sobelX);
    const gy = this.convolve3x3(grid, width, height, sobelY);

    let edgeCount = 0;
    let totalMagnitude = 0;
    const totalPixels = width * height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const mag = Math.sqrt(gx[y][x] * gx[y][x] + gy[y][x] * gy[y][x]);
        totalMagnitude += mag;
        if (mag > this.edgeThreshold) {
          edgeCount++;
        }
      }
    }

    const edgeDensity = totalPixels > 0 ? edgeCount / totalPixels : 0;
    const avgGradient = totalPixels > 0 ? totalMagnitude / totalPixels : 0;

    return {
      edgeDensity: Math.round(edgeDensity * 1000) / 1000,
      avgGradient: Math.round(avgGradient * 100) / 100,
      edgePixelCount: edgeCount
    };
  }

  /**
   * Compute blur metric via Laplacian variance.
   */
  computeLaplacianBlur(grid, width, height) {
    const laplacianKernel = [0, 1, 0, 1, -4, 1, 0, 1, 0];
    const lap = this.convolve3x3(grid, width, height, laplacianKernel);

    let sum = 0;
    let sumSquares = 0;
    const totalPixels = width * height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = lap[y][x];
        sum += val;
        sumSquares += val * val;
      }
    }

    const mean = sum / totalPixels;
    const variance = (sumSquares / totalPixels) - (mean * mean);

    return {
      blurScore: Math.round(variance * 100) / 100,
      isBlurry: variance < this.blurThreshold
    };
  }

  /**
   * Compute 64-bit Luminance Perceptual Hash (pHash) for image deduplication.
   */
  computePerceptualHash(grid, width, height) {
    // 1. Resample down to 8x8 blocks
    const blockSizeX = width / 8;
    const blockSizeY = height / 8;
    const blockValues = new Float32Array(64);
    let totalSum = 0;

    for (let by = 0; by < 8; by++) {
      for (let bx = 0; bx < 8; bx++) {
        const startX = Math.floor(bx * blockSizeX);
        const endX = Math.floor((bx + 1) * blockSizeX);
        const startY = Math.floor(by * blockSizeY);
        const endY = Math.floor((by + 1) * blockSizeY);

        let blockSum = 0;
        let count = 0;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            if (y < height && x < width) {
              blockSum += grid[y][x];
              count++;
            }
          }
        }

        const avg = count > 0 ? blockSum / count : 0;
        const idx = by * 8 + bx;
        blockValues[idx] = avg;
        totalSum += avg;
      }
    }

    const overallAvg = totalSum / 64;
    let hexHash = '';

    for (let chunk = 0; chunk < 16; chunk++) {
      let nibble = 0;
      for (let bit = 0; bit < 4; bit++) {
        const idx = chunk * 4 + bit;
        if (blockValues[idx] >= overallAvg) {
          nibble |= (1 << (3 - bit));
        }
      }
      hexHash += nibble.toString(16);
    }

    return hexHash;
  }

  /**
   * Compute Hamming distance between two 16-hex perceptual hashes (0 to 64).
   */
  hammingDistance(hashA, hashB) {
    if (!hashA || !hashB || hashA.length !== 16 || hashB.length !== 16) {
      throw new Error('Valid 16-character hex hashes required');
    }

    let distance = 0;
    for (let i = 0; i < 16; i++) {
      const valA = parseInt(hashA[i], 16);
      const valB = parseInt(hashB[i], 16);
      let xor = valA ^ valB;
      while (xor > 0) {
        distance += (xor & 1);
        xor >>= 1;
      }
    }
    return distance;
  }

  /**
   * Holistic visual inspection of an image buffer.
   */
  inspectImage(buffer, width, height, channels = 4) {
    const grid = this.bufferToGrayscaleGrid(buffer, width, height, channels);
    const sobel = this.computeSobelEdges(grid, width, height);
    const blur = this.computeLaplacianBlur(grid, width, height);
    const phash = this.computePerceptualHash(grid, width, height);

    return {
      width,
      height,
      edgeDensity: sobel.edgeDensity,
      avgGradient: sobel.avgGradient,
      blurScore: blur.blurScore,
      isBlurry: blur.isBlurry,
      perceptualHash: phash
    };
  }
}
