// The subject mask behind tools/jsa-portrait.py: macOS Vision's foreground
// instance mask (macOS 14+), from Objective-C because the Command Line Tools'
// swiftc can't import Foundation on this Mac (a duplicate module map).
//   jsa-mask <in image> <out.raw>
// Writes width*height bytes (0 = background, 255 = subject), row by row, and
// prints "W H instances". jsa-portrait.py builds it with clang on each run.
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreVideo/CoreVideo.h>
#import <ImageIO/ImageIO.h>

int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 3) { fprintf(stderr, "usage: cutout <in image> <out.raw>\n"); return 2; }
        CGImageSourceRef src = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:@(argv[1])], NULL);
        CGImageRef cg = src ? CGImageSourceCreateImageAtIndex(src, 0, NULL) : NULL;
        if (!cg) { fprintf(stderr, "can't read the image\n"); return 1; }

        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
        VNGenerateForegroundInstanceMaskRequest *req = [[VNGenerateForegroundInstanceMaskRequest alloc] init];
        NSError *err = nil;
        if (![handler performRequests:@[req] error:&err]) { fprintf(stderr, "vision: %s\n", err.description.UTF8String); return 1; }
        VNInstanceMaskObservation *obs = req.results.firstObject;
        if (!obs) { fprintf(stderr, "no subject found\n"); return 1; }
        CVPixelBufferRef buf = [obs generateScaledMaskForImageForInstances:obs.allInstances fromRequestHandler:handler error:&err];
        if (!buf) { fprintf(stderr, "mask: %s\n", err.description.UTF8String); return 1; }

        CVPixelBufferLockBaseAddress(buf, kCVPixelBufferLock_ReadOnly);
        size_t w = CVPixelBufferGetWidth(buf), h = CVPixelBufferGetHeight(buf), stride = CVPixelBufferGetBytesPerRow(buf);
        if (CVPixelBufferGetPixelFormatType(buf) != kCVPixelFormatType_OneComponent32Float) { fprintf(stderr, "unexpected mask format\n"); return 1; }
        const uint8_t *base = CVPixelBufferGetBaseAddress(buf);
        NSMutableData *out = [NSMutableData dataWithLength:w * h];
        uint8_t *o = out.mutableBytes;
        for (size_t y = 0; y < h; y++) {
            const float *row = (const float *)(base + y * stride);
            for (size_t x = 0; x < w; x++) {
                float v = row[x] * 255.0f;
                o[y * w + x] = v <= 0 ? 0 : v >= 255 ? 255 : (uint8_t)lrintf(v);
            }
        }
        CVPixelBufferUnlockBaseAddress(buf, kCVPixelBufferLock_ReadOnly);
        if (![out writeToFile:@(argv[2]) atomically:YES]) { fprintf(stderr, "can't write\n"); return 1; }
        printf("%zu %zu %lu\n", w, h, (unsigned long)obs.allInstances.count);
        CGImageRelease(cg); CFRelease(src);
    }
    return 0;
}
