Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class HighResMatting {
    public static void Process(string inputPath, string outputPath) {
        using (Bitmap srcBmp = new Bitmap(inputPath)) {
            int w = srcBmp.Width;
            int h = srcBmp.Height;
            Console.WriteLine(string.Format("Source image: {0}x{1}", w, h));

            // Step 1: Lock source
            BitmapData srcData = srcBmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            int srcStride = srcData.Stride;
            byte[] srcBytes = new byte[srcStride * h];
            Marshal.Copy(srcData.Scan0, srcBytes, 0, srcBytes.Length);
            srcBmp.UnlockBits(srcData);

            // Step 2: BFS from image borders to find all exterior background pixels
            bool[] isExterior = new bool[w * h];
            Queue<int> queue = new Queue<int>();

            for (int x = 0; x < w; x++) {
                queue.Enqueue(0 * w + x);
                queue.Enqueue((h - 1) * w + x);
                isExterior[0 * w + x] = true;
                isExterior[(h - 1) * w + x] = true;
            }
            for (int y = 0; y < h; y++) {
                if (!isExterior[y * w + 0]) { queue.Enqueue(y * w + 0); isExterior[y * w + 0] = true; }
                if (!isExterior[y * w + (w - 1)]) { queue.Enqueue(y * w + (w - 1)); isExterior[y * w + (w - 1)] = true; }
            }

            int[] dx4 = new int[] { 0, 0, 1, -1 };
            int[] dy4 = new int[] { 1, -1, 0, 0 };

            // We flood fill all pixels reachable from outside with brightness <= 5 (pure black background)
            while (queue.Count > 0) {
                int curr = queue.Dequeue();
                int cy = curr / w;
                int cx = curr % w;

                for (int i = 0; i < 4; i++) {
                    int nx = cx + dx4[i];
                    int ny = cy + dy4[i];
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        int nidx = ny * w + nx;
                        if (!isExterior[nidx]) {
                            int offset = ny * srcStride + nx * 3;
                            byte b = srcBytes[offset];
                            byte g = srcBytes[offset + 1];
                            byte r = srcBytes[offset + 2];
                            int maxVal = Math.Max((int)r, Math.Max((int)g, (int)b));
                            if (maxVal <= 5) {
                                isExterior[nidx] = true;
                                queue.Enqueue(nidx);
                            }
                        }
                    }
                }
            }

            // Step 3: Compute distance to exterior background (up to 4 pixels)
            // Distance 0 = exterior
            byte[] distToBg = new byte[w * h];
            for (int i = 0; i < w * h; i++) {
                distToBg[i] = isExterior[i] ? (byte)0 : (byte)255;
            }

            // Breadth-first wavefront for distances 1, 2, 3, 4
            Queue<int> distQueue = new Queue<int>();
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int idx = y * w + x;
                    if (!isExterior[idx]) {
                        bool nextToBg = false;
                        for (int i = 0; i < 4; i++) {
                            int nx = x + dx4[i];
                            int ny = y + dy4[i];
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h && isExterior[ny * w + nx]) {
                                nextToBg = true;
                                break;
                            }
                        }
                        if (nextToBg) {
                            distToBg[idx] = 1;
                            distQueue.Enqueue(idx);
                        }
                    }
                }
            }

            while (distQueue.Count > 0) {
                int curr = distQueue.Dequeue();
                int cy = curr / w;
                int cx = curr % w;
                byte cd = distToBg[curr];
                if (cd >= 4) continue;

                for (int i = 0; i < 4; i++) {
                    int nx = cx + dx4[i];
                    int ny = cy + dy4[i];
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        int nidx = ny * w + nx;
                        if (distToBg[nidx] == 255) {
                            distToBg[nidx] = (byte)(cd + 1);
                            distQueue.Enqueue(nidx);
                        }
                    }
                }
            }

            // Step 4: Create 32-bit ARGB output bitmap
            using (Bitmap dstBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
                BitmapData dstData = dstBmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                int dstStride = dstData.Stride;
                byte[] dstBytes = new byte[dstStride * h];

                int semiCount = 0;

                for (int y = 0; y < h; y++) {
                    for (int x = 0; x < w; x++) {
                        int idx = y * w + x;
                        int srcOff = y * srcStride + x * 3;
                        int dstOff = y * dstStride + x * 4;

                        byte b = srcBytes[srcOff];
                        byte g = srcBytes[srcOff + 1];
                        byte r = srcBytes[srcOff + 2];
                        int maxVal = Math.Max((int)r, Math.Max((int)g, (int)b));

                        if (isExterior[idx]) {
                            // Completely outside
                            dstBytes[dstOff + 0] = 0;
                            dstBytes[dstOff + 1] = 0;
                            dstBytes[dstOff + 2] = 0;
                            dstBytes[dstOff + 3] = 0;
                        } else if (distToBg[idx] > 3) {
                            // Deep interior: 100% opaque
                            dstBytes[dstOff + 0] = b;
                            dstBytes[dstOff + 1] = g;
                            dstBytes[dstOff + 2] = r;
                            dstBytes[dstOff + 3] = 255;
                        } else {
                            // Transition band (dist 1, 2, 3)
                            // Find nearby definite interior foreground pixel (distToBg >= 3)
                            int bestR = r, bestG = g, bestB = b;
                            int bestLum = 0;
                            int searchR = 4;

                            for (int sy = -searchR; sy <= searchR; sy++) {
                                int ny = y + sy;
                                if (ny < 0 || ny >= h) continue;
                                for (int sx = -searchR; sx <= searchR; sx++) {
                                    int nx = x + sx;
                                    if (nx < 0 || nx >= w) continue;
                                    int nidx = ny * w + nx;
                                    if (distToBg[nidx] >= 3) {
                                        int noff = ny * srcStride + nx * 3;
                                        int nr = srcBytes[noff + 2];
                                        int ng = srcBytes[noff + 1];
                                        int nb = srcBytes[noff];
                                        int nLum = (int)(0.299 * nr + 0.587 * ng + 0.114 * nb);
                                        if (nLum > bestLum) {
                                            bestLum = nLum;
                                            bestR = nr;
                                            bestG = ng;
                                            bestB = nb;
                                        }
                                    }
                                }
                            }

                            double obsLum = 0.299 * r + 0.587 * g + 0.114 * b;
                            double targetLum = Math.Max((double)bestLum, 40.0);
                            double alphaVal = obsLum / targetLum;

                            // Curve adjustment for smooth subpixel falloff
                            if (distToBg[idx] == 1 && maxVal <= 6) {
                                alphaVal = 0.0;
                            } else {
                                alphaVal = Math.Min(1.0, Math.Max(0.0, alphaVal));
                                // Smoothstep for anti-aliasing
                                alphaVal = alphaVal * alphaVal * (3 - 2 * alphaVal);
                            }

                            byte a = (byte)Math.Round(alphaVal * 255.0);

                            if (a == 0) {
                                dstBytes[dstOff + 0] = 0;
                                dstBytes[dstOff + 1] = 0;
                                dstBytes[dstOff + 2] = 0;
                                dstBytes[dstOff + 3] = 0;
                            } else {
                                semiCount++;
                                // Un-premultiply / color recovery:
                                // If alpha < 0.6, blend strongly with best nearby foreground color to banish black fringe
                                double blendWithNeighbor = Math.Max(0.0, 1.0 - alphaVal);
                                double recR = Math.Min(255.0, (double)r / Math.Max(alphaVal, 0.15));
                                double recG = Math.Min(255.0, (double)g / Math.Max(alphaVal, 0.15));
                                double recB = Math.Min(255.0, (double)b / Math.Max(alphaVal, 0.15));

                                byte finalR = (byte)Math.Round(recR * (1.0 - blendWithNeighbor) + (double)bestR * blendWithNeighbor);
                                byte finalG = (byte)Math.Round(recG * (1.0 - blendWithNeighbor) + (double)bestG * blendWithNeighbor);
                                byte finalB = (byte)Math.Round(recB * (1.0 - blendWithNeighbor) + (double)bestB * blendWithNeighbor);

                                dstBytes[dstOff + 0] = finalB;
                                dstBytes[dstOff + 1] = finalG;
                                dstBytes[dstOff + 2] = finalR;
                                dstBytes[dstOff + 3] = a;
                            }
                        }
                    }
                }

                Marshal.Copy(dstBytes, 0, dstData.Scan0, dstBytes.Length);
                dstBmp.UnlockBits(dstData);

                // Save with maximum quality PNG compression
                dstBmp.Save(outputPath, ImageFormat.Png);
                Console.WriteLine(string.Format("Saved clean alpha PNG to {0}", outputPath));
                Console.WriteLine(string.Format("Anti-aliased transition pixels with smooth alpha: {0}", semiCount));
            }
        }
    }
}
"@ -ReferencedAssemblies System.Drawing

[HighResMatting]::Process(
    'C:\Users\intel\.gemini\antigravity\brain\9f81b6df-af4f-4125-b12c-ff1826ddf382\.user_uploaded\media_1794726910996_de47b72a.jpg',
    'D:\Projects\VDEV\VISHREA-STUDIO-main\scripts\clean-test.png'
)
