import {
  FilesetResolver,
  FaceLandmarker,
  FaceDetector,
  HandLandmarker,
  NormalizedLandmark
} from '@mediapipe/tasks-vision'
import type {
  VisionSecurityStatus,
  GazeDirection,
  SuspiciousHandPattern,
  SuspiciousEvent
} from '../../../shared/types'

export class VisionSecurityService {
  private faceLandmarker: FaceLandmarker | null = null
  private faceDetector: FaceDetector | null = null
  private handLandmarker: HandLandmarker | null = null
  private isInitialized = false
  private blinkHistory: number[] = []
  private lastBlinkTime = 0
  private gazeAwayStartTime: number | null = null
  private previousHandPositions: Array<{ x: number; y: number; z: number }>[] = []
  private lastProcessTime = 0
  private readonly PROCESS_INTERVAL = 100 // Process every 100ms (10 FPS)

  // Thresholds
  private readonly GAZE_AWAY_THRESHOLD = 3000 // 3 seconds
  private readonly FACE_ABSENT_THRESHOLD = 5000 // 5 seconds
  private readonly BLINK_EAR_THRESHOLD = 0.25
  private readonly HAND_MOVEMENT_THRESHOLD = 0.1 // Distance threshold for rapid movement
  private readonly PHONE_USAGE_DISTANCE = 0.15 // Hand near face/ear threshold

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

      // Initialize Hand Landmarker
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'IMAGE',
        numHands: 2
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

      // Process hand landmarks
      const handLandmarks = this.handLandmarker?.detect(imageData)

      return this.analyzeResults(faceDetections, faceLandmarks, handLandmarks)
    } catch (error) {
      console.error('Error processing frame:', error)
      return null
    }
  }

  private analyzeResults(
    faceDetections: any,
    faceLandmarks: any,
    handLandmarks: any
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
      suspiciousEvents.push({
        type: 'multiple_faces',
        timestamp: now,
        severity: 'high',
        description: 'Multiple faces detected in frame'
      })
    }

    if (!faceDetected) {
      if (this.gazeAwayStartTime === null) {
        this.gazeAwayStartTime = now
      } else if (now - this.gazeAwayStartTime > this.FACE_ABSENT_THRESHOLD) {
        suspiciousEvents.push({
          type: 'face_absent',
          timestamp: now,
          severity: 'high',
          description: 'Face not detected for extended period',
          duration: now - this.gazeAwayStartTime
        })
      }
    } else {
      this.gazeAwayStartTime = null
    }

    // Eye tracking and gaze direction
    let gazeDirection: GazeDirection = 'center'
    let blinkRate = 0

    if (faceLandmarks?.faceLandmarks && faceLandmarks.faceLandmarks.length > 0) {
      const landmarks = faceLandmarks.faceLandmarks[0]
      gazeDirection = this.calculateGazeDirection(landmarks)
      blinkRate = this.detectBlink(landmarks, now)
    }

    // Gaze away detection
    let gazeAwayDuration = 0
    if (gazeDirection !== 'center' && gazeDirection !== 'away') {
      if (this.gazeAwayStartTime === null) {
        this.gazeAwayStartTime = now
      } else {
        gazeAwayDuration = now - this.gazeAwayStartTime
        if (gazeAwayDuration > this.GAZE_AWAY_THRESHOLD) {
          suspiciousEvents.push({
            type: 'gaze_away',
            timestamp: now,
            severity: 'medium',
            description: `Gaze away from screen for ${Math.round(gazeAwayDuration / 1000)}s`,
            duration: gazeAwayDuration
          })
        }
      }
    } else {
      this.gazeAwayStartTime = null
    }

    // Hand tracking and mobile device detection
    const handsDetected = (handLandmarks?.landmarks?.length || 0) > 0
    const handCount = handLandmarks?.landmarks?.length || 0
    const suspiciousHandPatterns: SuspiciousHandPattern[] = []
    let mobileDeviceUsageDetected = false
    let handMovementIntensity = 0

    if (handLandmarks?.landmarks && handLandmarks.landmarks.length > 0) {
      const handAnalysis = this.analyzeHands(
        handLandmarks.landmarks,
        faceLandmarks?.faceLandmarks?.[0]
      )
      suspiciousHandPatterns.push(...handAnalysis.patterns)
      mobileDeviceUsageDetected = handAnalysis.mobileDeviceUsage
      handMovementIntensity = handAnalysis.movementIntensity

      if (handAnalysis.patterns.length > 0) {
        suspiciousEvents.push({
          type: 'suspicious_hand_pattern',
          timestamp: now,
          severity: 'high',
          description: `Suspicious hand pattern detected: ${handAnalysis.patterns.join(', ')}`
        })
      }

      if (mobileDeviceUsageDetected) {
        suspiciousEvents.push({
          type: 'mobile_device_usage',
          timestamp: now,
          severity: 'high',
          description: 'Possible mobile device usage detected'
        })
      }
    }

    return {
      gazeDirection,
      blinkRate,
      faceDetected,
      multipleFacesDetected,
      facePresenceConfidence,
      gazeAwayDuration,
      handsDetected,
      handCount,
      suspiciousHandPatterns,
      mobileDeviceUsageDetected,
      handMovementIntensity,
      suspiciousEvents,
      timestamp: now
    }
  }

  private calculateGazeDirection(landmarks: NormalizedLandmark[]): GazeDirection {
    // Eye landmarks indices (MediaPipe face landmarks)
    const leftEyeLeft = landmarks[33] // Left eye left corner
    const leftEyeRight = landmarks[133] // Left eye right corner
    const rightEyeLeft = landmarks[362] // Right eye left corner
    const rightEyeRight = landmarks[263] // Right eye right corner
    const leftIris = landmarks[468] // Left iris center
    const rightIris = landmarks[473] // Right iris center
    const noseTip = landmarks[4] // Nose tip

    if (!leftIris || !rightIris) {
      return 'away'
    }

    // Calculate eye center positions
    const leftEyeCenterX = (leftEyeLeft.x + leftEyeRight.x) / 2
    const leftEyeCenterY = (leftEyeLeft.y + leftEyeRight.y) / 2
    const rightEyeCenterX = (rightEyeLeft.x + rightEyeRight.x) / 2
    const rightEyeCenterY = (rightEyeLeft.y + rightEyeRight.y) / 2

    // Calculate iris offset from eye center
    const leftIrisOffsetX = leftIris.x - leftEyeCenterX
    const leftIrisOffsetY = leftIris.y - leftEyeCenterY
    const rightIrisOffsetX = rightIris.x - rightEyeCenterX
    const rightIrisOffsetY = rightIris.y - rightEyeCenterY

    // Average the offsets
    const avgOffsetX = (leftIrisOffsetX + rightIrisOffsetX) / 2
    const avgOffsetY = (leftIrisOffsetY + rightIrisOffsetY) / 2

    // Thresholds for gaze direction
    const threshold = 0.02

    if (Math.abs(avgOffsetX) < threshold && Math.abs(avgOffsetY) < threshold) {
      return 'center'
    }

    if (Math.abs(avgOffsetX) > Math.abs(avgOffsetY)) {
      return avgOffsetX > 0 ? 'right' : 'left'
    } else {
      return avgOffsetY > 0 ? 'down' : 'up'
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

  private analyzeHands(
    handLandmarks: NormalizedLandmark[][],
    faceLandmarks?: NormalizedLandmark[]
  ): {
    patterns: SuspiciousHandPattern[]
    mobileDeviceUsage: boolean
    movementIntensity: number
  } {
    const patterns: SuspiciousHandPattern[] = []
    let mobileDeviceUsage = false
    let movementIntensity = 0

    if (!handLandmarks || handLandmarks.length === 0) {
      return { patterns, mobileDeviceUsage, movementIntensity }
    }

    // Calculate current hand positions (wrist landmarks)
    const currentPositions: Array<{ x: number; y: number; z: number }>[] = []
    
    for (const hand of handLandmarks) {
      if (hand && hand.length > 0) {
        const wrist = hand[0] // Wrist landmark
        currentPositions.push([{ x: wrist.x, y: wrist.y, z: wrist.z }])
      }
    }

    // Calculate movement intensity
    if (this.previousHandPositions.length > 0 && currentPositions.length > 0) {
      let totalMovement = 0
      for (let i = 0; i < Math.min(currentPositions.length, this.previousHandPositions.length); i++) {
        const current = currentPositions[i][0]
        const previous = this.previousHandPositions[i][0]
        const distance = Math.sqrt(
          Math.pow(current.x - previous.x, 2) +
          Math.pow(current.y - previous.y, 2) +
          Math.pow(current.z - previous.z, 2)
        )
        totalMovement += distance
      }
      movementIntensity = Math.min(totalMovement / currentPositions.length, 1)
      
      if (movementIntensity > this.HAND_MOVEMENT_THRESHOLD) {
        patterns.push('rapid_movement')
      }
    }

    this.previousHandPositions = currentPositions

    // Check for hand near face/ear (phone usage pattern)
    if (faceLandmarks && faceLandmarks.length > 0) {
      const faceCenter = {
        x: faceLandmarks[4]?.x || 0.5, // Nose tip
        y: faceLandmarks[4]?.y || 0.5,
        z: faceLandmarks[4]?.z || 0
      }

      for (const hand of handLandmarks) {
        if (hand && hand.length > 0) {
          const wrist = hand[0]
          const distance = Math.sqrt(
            Math.pow(wrist.x - faceCenter.x, 2) +
            Math.pow(wrist.y - faceCenter.y, 2) +
            Math.pow(wrist.z - faceCenter.z, 2)
          )

          if (distance < this.PHONE_USAGE_DISTANCE) {
            // Check if hand is near ear (y position similar, x position to side)
            const earY = faceLandmarks[234]?.y || faceCenter.y // Ear landmark
            if (Math.abs(wrist.y - earY) < 0.1) {
              patterns.push('hand_near_ear')
              mobileDeviceUsage = true
            } else {
              patterns.push('hand_near_face')
            }
          }
        }
      }
    }

    // Detect typing gestures (rapid finger movements)
    for (const hand of handLandmarks) {
      if (hand && hand.length >= 21) {
        // Check finger tip positions for typing pattern
        const thumbTip = hand[4]
        const indexTip = hand[8]
        const middleTip = hand[12]
        const ringTip = hand[16]
        const pinkyTip = hand[20]

        // Typing pattern: fingers moving in sequence
        const fingerTips = [thumbTip, indexTip, middleTip, ringTip, pinkyTip]
        let typingPattern = true
        for (let i = 1; i < fingerTips.length; i++) {
          const distance = Math.sqrt(
            Math.pow(fingerTips[i].x - fingerTips[i - 1].x, 2) +
            Math.pow(fingerTips[i].y - fingerTips[i - 1].y, 2)
          )
          if (distance > 0.05) {
            typingPattern = false
            break
          }
        }

        if (typingPattern && movementIntensity > 0.05) {
          patterns.push('typing')
          mobileDeviceUsage = true
        }
      }
    }

    return { patterns, mobileDeviceUsage, movementIntensity }
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
    if (this.handLandmarker) {
      this.handLandmarker.close()
      this.handLandmarker = null
    }
    this.isInitialized = false
    this.blinkHistory = []
    this.previousHandPositions = []
  }
}

