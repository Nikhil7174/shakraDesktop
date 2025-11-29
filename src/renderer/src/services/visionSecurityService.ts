import {
  FilesetResolver,
  FaceLandmarker,
  FaceDetector,
  NormalizedLandmark
} from '@mediapipe/tasks-vision'
import type {
  VisionSecurityStatus,
  GazeDirection,
  SuspiciousEvent
} from '../../../shared/types'

export class VisionSecurityService {
  private faceLandmarker: FaceLandmarker | null = null
  private faceDetector: FaceDetector | null = null
  private isInitialized = false
  private blinkHistory: number[] = []
  private lastBlinkTime = 0
  private gazeAwayStartTime: number | null = null
  private faceAbsentStartTime: number | null = null
  private mobileDeviceStartTime: number | null = null
  private lastProcessTime = 0
  private readonly PROCESS_INTERVAL = 100 // Process every 100ms (10 FPS)

  // Thresholds
  private readonly GAZE_AWAY_THRESHOLD = 3000 // 3 seconds
  private readonly FACE_ABSENT_THRESHOLD = 5000 // 5 seconds
  private readonly BLINK_EAR_THRESHOLD = 0.25
  private readonly MOBILE_DEVICE_DURATION = 3000 // 3 seconds - gaze down must persist

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      console.log('🔧 Initializing MediaPipe Vision Security Service...')
      
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
      )
      
      console.log('✅ MediaPipe FilesetResolver loaded successfully')

      // Initialize Face Landmarker
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: false,
        runningMode: 'IMAGE',
        numFaces: 2 // Detect up to 2 faces
      })

      // Initialize Face Detector
      this.faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'GPU'
        },
        runningMode: 'IMAGE'
      })

      this.isInitialized = true
      console.log('✅ Vision Security Service initialized successfully')
    } catch (error: any) {
      console.error('❌ Failed to initialize Vision Security Service:', error)
      
      // Check if it's a CSP error
      if (error?.message?.includes('Content Security Policy') || 
          error?.message?.includes('CSP') ||
          error?.type === 'error') {
        console.error('⚠️ CSP Error: MediaPipe WASM files are being blocked by Content Security Policy')
        console.error('⚠️ Please check that CSP allows: script-src-elem, worker-src, and wasm-unsafe-eval')
      }
      
      throw error
    }
  }

  async processFrame(videoElement: HTMLVideoElement): Promise<VisionSecurityStatus | null> {
    if (!this.isInitialized || !videoElement || videoElement.readyState !== 4) {
      return null
    }

    const now = Date.now()
    if (now - this.lastProcessTime < this.PROCESS_INTERVAL) {
      return null // Throttle processing
    }
    this.lastProcessTime = now

    try {
      // Create canvas to capture frame
      const canvas = document.createElement('canvas')
      canvas.width = videoElement.videoWidth
      canvas.height = videoElement.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      // Process face detection and landmarks
      const faceDetections = this.faceDetector?.detect(imageData)
      const faceLandmarks = this.faceLandmarker?.detect(imageData)

      return this.analyzeResults(faceDetections, faceLandmarks)
    } catch (error) {
      console.error('Error processing frame:', error)
      return null
    }
  }

  private analyzeResults(
    faceDetections: any,
    faceLandmarks: any
  ): VisionSecurityStatus {
    const suspiciousEvents: SuspiciousEvent[] = []
    const now = Date.now()

    // Face detection analysis
    const faceDetected = (faceDetections?.detections?.length || 0) > 0
    const multipleFacesDetected = (faceDetections?.detections?.length || 0) > 1
    const facePresenceConfidence = faceDetected
      ? (faceDetections?.detections?.[0]?.score || 0)
      : 0

    if (multipleFacesDetected) {
      // Only add event once per detection to avoid spam
      const lastMultipleFacesEvent = suspiciousEvents.find(e => e.type === 'multiple_faces')
      if (!lastMultipleFacesEvent || (now - lastMultipleFacesEvent.timestamp) > 5000) {
        suspiciousEvents.push({
          type: 'multiple_faces',
          timestamp: now,
          severity: 'high',
          description: 'Multiple faces detected in frame'
        })
      }
    }

    // Face absent detection (separate from gaze away)
    if (!faceDetected) {
      if (this.faceAbsentStartTime === null) {
        this.faceAbsentStartTime = now
      } else {
        const faceAbsentDuration = now - this.faceAbsentStartTime
        if (faceAbsentDuration > this.FACE_ABSENT_THRESHOLD) {
          // Only add event once per threshold period (every 5 seconds)
          const lastFaceAbsentEvent = suspiciousEvents.find(e => e.type === 'face_absent')
          if (!lastFaceAbsentEvent || (now - lastFaceAbsentEvent.timestamp) > 5000) {
            suspiciousEvents.push({
              type: 'face_absent',
              timestamp: now,
              severity: 'high',
              description: `Face not detected for ${Math.round(faceAbsentDuration / 1000)}s`,
              duration: faceAbsentDuration
            })
          }
        }
      }
    } else {
      this.faceAbsentStartTime = null
    }

    // Eye tracking and gaze direction
    let gazeDirection: GazeDirection = 'center'
    let blinkRate = 0

    if (faceLandmarks?.faceLandmarks && faceLandmarks.faceLandmarks.length > 0) {
      const landmarks = faceLandmarks.faceLandmarks[0]
      gazeDirection = this.calculateGazeDirection(landmarks)
      blinkRate = this.detectBlink(landmarks, now)
    }

    // Mobile device detection: Gaze down pattern
    // Looking down is a strong indicator of mobile phone usage
    const mobileDeviceUsageDetected = faceDetected && gazeDirection === 'down'

    if (mobileDeviceUsageDetected) {
      if (this.mobileDeviceStartTime === null) {
        this.mobileDeviceStartTime = now
      } else {
        const mobileDuration = now - this.mobileDeviceStartTime
        if (mobileDuration > this.MOBILE_DEVICE_DURATION) {
          // Only add event once per threshold period to avoid spam
          const lastMobileEvent = suspiciousEvents.find(e => e.type === 'mobile_device_usage')
          if (!lastMobileEvent || (now - lastMobileEvent.timestamp) > 5000) {
            suspiciousEvents.push({
              type: 'mobile_device_usage',
              timestamp: now,
              severity: 'high',
              description: 'Possible mobile device usage detected (looking down)',
              duration: mobileDuration
            })
          }
        }
      }
    } else {
      // Reset timer if condition is no longer met
      this.mobileDeviceStartTime = null
    }

    // Gaze away detection (only when face is detected, otherwise face_absent handles it)
    let gazeAwayDuration = 0
    if (faceDetected && gazeDirection !== 'center' && gazeDirection !== 'away') {
      if (this.gazeAwayStartTime === null) {
        this.gazeAwayStartTime = now
      } else {
        gazeAwayDuration = now - this.gazeAwayStartTime
        // Only add event once per threshold period (every 3 seconds) to avoid spam
        const lastGazeAwayEvent = suspiciousEvents.find(e => e.type === 'gaze_away')
        if (gazeAwayDuration > this.GAZE_AWAY_THRESHOLD) {
          if (!lastGazeAwayEvent || (now - lastGazeAwayEvent.timestamp) > 3000) {
            suspiciousEvents.push({
              type: 'gaze_away',
              timestamp: now,
              severity: 'medium',
              description: `Gaze away from screen (${gazeDirection}) for ${Math.round(gazeAwayDuration / 1000)}s`,
              duration: gazeAwayDuration
            })
          }
        }
      }
    } else {
      this.gazeAwayStartTime = null
    }

    // Log debug info periodically (every 5 seconds) to help diagnose detection issues
    if (now % 5000 < 100) { // Roughly every 5 seconds
      console.log('👁️ [Vision Debug] Gaze:', gazeDirection, '| Face:', faceDetected, '| Events:', suspiciousEvents.length)
      if (suspiciousEvents.length > 0) {
        console.log('👁️ [Vision Debug] Event details:', suspiciousEvents.map(e => ({
          type: e.type,
          severity: e.severity,
          description: e.description
        })))
      }
    }
    
    // Log immediately when new events are detected (not just periodically)
    if (suspiciousEvents.length > 0) {
      const eventTypes = suspiciousEvents.map(e => e.type).join(', ')
      console.log(`🚨 [Vision Security] Detected ${suspiciousEvents.length} suspicious event(s): ${eventTypes}`)
    }

    return {
      gazeDirection,
      blinkRate,
      faceDetected,
      multipleFacesDetected,
      facePresenceConfidence,
      gazeAwayDuration,
      handsDetected: false, // Hand tracking removed
      handCount: 0, // Hand tracking removed
      suspiciousHandPatterns: [], // Hand tracking removed
      handMovementIntensity: 0, // Hand tracking removed
      mobileDeviceUsageDetected,
      suspiciousEvents,
      timestamp: now
    }
  }

  private calculateGazeDirection(landmarks: NormalizedLandmark[]): GazeDirection {
    // Eye landmarks indices (MediaPipe face landmarks)
    // Using more reliable landmarks that are always available
    const leftEyeLeft = landmarks[33] // Left eye left corner
    const leftEyeRight = landmarks[133] // Left eye right corner
    const leftEyeTop = landmarks[159] // Left eye top
    const leftEyeBottom = landmarks[145] // Left eye bottom
    const rightEyeLeft = landmarks[362] // Right eye left corner
    const rightEyeRight = landmarks[263] // Right eye right corner
    const rightEyeTop = landmarks[386] // Right eye top
    const rightEyeBottom = landmarks[374] // Right eye bottom
    const noseTip = landmarks[4] // Nose tip
    const leftEyeCenter = landmarks[468] || null // Left iris/eye center (if available)
    const rightEyeCenter = landmarks[473] || null // Right iris/eye center (if available)

    // Check if we have basic eye landmarks
    if (!leftEyeLeft || !leftEyeRight || !rightEyeLeft || !rightEyeRight) {
      return 'away'
    }

    // Calculate eye width for normalization
    const leftEyeWidth = Math.abs(leftEyeRight.x - leftEyeLeft.x)
    const rightEyeWidth = Math.abs(rightEyeRight.x - rightEyeLeft.x)

    // Calculate offset from eye center (normalized by eye width)
    const leftOffsetX = leftEyeCenter 
      ? (leftEyeCenter.x - (leftEyeLeft.x + leftEyeRight.x) / 2) / leftEyeWidth
      : 0
    const leftOffsetY = leftEyeCenter && leftEyeTop && leftEyeBottom
      ? (leftEyeCenter.y - (leftEyeTop.y + leftEyeBottom.y) / 2) / Math.abs(leftEyeTop.y - leftEyeBottom.y)
      : 0
    
    const rightOffsetX = rightEyeCenter 
      ? (rightEyeCenter.x - (rightEyeLeft.x + rightEyeRight.x) / 2) / rightEyeWidth
      : 0
    const rightOffsetY = rightEyeCenter && rightEyeTop && rightEyeBottom
      ? (rightEyeCenter.y - (rightEyeTop.y + rightEyeBottom.y) / 2) / Math.abs(rightEyeTop.y - rightEyeBottom.y)
      : 0

    // Average the offsets
    const avgOffsetX = (leftOffsetX + rightOffsetX) / 2
    const avgOffsetY = (leftOffsetY + rightOffsetY) / 2

    // Use nose position as additional reference for head pose
    const noseOffsetX = noseTip ? (noseTip.x - 0.5) : 0 // 0.5 is center of face

    // Thresholds for gaze direction (more lenient)
    const threshold = 0.05 // Increased from 0.02 for better detection
    const headPoseThreshold = 0.1 // For head turning

    // If no iris data, use head pose estimation from nose position
    if (!leftEyeCenter || !rightEyeCenter) {
      if (Math.abs(noseOffsetX) > headPoseThreshold) {
        return noseOffsetX > 0 ? 'right' : 'left'
      }
      // Without iris data, assume center if face is detected
      return 'center'
    }

    // Combine eye gaze and head pose
    const combinedOffsetX = (avgOffsetX * 0.7) + (noseOffsetX * 0.3)
    const combinedOffsetY = avgOffsetY

    if (Math.abs(combinedOffsetX) < threshold && Math.abs(combinedOffsetY) < threshold) {
      return 'center'
    }

    if (Math.abs(combinedOffsetX) > Math.abs(combinedOffsetY)) {
      return combinedOffsetX > 0 ? 'right' : 'left'
    } else {
      return combinedOffsetY > 0 ? 'down' : 'up'
    }
  }

  private detectBlink(landmarks: NormalizedLandmark[], now: number): number {
    // Eye aspect ratio (EAR) calculation
    // Using key eye landmarks
    const leftEyeTop = landmarks[159]?.y || 0
    const leftEyeBottom = landmarks[145]?.y || 0
    const leftEyeLeft = landmarks[33]?.x || 0
    const leftEyeRight = landmarks[133]?.x || 0

    const rightEyeTop = landmarks[386]?.y || 0
    const rightEyeBottom = landmarks[374]?.y || 0
    const rightEyeLeft = landmarks[362]?.x || 0
    const rightEyeRight = landmarks[263]?.x || 0

    const leftEAR = Math.abs(leftEyeTop - leftEyeBottom) / Math.abs(leftEyeLeft - leftEyeRight)
    const rightEAR = Math.abs(rightEyeTop - rightEyeBottom) / Math.abs(rightEyeLeft - rightEyeRight)
    const avgEAR = (leftEAR + rightEAR) / 2

    // Detect blink
    if (avgEAR < this.BLINK_EAR_THRESHOLD && now - this.lastBlinkTime > 200) {
      this.blinkHistory.push(now)
      this.lastBlinkTime = now
      // Keep only last 60 seconds of blinks
      this.blinkHistory = this.blinkHistory.filter(time => now - time < 60000)
    }

    // Calculate blink rate (blinks per minute)
    const recentBlinks = this.blinkHistory.filter(time => now - time < 60000)
    const blinkRate = recentBlinks.length

    // Flag abnormal blink rate
    if (blinkRate < 10 || blinkRate > 40) {
      // Normal blink rate is 15-20 per minute
    }

    return blinkRate
  }

  cleanup(): void {
    if (this.faceLandmarker) {
      this.faceLandmarker.close()
      this.faceLandmarker = null
    }
    if (this.faceDetector) {
      this.faceDetector.close()
      this.faceDetector = null
    }
    this.isInitialized = false
    this.blinkHistory = []
  }
}

