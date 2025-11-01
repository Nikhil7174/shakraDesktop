import { EventEmitter } from 'events'
import OpenAI from 'openai'
import { Readable } from 'stream'
import Speaker from 'speaker'
import https from 'https'

// Create reusable HTTPS agent for connection pooling (OpenAI API is HTTPS-only)
// Keep connection alive for entire interview (set high, but server will close idle connections anyway)
// Note: This doesn't increase costs - keep-alive connections are free and actually save resources
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 7200000,  // 2 hours (high value, but servers close idle connections ~60-120s anyway)
  maxSockets: 10,          // Max concurrent connections per host
  maxFreeSockets: 2       // Max idle connections to keep
})

export interface TTSConfig {
  provider: 'openai'
  apiKey: string
  voice?: string
  model?: string
  speed?: number
}

export interface TTSResponse {
  audio: Buffer
  duration: number
  text: string
}

export class TTSService extends EventEmitter {
  private openai: OpenAI
  private speaker: Speaker | null = null
  private config: TTSConfig
  private isPlaying = false
  private currentPlaybackResolve?: () => void

  constructor(config: TTSConfig) {
    super()
    this.config = config
    this.openai = new OpenAI({ 
      apiKey: config.apiKey,
      httpAgent: httpsAgent, // Use connection pooling for HTTPS (OpenAI API is HTTPS-only)
      timeout: 30000  // 30s timeout
    })
  }

  async generateSpeech(text: string): Promise<TTSResponse> {
    try {
      const startTime = Date.now()
      
      // Prefer WAV to avoid MP3 decoding issues in Node playback
      const wav = await this.openai.audio.speech.create({
        model: this.config.model || 'tts-1',
        voice: this.config.voice || 'alloy',
        input: text,
        speed: this.config.speed || 1.0,
        response_format: 'wav'
      })

      const buffer = Buffer.from(await wav.arrayBuffer())
      const duration = Date.now() - startTime

      this.emit('speechGenerated', { text, duration })

      return {
        audio: buffer,
        duration,
        text
      }

    } catch (error) {
      console.error('TTS generation error:', error)
      this.emit('error', error)
      throw error
    }
  }

  async playAudio(audioBuffer: Buffer): Promise<void> {
    if (this.isPlaying) {
      await this.stopAudio()
    }

    return new Promise((resolve, reject) => {
      try {
        this.isPlaying = true
        this.currentPlaybackResolve = resolve
        this.emit('playbackStarted')
        
        // If WAV container, extract PCM for Speaker
        const { pcm, sampleRate, channels, bitDepth } = this.extractPcmFromWav(audioBuffer)

        // Create speaker instance matching audio
        this.speaker = new Speaker({
          channels,
          bitDepth,
          sampleRate
        })

        // Create readable stream from PCM buffer
        const readable = Readable.from(pcm)
        
        // Handle playback completion
        this.speaker.on('close', () => {
          this.isPlaying = false
          this.currentPlaybackResolve = undefined
          this.emit('playbackCompleted')
          resolve() // Resolve when audio actually finishes
        })

        // Handle errors
        this.speaker.on('error', (error) => {
          console.error('Speaker error:', error)
          this.isPlaying = false
          this.currentPlaybackResolve = undefined
          this.emit('playbackError', error)
          reject(error)
        })

        // Pipe audio to speaker
        readable.pipe(this.speaker)

      } catch (error) {
        console.error('Audio playback error:', error)
        this.isPlaying = false
        this.currentPlaybackResolve = undefined
        this.emit('playbackError', error)
        reject(error)
      }
    })
  }

  async playText(text: string): Promise<void> {
    try {
      const response = await this.generateSpeech(text)
      await this.playAudio(response.audio)
    } catch (error) {
      console.error('Play text error:', error)
      throw error
    }
  }

  async stopAudio(): Promise<void> {
    if (this.speaker && this.isPlaying) {
      try {
        this.speaker.end()
        this.speaker = null
        this.isPlaying = false
        this.emit('playbackStopped')
        // Resolve the current playback promise to unblock waiters
        if (this.currentPlaybackResolve) {
          this.currentPlaybackResolve()
          this.currentPlaybackResolve = undefined
        }
      } catch (error) {
        console.error('Stop audio error:', error)
      }
    }
  }

  // Alias for stop() to match SpeechGate interface
  async stop(): Promise<void> {
    return this.stopAudio()
  }

  isCurrentlyPlaying(): boolean {
    return this.isPlaying
  }

  // Utility method to speak with natural pauses
  async speakWithPauses(text: string, pauseMs: number = 500): Promise<void> {
    // Split text into sentences for natural pauses
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim()
      if (sentence.length > 0) {
        await this.playText(sentence)
        
        // Add pause between sentences (except for the last one)
        if (i < sentences.length - 1) {
          await this.delay(pauseMs)
        }
      }
    }
  }

  // Utility method to add emphasis to certain words
  async speakWithEmphasis(text: string, emphasisWords: string[]): Promise<string> {
    let emphasizedText = text
    
    emphasisWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi')
      emphasizedText = emphasizedText.replace(regex, `<emphasis level="strong">${word}</emphasis>`)
    })
    
    return emphasizedText
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Minimal WAV parser to extract PCM s16le
  private extractPcmFromWav(buffer: Buffer): { pcm: Buffer; sampleRate: number; channels: number; bitDepth: number } {
    // Expect 'RIFF' header
    const isRiff = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE'
    if (!isRiff) {
      // Assume already PCM
      return { pcm: buffer, sampleRate: 24000, channels: 1, bitDepth: 16 }
    }

    // Parse fmt chunk (starts at 12)
    let offset = 12
    let sampleRate = 24000
    let channels = 1
    let bitDepth = 16
    let dataOffset = -1
    let dataSize = 0

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4)
      const chunkSize = buffer.readUInt32LE(offset + 4)
      const next = offset + 8 + chunkSize

      if (chunkId === 'fmt ') {
        channels = buffer.readUInt16LE(offset + 10)
        sampleRate = buffer.readUInt32LE(offset + 12)
        bitDepth = buffer.readUInt16LE(offset + 22)
      } else if (chunkId === 'data') {
        dataOffset = offset + 8
        dataSize = chunkSize
        break
      }
      offset = next
    }

    if (dataOffset < 0) {
      // Fallback: return original
      return { pcm: buffer, sampleRate, channels, bitDepth }
    }

    const pcm = buffer.slice(dataOffset, dataOffset + dataSize)
    return { pcm, sampleRate, channels, bitDepth }
  }

  // Clean up resources
  destroy(): void {
    if (this.speaker) {
      this.speaker.end()
      this.speaker = null
    }
    this.isPlaying = false
  }
}

// Factory function for easy initialization
export function createTTSService(config: TTSConfig): TTSService {
  return new TTSService(config)
}


