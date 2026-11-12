// On-device face detection for the colour profile (MediaPipe BlazeFace, short range). The runtime
// and model are served by this site and run in the browser: the photo is never uploaded, and the
// detector only finds where a face is. It does not recognise or identify anyone.
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import modelAssetPath from '../assets/models/blaze_face_short_range.tflite?url';

const MIN_SCORE = 0.7;
const MIN_FACE_SHARE = 0.12; // face box width ÷ image width; smaller faces are too few pixels to read

let detectorPromise = null;

/** Load (once) and return the detector. Safe to call early to warm it up while the visitor picks a photo. */
export function loadFaceDetector() {
  if (!detectorPromise) {
    detectorPromise = import('@mediapipe/tasks-vision')
      .then(({ FaceDetector }) =>
        FaceDetector.createFromOptions(
          { wasmLoaderPath, wasmBinaryPath },
          { baseOptions: { modelAssetPath, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 }
        )
      )
      .catch((err) => {
        detectorPromise = null;
        const e = new Error('Face detection could not start in this browser. Update your browser, or try Chrome, Safari or Edge.');
        e.cause = err;
        throw e;
      });
  }
  return detectorPromise;
}

const reject = (message) => {
  const e = new Error(message);
  e.noFace = true;
  return e;
};

/**
 * Find the one face in an image. Returns { box: {x, y, width, height} in image pixels, keypoints:
 * [{x, y}] in image pixels, score } or throws a visitor-facing message.
 * Keypoint order (BlazeFace): right eye, left eye, nose tip, mouth, right ear, left ear.
 */
export async function detectFace(image) {
  const detector = await loadFaceDetector();
  const width = image.naturalWidth || image.videoWidth || image.width;
  const height = image.naturalHeight || image.videoHeight || image.height;
  const faces = (detector.detect(image).detections || [])
    .map((d) => ({ score: d.categories?.[0]?.score ?? 0, box: d.boundingBox, keypoints: d.keypoints || [] }))
    .filter((f) => f.box && f.score >= MIN_SCORE);

  if (!faces.length) throw reject('We couldn’t find a face in this photo. Use a clear, front-facing photo of your face, with nothing covering it.');
  if (faces.length > 1) throw reject('There’s more than one face in this photo. Use a photo with just you in it.');

  const f = faces[0];
  if (f.box.width / width < MIN_FACE_SHARE) throw reject('Your face is too small in this photo. Move closer to the camera or crop the photo around your face.');
  return {
    score: f.score,
    box: { x: f.box.originX, y: f.box.originY, width: f.box.width, height: f.box.height },
    keypoints: f.keypoints.map((k) => ({ x: k.x * width, y: k.y * height })),
  };
}
